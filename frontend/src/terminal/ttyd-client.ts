export interface TerminalSize {
  columns: number
  rows: number
}

export type TerminalSizeSource = TerminalSize | (() => TerminalSize)

export type TtydClientEvent =
  | { state: 'connected' }
  | { state: 'disconnected'; retryable: boolean }
  | { state: 'error'; error: string; retryable: boolean }

export interface TtydPreferences {
  titleFixed?: string
  rendererType?: 'dom' | 'canvas' | 'webgl'
}

export interface TtydClientCallbacks {
  onState?: (event: TtydClientEvent) => void
  onOutput?: (data: Uint8Array) => void
  onTitle?: (title: string) => void
  onPreferences?: (preferences: TtydPreferences) => void
}

export interface TtydPageLocation {
  protocol: string
  host: string
}

export interface TtydUrls {
  tokenUrl: string
  websocketUrl: string
}

export interface TtydClientEnvironment {
  location?: TtydPageLocation
  fetch?: typeof fetch
  createWebSocket?: (url: string, protocols: string[]) => WebSocket
}

// ttyd 1.7.7 uses ASCII command bytes: INPUT is '0' (0x30), not byte 0.
const COMMAND = {
  output: 0x30,
  title: 0x31,
  preferences: 0x32,
  input: 0x30,
  resize: 0x31,
  pause: 0x32,
  resume: 0x33,
} as const

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function createTtydUrls(sessionName: string, page: TtydPageLocation): TtydUrls {
  if (!sessionName) throw new Error('A terminal session name is required')
  const secure = page.protocol === 'https:'
  if (!secure && page.protocol !== 'http:') throw new Error('Unsupported page protocol')
  const httpProtocol = secure ? 'https:' : 'http:'
  const websocketProtocol = secure ? 'wss:' : 'ws:'
  const path = `/terminal/${encodeURIComponent(sessionName)}`
  return {
    tokenUrl: `${httpProtocol}//${page.host}${path}/token`,
    websocketUrl: `${websocketProtocol}//${page.host}${path}/ws`,
  }
}

function plainText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 256)
}

function parsePreferences(bytes: Uint8Array): TtydPreferences | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const source = value as Record<string, unknown>
    const preferences: TtydPreferences = {}
    if (typeof source.titleFixed === 'string') {
      preferences.titleFixed = plainText(source.titleFixed)
    }
    if (source.rendererType === 'dom' || source.rendererType === 'canvas' || source.rendererType === 'webgl') {
      preferences.rendererType = source.rendererType
    }
    return Object.keys(preferences).length > 0 ? preferences : null
  } catch {
    return null
  }
}

function frame(command: number, payload?: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!payload) return Uint8Array.of(command)
  const result = new Uint8Array(payload.length + 1)
  result[0] = command
  result.set(payload, 1)
  return result
}

function pageLocation(): TtydPageLocation {
  if (typeof window === 'undefined') throw new Error('A browser page is required to connect to ttyd')
  return window.location
}

export class TtydClient {
  private generation = 0
  private abortController?: AbortController
  private socket?: WebSocket
  private listeners?: Array<[string, EventListener]>
  private ready = false
  private terminalEventSent = false
  private readonly fetchImpl: typeof fetch
  private readonly socketFactory: (url: string, protocols: string[]) => WebSocket
  private readonly location: TtydPageLocation
  private readonly sessionName: string
  private readonly callbacks: TtydClientCallbacks

  constructor(
    sessionName: string,
    callbacks: TtydClientCallbacks,
    environment: TtydClientEnvironment = {},
  ) {
    this.sessionName = sessionName
    this.callbacks = callbacks
    this.location = environment.location ?? pageLocation()
    this.fetchImpl = environment.fetch ?? fetch.bind(globalThis)
    this.socketFactory = environment.createWebSocket ?? ((url, protocols) => new WebSocket(url, protocols))
  }

  connect(size: TerminalSizeSource): void {
    this.disposeConnection()
    const generation = ++this.generation
    this.terminalEventSent = false
    const abortController = new AbortController()
    this.abortController = abortController
    const urls = createTtydUrls(this.sessionName, this.location)

    void this.fetchImpl(urls.tokenUrl, {
      credentials: 'same-origin',
      signal: abortController.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Token request failed (${response.status})`)
      const value: unknown = await response.json()
      if (typeof value !== 'object' || value === null || typeof (value as { token?: unknown }).token !== 'string') {
        throw new Error('Token response did not include a token')
      }
      if (!this.owns(generation)) return

      const token = (value as { token: string }).token
      const socket = this.socketFactory(urls.websocketUrl, ['tty'])
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      this.attachSocket(socket, generation, size, token)
    }).catch((error: unknown) => {
      if (!this.owns(generation) || abortController.signal.aborted) return
      this.signalTerminalEvent(generation, {
        state: 'error',
        error: error instanceof Error ? error.message : 'Token request failed',
        retryable: true,
      })
    })
  }

  sendInput(data: string | Uint8Array): boolean {
    if (!this.ready) return false
    const payload = typeof data === 'string' ? encoder.encode(data) : data
    return this.send(frame(COMMAND.input, payload))
  }

  resize(columns: number, rows: number): boolean {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) return false
    return this.send(frame(COMMAND.resize, encoder.encode(JSON.stringify({ columns, rows }))))
  }

  pause(): boolean {
    return this.send(frame(COMMAND.pause))
  }

  resume(): boolean {
    return this.send(frame(COMMAND.resume))
  }

  dispose(): void {
    this.generation++
    this.disposeConnection()
  }

  private attachSocket(socket: WebSocket, generation: number, sizeSource: TerminalSizeSource, token: string): void {
    const open: EventListener = () => {
      if (!this.owns(generation) || this.socket !== socket) return
      try {
        const requestedSize = typeof sizeSource === 'function' ? sizeSource() : sizeSource
        const size = {
          columns: Number.isInteger(requestedSize.columns) && requestedSize.columns > 0 ? requestedSize.columns : 80,
          rows: Number.isInteger(requestedSize.rows) && requestedSize.rows > 0 ? requestedSize.rows : 24,
        }
        const handshake = encoder.encode(JSON.stringify({
          AuthToken: token,
          columns: size.columns,
          rows: size.rows,
        }))
        socket.send(handshake)
        this.ready = true
        this.terminalEventSent = false
        this.callbacks.onState?.({ state: 'connected' })
      } catch {
        this.signalTerminalEvent(generation, {
          state: 'error',
          error: 'Unable to send the ttyd handshake',
          retryable: true,
        })
      }
    }
    const message: EventListener = (event) => {
      if (!this.owns(generation) || this.socket !== socket) return
      this.handleMessage((event as MessageEvent<unknown>).data)
    }
    const close: EventListener = (event) => {
      if (!this.owns(generation) || this.socket !== socket) return
      this.ready = false
      const code = (event as CloseEvent).code
      if (!this.terminalEventSent) {
        this.signalTerminalEvent(generation, { state: 'disconnected', retryable: code !== 1000 })
      }
      this.removeSocketListeners(socket)
      this.socket = undefined
    }
    const error: EventListener = () => {
      if (!this.owns(generation) || this.socket !== socket) return
      this.ready = false
      this.signalTerminalEvent(generation, {
        state: 'error',
        error: 'Terminal WebSocket connection failed',
        retryable: true,
      })
    }
    this.listeners = [['open', open], ['message', message], ['close', close], ['error', error]]
    for (const [type, listener] of this.listeners) socket.addEventListener(type, listener)
  }

  private handleMessage(data: unknown): void {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    if (bytes.length === 0) return

    const payload = bytes.subarray(1)
    switch (bytes[0]) {
      case COMMAND.output:
        this.callbacks.onOutput?.(payload)
        break
      case COMMAND.title:
        this.callbacks.onTitle?.(plainText(decoder.decode(payload)))
        break
      case COMMAND.preferences: {
        const preferences = parsePreferences(payload)
        if (preferences) this.callbacks.onPreferences?.(preferences)
        break
      }
      default:
        break
    }
  }

  private send(data: Uint8Array<ArrayBuffer>): boolean {
    const socket = this.socket
    if (!this.ready || !socket || socket.readyState !== 1) return false
    try {
      socket.send(data)
      return true
    } catch {
      return false
    }
  }

  private signalTerminalEvent(generation: number, event: TtydClientEvent): void {
    if (!this.owns(generation) || this.terminalEventSent) return
    this.terminalEventSent = true
    this.callbacks.onState?.(event)
  }

  private owns(generation: number): boolean {
    return generation === this.generation
  }

  private removeSocketListeners(socket: WebSocket): void {
    if (!this.listeners) return
    for (const [type, listener] of this.listeners) socket.removeEventListener(type, listener)
    this.listeners = undefined
  }

  private disposeConnection(): void {
    this.abortController?.abort()
    this.abortController = undefined
    this.ready = false
    const socket = this.socket
    this.socket = undefined
    if (socket) {
      this.removeSocketListeners(socket)
      if (socket.readyState < 2) socket.close(1000, 'Terminal connection disposed')
    }
  }
}
