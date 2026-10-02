import type { TerminalConnectionStatus } from '../types/session'

export const TERMINAL_STATUS_LABELS: Readonly<Record<TerminalConnectionStatus, string>> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  stopped: '会话已停止',
  disposed: '会话已删除',
  error: '连接失败',
}
