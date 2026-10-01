import { reactive } from 'vue'
import { sessionApi } from '../api/sessions'
import type { SessionApi } from '../api/sessions'
import type { Session, SessionAction, Shell } from '../types/session'

interface NotificationSocket {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close(): void
}

export interface SessionStoreState {
  sessions: Session[]
  shells: Shell[]
  loading: boolean
  shellsLoading: boolean
  creating: boolean
  error: string
  shellError: string
  notificationError: string
  selectedName: string | null
  pendingActions: Partial<Record<string, SessionAction>>
}

export interface SessionStoreOptions {
  api?: SessionApi
  createWebSocket?: () => NotificationSocket
}

const RECONNECT_DELAYS = [500, 1_000, 2_000, 4_000, 8_000] as const
const NOTIFICATION_EVENTS = new Set(['session:created', 'session:stopped', 'session:deleted', 'session:exited'])

function createBrowserWebSocket(): NotificationSocket {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${scheme}//${window.location.host}/ws`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSessionStore(options: SessionStoreOptions = {}) {
  const api = options.api ?? sessionApi
  const makeWebSocket = options.createWebSocket ?? createBrowserWebSocket
  const state = reactive<SessionStoreState>({
    sessions: [],
    shells: [],
    loading: false,
    shellsLoading: false,
    creating: false,
    error: '',
    shellError: '',
    notificationError: '',
    selectedName: null,
    pendingActions: Object.create(null) as Partial<Record<string, SessionAction>>,
  })
  let listRequestId = 0
  let shellRequestId = 0
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let socket: NotificationSocket | undefined
  let started = false
  let destroyed = false
  let selectionIntent = 0
  let createOperationId = 0

  async function refresh(): Promise<boolean> {
    if (destroyed) return false
    const requestId = ++listRequestId
    state.loading = true
    try {
      const sessions = await api.getSessions()
      if (destroyed || requestId !== listRequestId) return false
      state.sessions = sessions
      state.error = ''
      if (state.selectedName && !sessions.some(({ name }) => name === state.selectedName)) {
        state.selectedName = null
      }
      return true
    } catch (error) {
      if (!destroyed && requestId === listRequestId) state.error = errorMessage(error)
      return false
    } finally {
      if (!destroyed && requestId === listRequestId) state.loading = false
    }
  }

  async function refreshShells(): Promise<boolean> {
    if (destroyed) return false
    const requestId = ++shellRequestId
    state.shellsLoading = true
    try {
      const shells = await api.getShells()
      if (destroyed || requestId !== shellRequestId) return false
      state.shells = shells
      state.shellError = ''
      return true
    } catch (error) {
      if (!destroyed && requestId === shellRequestId) state.shellError = errorMessage(error)
      return false
    } finally {
      if (!destroyed && requestId === shellRequestId) state.shellsLoading = false
    }
  }

  function scheduleReconnect(): void {
    if (destroyed || !started || retryTimer) return
    const delay = RECONNECT_DELAYS[Math.min(retryAttempt, RECONNECT_DELAYS.length - 1)]
    retryAttempt++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      openNotifications()
    }, delay)
  }

  function openNotifications(): void {
    if (destroyed || !started) return
    let nextSocket: NotificationSocket
    try {
      nextSocket = makeWebSocket()
    } catch (error) {
      state.notificationError = `Session updates unavailable: ${errorMessage(error)}`
      scheduleReconnect()
      return
    }
    socket = nextSocket
    nextSocket.onopen = () => {
      if (destroyed || socket !== nextSocket) return
      retryAttempt = 0
      state.notificationError = ''
      void refresh()
    }
    nextSocket.onmessage = (event) => {
      if (destroyed || socket !== nextSocket) return
      try {
        const message: unknown = JSON.parse(String(event.data))
        if (typeof message === 'object' && message !== null && 'event' in message
          && typeof message.event === 'string' && NOTIFICATION_EVENTS.has(message.event)) {
          void refresh()
        }
      } catch {
        state.notificationError = 'Received an invalid session update; waiting for the next update.'
      }
    }
    nextSocket.onerror = () => {
      if (!destroyed && socket === nextSocket) state.notificationError = 'Session updates disconnected; reconnecting.'
    }
    nextSocket.onclose = () => {
      if (destroyed || socket !== nextSocket) return
      socket = undefined
      state.notificationError = 'Session updates disconnected; reconnecting.'
      scheduleReconnect()
    }
  }

  function start(): void {
    if (started || destroyed) return
    started = true
    void refresh()
    void refreshShells()
    openNotifications()
  }

  function selectSession(name: string | null): void {
    if (destroyed) return
    if (name === null) {
      selectionIntent++
      state.selectedName = null
      return
    }
    if (state.sessions.some((session) => session.name === name)) {
      selectionIntent++
      state.selectedName = name
    }
  }

  async function createSession(name: string, shell: string): Promise<boolean> {
    if (destroyed || state.creating) return false
    state.creating = true
    state.error = ''
    const operationId = ++createOperationId
    const selectionIntentAtStart = selectionIntent
    try {
      const created = await api.createSession(name, shell)
      if (destroyed || operationId !== createOperationId) return true

      await refresh()
      if (destroyed || operationId !== createOperationId) return true
      if (!state.sessions.some(({ name: sessionName }) => sessionName === created.name)) {
        await refresh()
      }
      if (destroyed || operationId !== createOperationId) return true
      if (selectionIntent === selectionIntentAtStart
        && state.sessions.some(({ name: sessionName }) => sessionName === created.name)) {
        state.selectedName = created.name
      }
      return true
    } catch (error) {
      if (!destroyed && operationId === createOperationId) state.error = errorMessage(error)
      return false
    } finally {
      if (!destroyed && operationId === createOperationId) state.creating = false
    }
  }

  async function runAction(name: string, action: SessionAction, operation: () => Promise<unknown>): Promise<boolean> {
    if (destroyed || Object.hasOwn(state.pendingActions, name)) return false
    state.pendingActions[name] = action
    state.error = ''
    try {
      await operation()
      if (destroyed) return true
      if (action === 'delete' && state.selectedName === name) state.selectedName = null
      await refresh()
      return true
    } catch (error) {
      const failure = errorMessage(error)
      if (!destroyed) {
        await refresh()
        if (!destroyed) state.error = failure
      }
      return false
    } finally {
      if (!destroyed) delete state.pendingActions[name]
    }
  }

  function stopSession(name: string): Promise<boolean> {
    return runAction(name, 'stop', () => api.stopSession(name))
  }

  function restartSession(name: string): Promise<boolean> {
    return runAction(name, 'restart', () => api.restartSession(name))
  }

  function deleteSession(name: string): Promise<boolean> {
    return runAction(name, 'delete', () => api.deleteSession(name))
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    createOperationId++
    listRequestId++
    shellRequestId++
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    const closingSocket = socket
    socket = undefined
    if (closingSocket) {
      closingSocket.onopen = null
      closingSocket.onmessage = null
      closingSocket.onerror = null
      closingSocket.onclose = null
      closingSocket.close()
    }
  }

  return {
    state,
    start,
    refresh,
    refreshShells,
    selectSession,
    createSession,
    stopSession,
    restartSession,
    deleteSession,
    destroy,
  }
}
