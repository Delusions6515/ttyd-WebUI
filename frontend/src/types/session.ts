export type SessionStatus = 'starting' | 'running' | 'stopping' | 'stopped'

export interface Session {
  name: string
  port: number | null
  pid: number | null
  shell: string | null
  status: SessionStatus
  createdAt: string
}

export interface Shell {
  id: string
  name: string
}

export type SessionAction = 'stop' | 'restart' | 'delete'

export type TerminalConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'stopped'
  | 'disposed'
  | 'error'
