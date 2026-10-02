import type { Session, SessionStatus, Shell } from '../types/session'

export type ScrollDirection = 'up' | 'down' | 'bottom'

export interface SessionApi {
  getSessions(): Promise<Session[]>
  getShells(): Promise<Shell[]>
  createSession(name: string, shell: string): Promise<Session>
  stopSession(name: string): Promise<Session>
  restartSession(name: string): Promise<Session>
  scrollSession(name: string, direction: ScrollDirection, lines?: number): Promise<Session>
  deleteSession(name: string): Promise<{ name: string }>
}

const SESSION_STATUSES = new Set<SessionStatus>(['starting', 'running', 'stopping', 'stopped'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false
  return typeof value.name === 'string' && value.name.length > 0
    && (value.shell === null || typeof value.shell === 'string')
    && typeof value.status === 'string' && SESSION_STATUSES.has(value.status as SessionStatus)
    && (value.port === null || (Number.isInteger(value.port) && (value.port as number) > 0))
    && (value.pid === null || (Number.isInteger(value.pid) && (value.pid as number) > 0))
    && typeof value.createdAt === 'string' && value.createdAt.length > 0
}

function parseSession(value: unknown, label = 'session'): Session {
  if (!isSession(value)) throw new Error(`Invalid ${label} response`)
  return value
}

function parseSessionList(value: unknown): Session[] {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !value.sessions.every(isSession)) {
    throw new Error('Invalid sessions response')
  }
  return value.sessions
}

function parseShellList(value: unknown): Shell[] {
  if (!isRecord(value) || !Array.isArray(value.shells)
    || !value.shells.every((shell) => isRecord(shell)
      && typeof shell.id === 'string' && shell.id.length > 0
      && typeof shell.name === 'string' && shell.name.length > 0)) {
    throw new Error('Invalid shells response')
  }
  return value.shells.map((shell) => ({ id: shell.id as string, name: shell.name as string }))
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return body
}

function parseDeletedSession(value: unknown, expectedName: string): { name: string } {
  if (!isRecord(value) || value.name !== expectedName) throw new Error('Invalid deleted session response')
  return { name: expectedName }
}

export const sessionApi: SessionApi = {
  async getSessions() {
    return parseSessionList(await requestJson('/api/sessions'))
  },
  async getShells() {
    return parseShellList(await requestJson('/api/sessions/shells'))
  },
  async createSession(name, shell) {
    const trimmedName = name.trim()
    const response = await requestJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ ...(trimmedName ? { name: trimmedName } : {}), shell }),
    })
    return parseSession(response)
  },
  async stopSession(name) {
    const response = await requestJson(`/api/sessions/${encodeURIComponent(name)}/stop`, { method: 'POST' })
    return parseSession(response)
  },
  async restartSession(name) {
    const response = await requestJson(`/api/sessions/${encodeURIComponent(name)}/restart`, { method: 'POST' })
    return parseSession(response)
  },
  async scrollSession(name, direction, lines) {
    const response = await requestJson(`/api/sessions/${encodeURIComponent(name)}/scroll`, {
      method: 'POST',
      body: JSON.stringify(lines === undefined ? { direction } : { direction, lines }),
    })
    return parseSession(response)
  },
  async deleteSession(name) {
    return parseDeletedSession(await requestJson(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }), name)
  },
}
