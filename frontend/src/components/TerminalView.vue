<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { TerminalController, sessionAvailabilityFromSnapshot } from '../terminal/terminal-controller'
import type { SessionAvailability, TerminalStatus } from '../terminal/terminal-controller'

const props = withDefaults(defineProps<{
  sessionName: string | null
  enabled?: boolean
}>(), {
  enabled: true,
})

const emit = defineEmits<{
  state: [status: TerminalStatus, error?: string]
}>()

const terminalElement = ref<HTMLElement>()
const status = ref<TerminalStatus>('disconnected')
const connectionError = ref('')
const title = ref('')
let controller: TerminalController | undefined

const statusText: Record<TerminalStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  stopped: '会话已停止',
  disposed: '会话已删除',
  error: '连接失败',
}

async function checkSessionAvailable(sessionName: string, signal: AbortSignal): Promise<SessionAvailability> {
  try {
    const response = await fetch('/api/sessions', { credentials: 'same-origin', signal })
    if (!response.ok) return { state: 'unknown' }
    return sessionAvailabilityFromSnapshot(await response.json(), sessionName)
  } catch {
    return { state: 'unknown' }
  }
}

function disposeTerminal(): void {
  controller?.destroy()
  controller = undefined
  terminalElement.value?.replaceChildren()
}

function mountTerminal(): void {
  disposeTerminal()
  title.value = ''
  connectionError.value = ''
  if (!props.sessionName || !props.enabled || !terminalElement.value) {
    status.value = 'disconnected'
    emit('state', status.value)
    return
  }

  const terminal = new Terminal({
    fontSize: 13,
    fontFamily: 'monospace',
    disableStdin: true,
    cursorBlink: true,
    theme: {
      foreground: '#d2d2d2',
      background: '#111318',
      cursor: '#d2d2d2',
      selectionBackground: '#414b5c',
    },
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.open(terminalElement.value)

  controller = new TerminalController({
    sessionName: props.sessionName,
    terminal,
    fitAddon,
    container: terminalElement.value,
    checkSessionAvailable,
    onState: (nextStatus, error) => {
      status.value = nextStatus
      connectionError.value = error ?? ''
      emit('state', nextStatus, error)
    },
    onTitle: (nextTitle) => { title.value = nextTitle },
  })
}

watch(() => [props.sessionName, props.enabled] as const, () => {
  disposeTerminal()
  void nextTick(mountTerminal)
}, { flush: 'sync' })
onMounted(mountTerminal)
onBeforeUnmount(disposeTerminal)
</script>

<template>
  <section class="terminal-view" :data-state="status" aria-label="终端">
    <header class="terminal-status" aria-live="polite">
      <span class="status-indicator" aria-hidden="true"></span>
      <span>{{ statusText[status] }}</span>
      <span v-if="title" class="terminal-title">{{ title }}</span>
      <span v-if="connectionError" class="terminal-error">{{ connectionError }}</span>
    </header>
    <div v-if="!sessionName" class="terminal-empty">请选择会话</div>
    <div v-else ref="terminalElement" class="terminal-container"></div>
  </section>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: #d2d2d2;
  background: #111318;
}

.terminal-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.75rem;
  padding: 0 0.625rem;
  color: #aeb4c0;
  font: 0.75rem/1.2 system-ui, sans-serif;
}

.status-indicator {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentColor;
}

.terminal-view[data-state='connected'] .status-indicator {
  color: #5fc98b;
}

.terminal-view[data-state='error'] .status-indicator,
.terminal-view[data-state='disconnected'] .status-indicator {
  color: #ef7777;
}

.terminal-title,
.terminal-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-error {
  color: #ef9999;
}

.terminal-container,
.terminal-empty {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 0.25rem 0.5rem;
}

.terminal-empty {
  display: grid;
  place-items: center;
  color: #858b96;
  font: 0.875rem system-ui, sans-serif;
}
</style>
