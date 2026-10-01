import { TtydClient } from './ttyd-client'
import type { TerminalSize, TerminalSizeSource, TtydClientCallbacks, TtydClientEvent, TtydPreferences } from './ttyd-client'

export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'stopped' | 'disposed' | 'error'
export type TerminalClientEvent = TtydClientEvent

export type SessionAvailability =
  | { state: 'running' }
  | { state: 'stopped' }
  | { state: 'missing' }
  | { state: 'unknown' }

export function sessionAvailabilityFromSnapshot(snapshot: unknown, sessionName: string): SessionAvailability {
  if (typeof snapshot !== 'object' || snapshot === null || !('sessions' in snapshot) || !Array.isArray(snapshot.sessions)) {
    return { state: 'unknown' }
  }

  const sessions = snapshot.sessions as unknown[]
  if (sessions.some((session) => typeof session !== 'object' || session === null
    || !('name' in session) || typeof session.name !== 'string'
    || !('status' in session) || typeof session.status !== 'string')) {
    return { state: 'unknown' }
  }

  const session = sessions.find((item) => (item as { name: string }).name === sessionName) as { status: string } | undefined
  if (!session) return { state: 'missing' }
  if (session.status === 'running') return { state: 'running' }
  if (session.status === 'stopped') return { state: 'stopped' }
  return { state: 'unknown' }
}

export interface TerminalLike {
  cols: number
  rows: number
  options: { disableStdin?: boolean }
  open(parent: HTMLElement): void
  focus(): void
  reset(): void
  write(data: Uint8Array, callback?: () => void): void
  dispose(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onBinary(listener: (data: string) => void): { dispose(): void }
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void }
  onTitleChange(listener: (title: string) => void): { dispose(): void }
}

export interface FitAddonLike {
  fit(): void
}

export interface TerminalClient {
  connect(size: TerminalSizeSource): void
  sendInput(data: string | Uint8Array): void
  resize(columns: number, rows: number): void
  pause(): void
  resume(): void
  dispose(): void
}

export interface TerminalClientCallbacks extends TtydClientCallbacks {
  onState: (event: TerminalClientEvent) => void
  onOutput: (data: Uint8Array) => void
}

export interface TerminalControllerOptions {
  sessionName: string
  terminal: TerminalLike
  fitAddon: FitAddonLike
  container: HTMLElement
  checkSessionAvailable: (sessionName: string, signal: AbortSignal) => Promise<SessionAvailability>
  createClient?: (sessionName: string, callbacks: TerminalClientCallbacks) => TerminalClient
  onState?: (state: TerminalStatus, error?: string) => void
  onTitle?: (title: string) => void
  onPreferences?: (preferences: TtydPreferences) => void
}

interface FlowState {
  client: TerminalClient
  written: number
  pending: number
  paused: boolean
}

const FLOW_CONTROL = { limit: 100_000, highWater: 10, lowWater: 4 }
const RETRY_DELAYS = [500, 1_000, 2_000, 4_000, 8_000] as const

export class TerminalController {
  private readonly options: TerminalControllerOptions
  private readonly disposables: Array<{ dispose(): void }> = []
  private client?: TerminalClient
  private flow?: FlowState
  private resizeObserver?: ResizeObserver
  private resizeListener?: () => void
  private retryTimer?: ReturnType<typeof setTimeout>
  private availabilityAbort?: AbortController
  private generation = 0
  private retryAttempt = 0
  private status: TerminalStatus = 'connecting'
  private enabled = true
  private disposed = false
  private everConnected = false

  constructor(options: TerminalControllerOptions) {
    this.options = options
    options.terminal.options.disableStdin = true
    this.installTerminalListeners()
    this.installResizeObserver()
    this.fitIfVisible()
    this.startConnection()
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.generation++
      this.cancelRetry()
      this.flow = undefined
      this.client?.dispose()
      this.client = undefined
      this.options.terminal.options.disableStdin = true
      this.setStatus('disconnected')
      return
    }

    this.retryAttempt = 0
    this.startConnection()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.enabled = false
    this.generation++
    this.cancelRetry()
    this.flow = undefined
    this.client?.dispose()
    this.client = undefined
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
    this.resizeObserver?.disconnect()
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener)
    }
    this.resizeObserver = undefined
    this.resizeListener = undefined
    this.options.terminal.options.disableStdin = true
    this.options.terminal.dispose()
  }

  private installTerminalListeners(): void {
    const { terminal } = this.options
    this.disposables.push(terminal.onData((data) => {
      if (this.status === 'connected') this.client?.sendInput(data)
    }))
    this.disposables.push(terminal.onBinary((data) => {
      if (this.status !== 'connected') return
      const bytes = Uint8Array.from(data, (character) => character.charCodeAt(0) & 0xff)
      this.client?.sendInput(bytes)
    }))
    this.disposables.push(terminal.onResize(({ cols, rows }) => {
      if (this.status === 'connected' && cols > 0 && rows > 0) this.client?.resize(cols, rows)
    }))
    this.disposables.push(terminal.onTitleChange((title) => this.options.onTitle?.(title)))
  }

  private installResizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fitIfVisible())
      this.resizeObserver.observe(this.options.container)
      return
    }
    if (typeof window !== 'undefined') {
      this.resizeListener = () => this.fitIfVisible()
      window.addEventListener('resize', this.resizeListener)
    }
  }

  private fitIfVisible(): void {
    if (this.disposed) return
    const { width, height } = this.options.container.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    this.options.fitAddon.fit()
  }

  private startConnection(): void {
    if (!this.enabled || this.disposed) return
    this.cancelRetry()
    const generation = ++this.generation
    this.flow = undefined
    this.client?.dispose()
    this.options.terminal.options.disableStdin = true
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting')

    let flow: FlowState | undefined
    const callbacks: TerminalClientCallbacks = {
      onState: (event) => {
        if (flow) this.onClientState(generation, flow, event)
      },
      onOutput: (data) => {
        if (flow) this.onOutput(generation, flow, data)
      },
      onTitle: (title) => {
        if (flow && this.owns(generation, flow)) this.options.onTitle?.(title)
      },
      onPreferences: (preferences) => {
        if (flow && this.owns(generation, flow)) this.options.onPreferences?.(preferences)
      },
    }
    const client = this.options.createClient
      ? this.options.createClient(this.options.sessionName, callbacks)
      : new TtydClient(this.options.sessionName, callbacks)
    flow = { client, written: 0, pending: 0, paused: false }
    this.flow = flow
    this.client = client
    client.connect(() => this.initialSize())
  }

  private initialSize(): TerminalSize {
    const { cols, rows } = this.options.terminal
    return {
      columns: Number.isInteger(cols) && cols > 0 ? cols : 80,
      rows: Number.isInteger(rows) && rows > 0 ? rows : 24,
    }
  }

  private onClientState(generation: number, flow: FlowState, event: TerminalClientEvent): void {
    if (!this.owns(generation, flow)) return
    if (event.state === 'connected') {
      if (this.everConnected) this.options.terminal.reset()
      this.everConnected = true
      this.retryAttempt = 0
      this.options.terminal.options.disableStdin = false
      this.setStatus('connected')
      this.fitIfVisible()
      return
    }

    this.options.terminal.options.disableStdin = true
    this.flow = undefined
    if (event.state === 'error') this.setStatus('error', event.error)
    else this.setStatus(event.retryable ? 'reconnecting' : 'disconnected')
    if (event.retryable) this.scheduleReconnect(generation)
  }

  private onOutput(generation: number, flow: FlowState, data: Uint8Array): void {
    if (!this.owns(generation, flow) || this.status !== 'connected') return
    flow.written += data.byteLength
    if (flow.written <= FLOW_CONTROL.limit) {
      this.options.terminal.write(data)
      return
    }

    flow.written = 0
    flow.pending++
    if (!flow.paused && flow.pending > FLOW_CONTROL.highWater) {
      flow.paused = true
      flow.client.pause()
    }
    this.options.terminal.write(data, () => {
      if (!this.owns(generation, flow)) return
      flow.pending = Math.max(flow.pending - 1, 0)
      if (flow.paused && flow.pending < FLOW_CONTROL.lowWater) {
        flow.paused = false
        flow.client.resume()
      }
    })
  }

  private scheduleReconnect(generation: number): void {
    if (!this.enabled || this.disposed || !this.ownsGeneration(generation) || this.retryTimer) return
    const delay = RETRY_DELAYS[Math.min(this.retryAttempt, RETRY_DELAYS.length - 1)]
    this.retryAttempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.verifyThenReconnect(generation)
    }, delay)
  }

  private verifyThenReconnect(generation: number): void {
    if (!this.enabled || this.disposed || !this.ownsGeneration(generation)) return
    const abortController = new AbortController()
    this.availabilityAbort = abortController
    void Promise.resolve().then(() => this.options.checkSessionAvailable(this.options.sessionName, abortController.signal)).then((available) => {
      if (!this.ownsGeneration(generation) || abortController.signal.aborted) return
      this.availabilityAbort = undefined
      switch (available.state) {
        case 'running':
          this.startConnection()
          break
        case 'stopped':
          this.finishUnavailable('stopped')
          break
        case 'missing':
          this.finishUnavailable('disposed')
          break
        case 'unknown':
          this.scheduleReconnect(generation)
          break
      }
    }).catch(() => {
      if (!this.ownsGeneration(generation) || abortController.signal.aborted) return
      this.availabilityAbort = undefined
      this.scheduleReconnect(generation)
    })
  }

  private finishUnavailable(status: 'stopped' | 'disposed'): void {
    if (status === 'disposed') {
      this.destroy()
      this.setStatus(status)
      return
    }

    this.enabled = false
    this.generation++
    this.cancelRetry()
    this.flow = undefined
    this.client?.dispose()
    this.client = undefined
    this.options.terminal.options.disableStdin = true
    this.setStatus(status)
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.availabilityAbort?.abort()
    this.availabilityAbort = undefined
  }

  private owns(generation: number, flow: FlowState): boolean {
    return this.ownsGeneration(generation) && this.flow === flow
  }

  private ownsGeneration(generation: number): boolean {
    return !this.disposed && this.enabled && generation === this.generation
  }

  private setStatus(status: TerminalStatus, error?: string): void {
    this.status = status
    this.options.onState?.(status, error)
  }
}
