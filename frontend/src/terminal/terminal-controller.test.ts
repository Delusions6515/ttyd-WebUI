import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionAvailabilityFromSnapshot, TerminalController } from './terminal-controller'
import { TerminalInputController } from './input-controller'
import type {
  FitAddonLike,
  SessionAvailability,
  TerminalClient,
  TerminalClientCallbacks,
  TerminalClientEvent,
  TerminalLike,
} from './terminal-controller'

class FakeTerminal implements TerminalLike {
  cols = 80
  rows = 24
  options = { disableStdin: true }
  modes = { applicationCursorKeysMode: false }
  writes: Uint8Array[] = []
  pendingWrites: Array<() => void> = []
  disposed = false
  resetCount = 0
  private dataListeners = new Set<(data: string) => void>()
  private binaryListeners = new Set<(data: string) => void>()
  private resizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
  private titleListeners = new Set<(title: string) => void>()

  open(): void {}
  focus(): void {}
  reset(): void { this.resetCount++ }
  dispose(): void { this.disposed = true }

  write(data: Uint8Array, callback?: () => void): void {
    this.writes.push(new Uint8Array(data))
    if (callback) this.pendingWrites.push(callback)
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onBinary(listener: (data: string) => void): { dispose(): void } {
    this.binaryListeners.add(listener)
    return { dispose: () => this.binaryListeners.delete(listener) }
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void } {
    this.resizeListeners.add(listener)
    return { dispose: () => this.resizeListeners.delete(listener) }
  }

  onTitleChange(listener: (title: string) => void): { dispose(): void } {
    this.titleListeners.add(listener)
    return { dispose: () => this.titleListeners.delete(listener) }
  }

  emitData(data: string): void { for (const listener of this.dataListeners) listener(data) }
  emitBinary(data: string): void { for (const listener of this.binaryListeners) listener(data) }
  emitResize(cols: number, rows: number): void { for (const listener of this.resizeListeners) listener({ cols, rows }) }
}

class FakeFitAddon implements FitAddonLike {
  fitCount = 0
  onFit?: () => void
  fit(): void {
    this.fitCount++
    this.onFit?.()
  }
}

class FakeClient implements TerminalClient {
  sizeSource?: { columns: number; rows: number } | (() => { columns: number; rows: number })
  handshakeSize?: { columns: number; rows: number }
  sentInputs: Array<string | Uint8Array> = []
  sizes: Array<{ columns: number; rows: number }> = []
  pauseCount = 0
  resumeCount = 0
  disposed = false

  readonly callbacks: TerminalClientCallbacks

  constructor(callbacks: TerminalClientCallbacks) {
    this.callbacks = callbacks
  }

  connect(size: { columns: number; rows: number } | (() => { columns: number; rows: number })): void { this.sizeSource = size }
  sendInput(data: string | Uint8Array): boolean { this.sentInputs.push(data); return true }
  resize(columns: number, rows: number): void { this.sizes.push({ columns, rows }) }
  pause(): void { this.pauseCount++ }
  resume(): void { this.resumeCount++ }
  dispose(): void { this.disposed = true }
  event(event: TerminalClientEvent): void {
    if (event.state === 'connected' && this.sizeSource) {
      this.handshakeSize = typeof this.sizeSource === 'function' ? this.sizeSource() : this.sizeSource
    }
    this.callbacks.onState(event)
  }
  output(data: Uint8Array): void { this.callbacks.onOutput(data) }
}

function makeHarness(options: {
  available?: (sessionName: string, signal: AbortSignal) => Promise<SessionAvailability>
  rect?: { width: number; height: number }
  size?: { cols: number; rows: number }
  onState?: (state: string, error?: string) => void
} = {}) {
  const terminal = new FakeTerminal()
  if (options.size) {
    terminal.cols = options.size.cols
    terminal.rows = options.size.rows
  }
  const fitAddon = new FakeFitAddon()
  const clients: FakeClient[] = []
  const available = options.available ?? vi.fn(async () => ({ state: 'running' as const }))
  const container = {
    getBoundingClientRect: () => options.rect ?? { width: 600, height: 400 },
  }
  const controller = new TerminalController({
    sessionName: 'dev_shell',
    terminal,
    fitAddon,
    container: container as HTMLElement,
    checkSessionAvailable: available,
    onState: options.onState,
    createClient: (_name: string, callbacks: TerminalClientCallbacks) => {
      const client = new FakeClient(callbacks)
      clients.push(client)
      return client
    },
  })
  return { controller, terminal, fitAddon, clients, available }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalController', () => {
  it('classifies only complete session snapshots as running, stopped, or missing', () => {
    expect(sessionAvailabilityFromSnapshot({ sessions: [{ name: 'dev_shell', status: 'running' }] }, 'dev_shell'))
      .toEqual({ state: 'running' })
    expect(sessionAvailabilityFromSnapshot({ sessions: [{ name: 'dev_shell', status: 'stopped' }] }, 'dev_shell'))
      .toEqual({ state: 'stopped' })
    expect(sessionAvailabilityFromSnapshot({ sessions: [] }, 'dev_shell')).toEqual({ state: 'missing' })
    expect(sessionAvailabilityFromSnapshot({ sessions: [{ name: 'dev_shell', status: 'starting' }] }, 'dev_shell'))
      .toEqual({ state: 'unknown' })
    expect(sessionAvailabilityFromSnapshot({ sessions: [{ name: 'other' }] }, 'dev_shell'))
      .toEqual({ state: 'unknown' })
    expect(sessionAvailabilityFromSnapshot({ error: 'unavailable' }, 'dev_shell')).toEqual({ state: 'unknown' })
  })

  it('connects with live dimensions and drops input whenever no current connection is ready', () => {
    const { controller, terminal, clients } = makeHarness()
    expect(typeof clients[0].sizeSource).toBe('function')
    expect(terminal.options.disableStdin).toBe(true)

    terminal.emitData('discarded')
    clients[0].event({ state: 'connected' })
    expect(clients[0].handshakeSize).toEqual({ columns: 80, rows: 24 })
    expect(terminal.options.disableStdin).toBe(false)
    terminal.emitData('ASCII 中文🙂')
    terminal.emitBinary('\u0000\u00ff')
    expect(clients[0].sentInputs).toEqual(['ASCII 中文🙂', new Uint8Array([0, 255])])

    clients[0].event({ state: 'disconnected', retryable: false })
    expect(terminal.options.disableStdin).toBe(true)
    terminal.emitData('not queued')
    expect(clients[0].sentInputs).toHaveLength(2)
    controller.destroy()
  })

  it('routes virtual keys through the live connection without rewriting xterm hardware or protocol input', () => {
    const { controller, terminal, clients } = makeHarness()
    const input = new TerminalInputController({
      sendInput: (data) => controller.sendVirtualInput(data),
      getApplicationCursorKeysMode: () => controller.applicationCursorKeysMode,
    })
    const client = clients[0]
    expect(controller.sendVirtualInput('before ready')).toBe(false)
    client.event({ state: 'connected' })

    input.toggleModifier('ctrl')
    terminal.emitData('\u0003')
    terminal.emitData('\u001b[?1;2$y')
    expect(input.modifiers.ctrl).toBe('once')
    expect(client.sentInputs).toEqual(['\u0003', '\u001b[?1;2$y'])
    expect(input.submitText('c')).toBe(true)
    expect(client.sentInputs).toEqual(['\u0003', '\u001b[?1;2$y', '\u0003'])
    expect(input.modifiers.ctrl).toBe('off')

    terminal.modes.applicationCursorKeysMode = true
    expect(input.pressKey('UP')).toBe(true)
    expect(client.sentInputs.at(-1)).toBe('\u001bOA')
    client.event({ state: 'disconnected', retryable: false })
    expect(controller.sendVirtualInput('not queued')).toBe(false)
    input.destroy()
    controller.destroy()
  })

  it('sends non-zero resizes and skips fitting a hidden zero-size container', () => {
    const { controller, terminal, fitAddon, clients } = makeHarness({
      rect: { width: 0, height: 0 },
      size: { cols: 0, rows: 0 },
    })
    expect(fitAddon.fitCount).toBe(0)
    clients[0].event({ state: 'connected' })
    expect(clients[0].handshakeSize).toEqual({ columns: 80, rows: 24 })
    terminal.emitResize(0, 20)
    terminal.emitResize(100, 30)
    expect(clients[0].sizes).toEqual([{ columns: 100, rows: 30 }])
    controller.destroy()
  })

  it('pauses after high-water writes and resumes only below the low-water mark', () => {
    const { controller, clients, terminal } = makeHarness()
    const client = clients[0]
    client.event({ state: 'connected' })

    for (let index = 0; index < 11; index++) client.output(new Uint8Array(100_001))
    expect(terminal.pendingWrites).toHaveLength(11)
    expect(client.pauseCount).toBe(1)
    expect(client.resumeCount).toBe(0)

    for (let index = 0; index < 7; index++) terminal.pendingWrites[index]()
    expect(client.resumeCount).toBe(0)
    terminal.pendingWrites[7]()
    expect(client.resumeCount).toBe(1)
    terminal.pendingWrites[8]()
    expect(client.resumeCount).toBe(1)
    controller.destroy()
  })

  it('checks the management snapshot before reconnecting and resets rendered state on reconnect', async () => {
    vi.useFakeTimers()
    const available = vi.fn(async () => ({ state: 'running' as const }))
    const { controller, clients, terminal } = makeHarness({ available })
    clients[0].event({ state: 'connected' })
    clients[0].event({ state: 'disconnected', retryable: true })
    expect(clients).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    expect(available).toHaveBeenCalledWith('dev_shell', expect.any(AbortSignal))
    expect(clients).toHaveLength(2)
    clients[1].event({ state: 'connected' })
    expect(terminal.resetCount).toBe(1)
    controller.destroy()
  })

  it('irreversibly disposes a snapshot-confirmed missing target and ignores late ownership attempts', async () => {
    vi.useFakeTimers()
    const onState = vi.fn()
    const available = vi.fn(async () => ({ state: 'missing' as const }))
    const { controller, terminal, fitAddon, clients } = makeHarness({ available, onState })
    const client = clients[0]
    client.event({ state: 'disconnected', retryable: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(client.disposed).toBe(true)
    expect(terminal.options.disableStdin).toBe(true)
    expect(onState).toHaveBeenLastCalledWith('disposed', undefined)
    expect(terminal.disposed).toBe(true)
    const stateCallCount = onState.mock.calls.length
    const fitCount = fitAddon.fitCount

    controller.setEnabled(true)
    await vi.advanceTimersByTimeAsync(30_000)
    client.event({ state: 'connected' })
    client.output(new Uint8Array([1, 2, 3]))
    terminal.emitData('must not be sent')
    terminal.emitResize(130, 45)

    expect(clients).toHaveLength(1)
    expect(client.sentInputs).toHaveLength(0)
    expect(terminal.writes).toHaveLength(0)
    expect(terminal.options.disableStdin).toBe(true)
    expect(onState).toHaveBeenCalledTimes(stateCallCount)
    expect(fitAddon.fitCount).toBe(fitCount)
    controller.destroy()
  })

  it('marks a snapshot-confirmed stopped target stopped without retrying', async () => {
    vi.useFakeTimers()
    const onState = vi.fn()
    const available = vi.fn(async () => ({ state: 'stopped' as const }))
    const { controller, terminal, clients } = makeHarness({ available, onState })
    clients[0].event({ state: 'disconnected', retryable: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(terminal.options.disableStdin).toBe(true)
    expect(terminal.disposed).toBe(false)
    expect(onState).toHaveBeenLastCalledWith('stopped', undefined)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(available).toHaveBeenCalledTimes(1)
    expect(clients).toHaveLength(1)

    controller.setEnabled(true)
    expect(clients).toHaveLength(2)
    clients[1].event({ state: 'connected' })
    terminal.emitData('explicit restart')
    expect(clients[1].sentInputs).toEqual(['explicit restart'])
    controller.destroy()
  })

  it('retries transient management-check failures with bounded backoff without assuming deletion', async () => {
    vi.useFakeTimers()
    let checks = 0
    const available = vi.fn(async (): Promise<SessionAvailability> => {
      checks++
      if (checks === 1) throw new Error('Temporary network failure')
      return { state: 'running' }
    })
    const { controller, clients } = makeHarness({ available })
    clients[0].event({ state: 'disconnected', retryable: true })

    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    expect(available).toHaveBeenCalledTimes(1)
    expect(clients).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(available).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(available).toHaveBeenCalledTimes(2)
    expect(clients).toHaveLength(2)
    controller.destroy()
  })

  it('ignores a late availability result after disposal', async () => {
    vi.useFakeTimers()
    let resolveAvailability!: (result: SessionAvailability) => void
    const available = vi.fn(() => new Promise<SessionAvailability>((resolve) => { resolveAvailability = resolve }))
    const onState = vi.fn()
    const { controller, clients, terminal } = makeHarness({ available, onState })
    clients[0].event({ state: 'disconnected', retryable: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(available).toHaveBeenCalledTimes(1)

    controller.destroy()
    resolveAvailability({ state: 'missing' })
    await flushPromises()
    expect(onState).not.toHaveBeenCalledWith('disposed', undefined)
    expect(clients).toHaveLength(1)
    expect(terminal.disposed).toBe(true)
  })

  it('uses dimensions current at handshake and refits after reconnect reset', async () => {
    vi.useFakeTimers()
    const available = vi.fn(async () => ({ state: 'running' as const }))
    const { controller, terminal, fitAddon, clients } = makeHarness({ available })
    clients[0].event({ state: 'connected' })
    expect(clients[0].handshakeSize).toEqual({ columns: 80, rows: 24 })
    const fitCountAfterFirstConnection = fitAddon.fitCount
    clients[0].event({ state: 'disconnected', retryable: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    terminal.cols = 101
    terminal.rows = 35
    fitAddon.onFit = () => {
      expect(terminal.resetCount).toBe(1)
      terminal.cols = 120
      terminal.rows = 40
      terminal.emitResize(120, 40)
    }
    clients[1].event({ state: 'connected' })

    expect(clients[1].handshakeSize).toEqual({ columns: 101, rows: 35 })
    expect(clients[1].sizes).toEqual([{ columns: 120, rows: 40 }])
    expect(fitAddon.fitCount).toBe(fitCountAfterFirstConnection + 1)
    controller.destroy()
  })

  it('cancels retry work when the selected session is deliberately disabled', async () => {
    vi.useFakeTimers()
    const { controller, clients, available } = makeHarness()
    clients[0].event({ state: 'disconnected', retryable: true })
    controller.setEnabled(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(available).not.toHaveBeenCalled()
    expect(clients).toHaveLength(1)
    controller.destroy()
  })

  it('keeps retry timers and late callbacks owned by the old controller', async () => {
    vi.useFakeTimers()
    const onState = vi.fn()
    const { controller, terminal, clients, available } = makeHarness({ onState })
    const firstClient = clients[0]
    firstClient.event({ state: 'disconnected', retryable: true })
    controller.destroy()
    firstClient.output(new Uint8Array([1, 2, 3]))
    firstClient.event({ state: 'connected' })
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()

    expect(terminal.writes).toHaveLength(0)
    expect(terminal.options.disableStdin).toBe(true)
    expect(terminal.disposed).toBe(true)
    expect(clients).toHaveLength(1)
    expect(available).not.toHaveBeenCalled()
  })

  it('does not retry normal closes and waits for a running management snapshot after an abnormal close', async () => {
    vi.useFakeTimers()
    const normal = makeHarness()
    normal.clients[0].event({ state: 'disconnected', retryable: false })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(normal.clients).toHaveLength(1)
    expect(normal.available).not.toHaveBeenCalled()
    normal.controller.destroy()

    const available = vi.fn(async () => ({ state: 'missing' as const }))
    const recovering = makeHarness({ available })
    recovering.clients[0].event({ state: 'disconnected', retryable: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    expect(available).toHaveBeenCalledTimes(1)
    expect(recovering.clients).toHaveLength(1)
    recovering.controller.destroy()
  })
})
