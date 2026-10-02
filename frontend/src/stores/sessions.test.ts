import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './sessions'
import type { SessionApi } from '../api/sessions'
import type { Session } from '../types/session'

function session(name: string, status: Session['status'] = 'running'): Session {
  return { name, shell: 'bash', status, port: status === 'running' ? 7681 : null, pid: null, createdAt: '2026-10-01T00:00:00.000Z' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function makeApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    getSessions: vi.fn(async () => []),
    getShells: vi.fn(async () => [{ id: 'bash', name: 'Bash' }]),
    createSession: vi.fn(async (name, shell) => session(name || `${shell}-1`)),
    stopSession: vi.fn(async (name) => session(name, 'stopped')),
    restartSession: vi.fn(async (name) => session(name)),
    scrollSession: vi.fn(async (name) => session(name)),
    deleteSession: vi.fn(async (name) => ({ name })),
    ...overrides,
  }
}

class FakeSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  close = vi.fn()
  open(): void { this.onopen?.(new Event('open')) }
  closeConnection(): void { this.onclose?.(new CloseEvent('close')) }
  notify(event: string): void {
    this.onmessage?.({ data: JSON.stringify({ event, data: {} }) } as MessageEvent)
  }
}

afterEach(() => vi.useRealTimers())

describe('session store', () => {
  it('ignores stale list responses and clears a selected session only when a snapshot confirms it is missing', async () => {
    const first = deferred<Session[]>()
    const second = deferred<Session[]>()
    const api = makeApi({ getSessions: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue([]) })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = [session('alpha')]
    store.selectSession('alpha')

    const oldRequest = store.refresh()
    const newRequest = store.refresh()
    second.resolve([session('alpha')])
    await newRequest
    first.resolve([])
    await oldRequest
    expect(store.state.sessions.map(({ name }) => name)).toEqual(['alpha'])
    expect(store.state.selectedName).toBe('alpha')

    await store.refresh()
    expect(store.state.selectedName).toBeNull()
    store.destroy()
  })

  it('refreshes from notifications and immediately after a notification socket reconnects', async () => {
    vi.useFakeTimers()
    const api = makeApi()
    const sockets: FakeSocket[] = []
    const store = createSessionStore({
      api,
      createWebSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    store.start()
    await Promise.resolve()
    sockets[0].open()
    await Promise.resolve()
    expect(api.getSessions).toHaveBeenCalledTimes(2)
    sockets[0].notify('session:created')
    await Promise.resolve()
    expect(api.getSessions).toHaveBeenCalledTimes(3)

    sockets[0].closeConnection()
    await vi.advanceTimersByTimeAsync(500)
    sockets[1].open()
    await Promise.resolve()
    expect(api.getSessions).toHaveBeenCalledTimes(4)
    expect(store.state.notificationError).toBe('')
    store.destroy()
  })

  it('keeps operation pending state separate and selects a created session only after list refresh', async () => {
    const pending = deferred<Session>()
    const api = makeApi({
      getSessions: vi.fn(async () => [session('bash-1')]),
      createSession: vi.fn(() => pending.promise),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = []
    const create = store.createSession('', 'bash')
    expect(store.state.creating).toBe(true)
    pending.resolve(session('bash-1'))
    await create
    expect(store.state.sessions).toEqual([session('bash-1')])
    expect(store.state.selectedName).toBe('bash-1')
    expect(store.state.creating).toBe(false)
    store.destroy()
  })

  it('routes stop, resume and deletion independently and reconciles the selected session from snapshots', async () => {
    let currentSessions = [session('alpha')]
    const api = makeApi({
      getSessions: vi.fn(async () => currentSessions),
      stopSession: vi.fn(async (name) => {
        currentSessions = [session(name, 'stopped')]
        return session(name, 'stopped')
      }),
      restartSession: vi.fn(async (name) => {
        currentSessions = [session(name)]
        return session(name)
      }),
      deleteSession: vi.fn(async (name) => {
        currentSessions = []
        return { name }
      }),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = currentSessions
    store.selectSession('alpha')

    expect(await store.stopSession('alpha')).toBe(true)
    expect(store.state.sessions[0].status).toBe('stopped')
    expect(await store.restartSession('alpha')).toBe(true)
    expect(store.state.sessions[0].status).toBe('running')
    expect(await store.deleteSession('alpha')).toBe(true)
    expect(store.state.sessions).toEqual([])
    expect(store.state.selectedName).toBeNull()
    expect(api.stopSession).toHaveBeenCalledWith('alpha')
    expect(api.restartSession).toHaveBeenCalledWith('alpha')
    expect(api.deleteSession).toHaveBeenCalledWith('alpha')
    store.destroy()
  })

  it('refreshes stopped state after a failed deletion while retaining the deletion error', async () => {
    const api = makeApi({
      getSessions: vi.fn(async () => [session('alpha', 'stopped')]),
      deleteSession: vi.fn(async () => { throw new Error('permission denied') }),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = [session('alpha')]
    store.selectSession('alpha')
    expect(await store.deleteSession('alpha')).toBe(false)
    expect(store.state.sessions[0]?.status).toBe('stopped')
    expect(store.state.selectedName).toBe('alpha')
    expect(store.state.error).toBe('permission denied')
    expect(Object.hasOwn(store.state.pendingActions, 'alpha')).toBe(false)
    store.destroy()
  })

  it('selects a successfully created session when a newer snapshot supersedes its own refresh', async () => {
    const createResponse = deferred<Session>()
    const createRefresh = deferred<Session[]>()
    const newerRefresh = deferred<Session[]>()
    const api = makeApi({
      createSession: vi.fn(() => createResponse.promise),
      getSessions: vi.fn().mockReturnValueOnce(createRefresh.promise).mockReturnValueOnce(newerRefresh.promise),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })

    const creating = store.createSession('', 'bash')
    createResponse.resolve(session('bash-1'))
    await Promise.resolve()
    const manualRefresh = store.refresh()
    newerRefresh.resolve([session('bash-1')])
    await manualRefresh
    createRefresh.resolve([session('stale')])

    expect(await creating).toBe(true)
    expect(store.state.sessions.map(({ name }) => name)).toEqual(['bash-1'])
    expect(store.state.selectedName).toBe('bash-1')
    store.destroy()
  })

  it('does not take selection from a session the user explicitly chose while creation was pending', async () => {
    const createResponse = deferred<Session>()
    const listResponse = deferred<Session[]>()
    const api = makeApi({
      createSession: vi.fn(() => createResponse.promise),
      getSessions: vi.fn().mockReturnValueOnce(listResponse.promise),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = [session('alpha'), session('beta')]
    store.selectSession('alpha')

    const creating = store.createSession('', 'bash')
    createResponse.resolve(session('bash-1'))
    await Promise.resolve()
    store.selectSession('beta')
    listResponse.resolve([session('alpha'), session('beta'), session('bash-1')])

    expect(await creating).toBe(true)
    expect(store.state.selectedName).toBe('beta')
    store.destroy()
  })

  it('does not resurrect a created session after a newer snapshot confirms its deletion', async () => {
    const api = makeApi({
      getSessions: vi.fn().mockResolvedValueOnce([session('bash-1')]).mockResolvedValueOnce([]),
      createSession: vi.fn(async () => session('bash-1')),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })

    expect(await store.createSession('', 'bash')).toBe(true)
    expect(store.state.selectedName).toBe('bash-1')
    await store.refresh()
    expect(store.state.sessions).toEqual([])
    expect(store.state.selectedName).toBeNull()
    store.destroy()
  })

  it('uses a notification refresh newer than creation instead of rejecting a successfully created session', async () => {
    const createResponse = deferred<Session>()
    const ownRefresh = deferred<Session[]>()
    const notificationRefresh = deferred<Session[]>()
    let socket: FakeSocket | undefined
    let requestCount = 0
    const api = makeApi({
      createSession: vi.fn(() => createResponse.promise),
      getSessions: vi.fn(() => {
        requestCount++
        if (requestCount === 3) return ownRefresh.promise
        if (requestCount === 4) return notificationRefresh.promise
        return Promise.resolve([])
      }),
    })
    const store = createSessionStore({
      api,
      createWebSocket: () => {
        socket = new FakeSocket()
        return socket
      },
    })
    store.start()
    await Promise.resolve()
    socket?.open()
    await Promise.resolve()

    const creating = store.createSession('', 'bash')
    createResponse.resolve(session('bash-1'))
    await Promise.resolve()
    socket?.notify('session:created')
    notificationRefresh.resolve([session('bash-1')])
    await Promise.resolve()
    ownRefresh.resolve([session('stale')])

    expect(await creating).toBe(true)
    expect(store.state.sessions.map(({ name }) => name)).toEqual(['bash-1'])
    expect(store.state.selectedName).toBe('bash-1')
    store.destroy()
  })

  it('does not mutate state from create or lifecycle responses after destruction', async () => {
    const createResponse = deferred<Session>()
    const stopResponse = deferred<Session>()
    const api = makeApi({
      createSession: vi.fn(() => createResponse.promise),
      stopSession: vi.fn(() => stopResponse.promise),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    const creating = store.createSession('alpha', 'bash')
    store.destroy()
    store.state.error = 'destroyed sentinel'
    createResponse.resolve(session('alpha'))
    await creating
    expect(store.state.error).toBe('destroyed sentinel')
    expect(api.getSessions).not.toHaveBeenCalled()

    const actionStore = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    actionStore.state.sessions = [session('alpha')]
    const stopping = actionStore.stopSession('alpha')
    actionStore.destroy()
    actionStore.state.error = 'destroyed action sentinel'
    stopResponse.resolve(session('alpha', 'stopped'))
    await stopping
    expect(actionStore.state.error).toBe('destroyed action sentinel')
    expect(actionStore.state.pendingActions.alpha).toBe('stop')
    expect(api.getSessions).not.toHaveBeenCalled()
  })

  it.each(['constructor', 'toString', '__proto__'])('handles legal prototype-like session name %s as an ordinary action key', async (name) => {
    const pending = deferred<Session>()
    const api = makeApi({
      getSessions: vi.fn(async () => [session(name)]),
      stopSession: vi.fn(() => pending.promise),
    })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    store.state.sessions = [session(name)]

    const stopping = store.stopSession(name)
    expect(api.stopSession).toHaveBeenCalledWith(name)
    expect(store.state.pendingActions[name]).toBe('stop')
    pending.resolve(session(name, 'stopped'))
    expect(await stopping).toBe(true)
    expect(store.state.pendingActions[name]).toBeUndefined()
    store.destroy()
  })

  it('keeps a failed operation visible and cancellation is left to the UI without calling the API', async () => {
    const api = makeApi({ stopSession: vi.fn().mockRejectedValue(new Error('permission denied')) })
    const store = createSessionStore({ api, createWebSocket: () => new FakeSocket() })
    await store.stopSession('alpha')
    expect(store.state.error).toContain('permission denied')
    expect(store.state.pendingActions.alpha).toBeUndefined()
    expect(api.deleteSession).not.toHaveBeenCalled()
    store.destroy()
  })
})
