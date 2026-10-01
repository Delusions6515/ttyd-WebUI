import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ttydCommand, ttydFrame } from '../../../tests/fixtures/ttyd-frames'
import { TtydClient, createTtydUrls } from './ttyd-client'
import type { TtydClientCallbacks } from './ttyd-client'

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1
  static readonly instances: FakeWebSocket[] = []

  readonly sent: Array<string | ArrayBuffer | ArrayBufferView> = []
  readyState = 0
  binaryType = 'blob'

  readonly url: string
  readonly protocols: string[]

  constructor(url: string, protocols: string[]) {
    super()
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data as string | ArrayBuffer | ArrayBufferView)
  }

  close(code = 1000): void {
    this.readyState = 3
    const event = new Event('close') as CloseEvent
    Object.defineProperty(event, 'code', { value: code })
    this.dispatchEvent(event)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  message(data: ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

function bytesFrom(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function newClient(callbacks: TtydClientCallbacks, fetcher = vi.fn(async () => new Response(JSON.stringify({ token: 'secret-token' })))) {
  const client = new TtydClient('dev_shell', callbacks, {
    location: { protocol: 'https:', host: 'webui.example:8443' },
    fetch: fetcher,
    createWebSocket: (url: string, protocols: string[]) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
  })
  return { client, fetcher }
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createTtydUrls', () => {
  it('uses same-origin token and tty subprotocol paths with the page security scheme', () => {
    expect(createTtydUrls('dev_shell', { protocol: 'https:', host: 'webui.example:8443' })).toEqual({
      tokenUrl: 'https://webui.example:8443/terminal/dev_shell/token',
      websocketUrl: 'wss://webui.example:8443/terminal/dev_shell/ws',
    })
    expect(createTtydUrls('dev_shell', { protocol: 'http:', host: 'localhost:3000' }).websocketUrl).toBe(
      'ws://localhost:3000/terminal/dev_shell/ws',
    )
  })
})

describe('TtydClient', () => {
  it('uses the official ASCII ttyd command bytes in independent fixtures', () => {
    expect(ttydCommand).toEqual({
      output: 0x30,
      title: 0x31,
      preferences: 0x32,
      input: 0x30,
      resize: 0x31,
      pause: 0x32,
      resume: 0x33,
    })
    expect(Array.from(ttydFrame(0x30, 'out'))).toEqual([0x30, 0x6f, 0x75, 0x74])
    expect(Array.from(ttydFrame(0x31, 'title'))[0]).toBe(0x31)
    expect(Array.from(ttydFrame(0x32, '{}'))[0]).toBe(0x32)
  })

  it('fetches a token and sends ttyd authentication and dimensions on the tty subprotocol', async () => {
    const onState = vi.fn()
    const { client, fetcher } = newClient({ onState })
    client.connect({ columns: 97, rows: 31 })
    await flushPromises()

    expect(fetcher).toHaveBeenCalledWith('https://webui.example:8443/terminal/dev_shell/token', expect.objectContaining({
      credentials: 'same-origin',
    }))
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('wss://webui.example:8443/terminal/dev_shell/ws')
    expect(socket.protocols).toEqual(['tty'])
    expect(socket.binaryType).toBe('arraybuffer')
    expect(socket.sent).toHaveLength(0)

    socket.open()
    expect(JSON.parse(new TextDecoder().decode(bytesFrom(socket.sent[0])))).toEqual({
      AuthToken: 'secret-token',
      columns: 97,
      rows: 31,
    })
    expect(onState).toHaveBeenCalledWith({ state: 'connected' })
    client.dispose()
  })

  it('samples a live dimension source when the WebSocket handshake opens', async () => {
    let columns = 80
    let rows = 24
    const { client } = newClient({})
    client.connect(() => ({ columns, rows }))
    await flushPromises()
    columns = 111
    rows = 36
    const socket = FakeWebSocket.instances[0]
    socket.open()

    expect(JSON.parse(new TextDecoder().decode(bytesFrom(socket.sent[0])))).toEqual({
      AuthToken: 'secret-token',
      columns: 111,
      rows: 36,
    })
    client.dispose()
  })

  it('sends UTF-8 input and exact binary bytes only after the ttyd handshake', async () => {
    const { client } = newClient({})
    client.connect({ columns: 80, rows: 24 })
    await flushPromises()
    const socket = FakeWebSocket.instances[0]

    client.sendInput('ASCII 中文🙂')
    expect(socket.sent).toHaveLength(0)

    socket.open()
    const input = 'ASCII 中文🙂'
    client.sendInput(input)
    client.sendInput(new Uint8Array([0x00, 0x7f, 0x80, 0xff]))
    client.resize(123, 45)
    client.resize(0, 45)

    expect(Array.from(bytesFrom(socket.sent[1]))).toEqual([
      0x30,
      ...new TextEncoder().encode(input),
    ])
    expect(Array.from(bytesFrom(socket.sent[2]))).toEqual([0x30, 0x00, 0x7f, 0x80, 0xff])
    expect(Array.from(bytesFrom(socket.sent[3]))).toEqual([0x31, ...new TextEncoder().encode('{"columns":123,"rows":45}')])
    expect(socket.sent).toHaveLength(4)
    client.dispose()
  })

  it('passes output bytes unchanged and sanitizes title and allowlisted preferences', async () => {
    const onOutput = vi.fn()
    const onTitle = vi.fn()
    const onPreferences = vi.fn()
    const { client } = newClient({ onOutput, onTitle, onPreferences })
    client.connect({ columns: 80, rows: 24 })
    await flushPromises()
    const socket = FakeWebSocket.instances[0]
    socket.open()

    const utf8 = new TextEncoder().encode('中文🙂')
    socket.message(ttydFrame(0x30, utf8.subarray(0, 4)).buffer as ArrayBuffer)
    socket.message(ttydFrame(0x30, utf8.subarray(4)).buffer as ArrayBuffer)
    socket.message(ttydFrame(0x31, 'shell\u0000 title').buffer as ArrayBuffer)
    socket.message(ttydFrame(0x32, JSON.stringify({
      titleFixed: '<b>plain text</b>',
      rendererType: 'dom',
      fontFamily: 'attacker-font',
      allowProposedApi: true,
      link: 'javascript:alert(1)',
    })).buffer as ArrayBuffer)

    expect(onOutput.mock.calls.map(([chunk]) => Array.from(chunk as Uint8Array))).toEqual([
      Array.from(utf8.subarray(0, 4)),
      Array.from(utf8.subarray(4)),
    ])
    const streamingDecoder = new TextDecoder()
    const decoded = onOutput.mock.calls.map(([chunk], index) => streamingDecoder.decode(
      chunk as Uint8Array,
      { stream: index < onOutput.mock.calls.length - 1 },
    )).join('')
    expect(decoded).toBe('中文🙂')
    expect(onTitle).toHaveBeenCalledWith('shell title')
    expect(onPreferences).toHaveBeenCalledWith({
      titleFixed: '<b>plain text</b>',
      rendererType: 'dom',
    })
    client.dispose()
  })

  it('ignores a token response that arrives after the client has been disposed', async () => {
    let finishFetch!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finishFetch = resolve }))
    const { client } = newClient({}, fetcher)
    client.connect({ columns: 80, rows: 24 })
    client.dispose()
    finishFetch(new Response(JSON.stringify({ token: 'stale' })))
    await flushPromises()

    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('ignores socket messages after disposal', async () => {
    const onOutput = vi.fn()
    const { client } = newClient({ onOutput })
    client.connect({ columns: 80, rows: 24 })
    await flushPromises()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    client.dispose()
    socket.message(ttydFrame(0x30, new Uint8Array([1, 2, 3])).buffer as ArrayBuffer)

    expect(onOutput).not.toHaveBeenCalled()
  })

  it('sends pause and resume commands without payloads', async () => {
    const { client } = newClient({})
    client.connect({ columns: 80, rows: 24 })
    await flushPromises()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    client.pause()
    client.resume()

    expect(Array.from(bytesFrom(socket.sent[1]))).toEqual([0x32])
    expect(Array.from(bytesFrom(socket.sent[2]))).toEqual([0x33])
    client.dispose()
  })
})
