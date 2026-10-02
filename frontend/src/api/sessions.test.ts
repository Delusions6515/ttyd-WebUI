import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from '../stores/sessions'
import type { Session } from '../types/session'
import { sessionApi } from './sessions'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function sessionResponse(name: string, status: Session['status'] = 'running'): Session {
  return { name, shell: 'bash', status, port: status === 'running' ? 7681 : null, pid: null, createdAt: '2026-10-01T00:00:00.000Z' }
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('session API', () => {
  it('uses the existing session endpoints and leaves an empty name to the server generator', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
      .mockResolvedValueOnce(jsonResponse({ shells: [{ id: 'bash', name: 'Bash', path: '/bin/bash' }] }))
      .mockResolvedValueOnce(jsonResponse(sessionResponse('bash-1'), 201))
      .mockResolvedValueOnce(jsonResponse(sessionResponse('bash-1', 'stopped')))
      .mockResolvedValueOnce(jsonResponse(sessionResponse('bash-1')))
      .mockResolvedValueOnce(jsonResponse(sessionResponse('bash-1')))
      .mockResolvedValueOnce(jsonResponse(sessionResponse('bash-1')))
      .mockResolvedValueOnce(jsonResponse({ name: 'bash-1' }))

    expect(await sessionApi.getSessions()).toEqual([])
    expect(await sessionApi.getShells()).toEqual([{ id: 'bash', name: 'Bash' }])
    await sessionApi.createSession('', 'bash')
    await sessionApi.stopSession('bash-1')
    await sessionApi.restartSession('bash-1')
    await sessionApi.scrollSession('bash-1', 'up', 5)
    await sessionApi.scrollSession('bash-1', 'bottom')
    await sessionApi.deleteSession('bash-1')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/sessions',
      '/api/sessions/shells',
      '/api/sessions',
      '/api/sessions/bash-1/stop',
      '/api/sessions/bash-1/restart',
      '/api/sessions/bash-1/scroll',
      '/api/sessions/bash-1/scroll',
      '/api/sessions/bash-1',
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ shell: 'bash' })
    expect(JSON.parse(String(fetchMock.mock.calls[5][1]?.body))).toEqual({ direction: 'up', lines: 5 })
    expect(JSON.parse(String(fetchMock.mock.calls[6][1]?.body))).toEqual({ direction: 'bottom' })
    expect(fetchMock.mock.calls.map(([, init]) => init?.credentials)).toEqual(Array(8).fill('same-origin'))
  })

  it.each([
    ['null session entries', { sessions: [null] }],
    ['missing session list', {}],
    ['unsupported session status', { sessions: [{ ...sessionResponse('alpha'), status: 'offline' }] }],
  ])('rejects malformed successful session payloads (%s)', async (_description, body) => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(body))
    await expect(sessionApi.getSessions()).rejects.toThrow('Invalid sessions response')
  })

  it('rejects malformed shell collections and lifecycle session DTOs', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ shells: [{ id: 'bash' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...sessionResponse('alpha'), status: 'unknown' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Scroll direction must be one of up, down or bottom' }, 400))
    await expect(sessionApi.getShells()).rejects.toThrow('Invalid shells response')
    await expect(sessionApi.stopSession('alpha')).rejects.toThrow('Invalid session response')
    await expect(sessionApi.scrollSession('alpha', 'bottom')).rejects.toThrow('Scroll direction must be one of up, down or bottom')
  })

  it('preserves the last valid snapshot and selection when a 2xx payload is malformed', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [null] }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [{ ...sessionResponse('still'), status: 'unknown' }] }))
    const store = createSessionStore({ createWebSocket: () => ({
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close() {},
    }) })
    store.state.sessions = [sessionResponse('still')]
    store.selectSession('still')

    expect(await store.refresh()).toBe(false)
    expect(store.state.sessions).toEqual([sessionResponse('still')])
    expect(store.state.selectedName).toBe('still')
    expect(store.state.error).toContain('Invalid sessions response')

    expect(await store.refresh()).toBe(false)
    expect(store.state.sessions).toEqual([sessionResponse('still')])
    expect(store.state.selectedName).toBe('still')
    store.destroy()
  })

  it('turns backend JSON errors into user-readable exceptions', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Session "dev" already exists' }, 409))
    await expect(sessionApi.createSession('dev', 'bash')).rejects.toThrow('Session "dev" already exists')
  })
})
