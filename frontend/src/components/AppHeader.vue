<script setup lang="ts">
import type { TerminalConnectionStatus } from '../types/session'

withDefaults(defineProps<{
  sessionName: string | null
  terminalStatus: TerminalConnectionStatus
  keyboardRequested: boolean
}>(), {
  sessionName: null,
})

defineEmits<{
  toggleSessions: []
  toggleSidebar: []
  toggleKeyboard: []
  openSettings: []
}>()

const statusLabels: Record<TerminalConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  stopped: '会话已停止',
  disposed: '会话已删除',
  error: '连接失败',
}
</script>

<template>
  <header class="app-header">
    <button class="header-button sessions-toggle" type="button" aria-label="Open sessions" @click="$emit('toggleSessions')">
      <span aria-hidden="true">☰</span>
      <span>会话</span>
    </button>
    <button class="header-button desktop-sidebar-toggle" type="button" aria-label="Toggle session sidebar" @click="$emit('toggleSidebar')">
      <span aria-hidden="true">☷</span>
    </button>
    <div class="header-session">
      <strong>{{ sessionName || 'ttyd WebUI' }}</strong>
      <span v-if="sessionName" class="header-status" :data-state="terminalStatus" aria-live="polite">
        <span class="header-status-dot" aria-hidden="true"></span>
        {{ statusLabels[terminalStatus] }}
      </span>
      <span v-else class="header-status">未选择会话</span>
    </div>
    <button
      class="header-button keyboard-toggle"
      type="button"
      :aria-pressed="keyboardRequested"
      @click="$emit('toggleKeyboard')"
    >
      {{ keyboardRequested ? '隐藏键盘' : '显示键盘' }}
    </button>
    <button class="header-button settings-toggle" type="button" aria-label="设置" @click="$emit('openSettings')">
      设置
    </button>
  </header>
</template>

<style scoped>
.app-header {
  z-index: 2;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  min-height: 3.25rem;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid #292d36;
  background: var(--color-surface);
  color: var(--color-text);
  font: 0.875rem/1.2 system-ui, sans-serif;
}

.header-button {
  min-width: 2.5rem;
  min-height: 2.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  padding: 0.35rem 0.65rem;
  background: var(--color-surface-raised);
  color: inherit;
  font: inherit;
}

.sessions-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.desktop-sidebar-toggle {
  display: none;
}

.header-session {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  min-width: 0;
}

.header-session strong,
.header-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #aab2c0;
  font-size: 0.75rem;
}

.header-status-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #aab2c0;
}

.header-status[data-state='connected'] .header-status-dot {
  background: #5fc98b;
}

.header-status[data-state='error'] .header-status-dot,
.header-status[data-state='disconnected'] .header-status-dot {
  background: #ef7777;
}

@media (min-width: 800px) {
  .sessions-toggle {
    display: none;
  }

  .desktop-sidebar-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .header-session {
    justify-content: flex-start;
  }
}
</style>
