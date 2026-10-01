<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import ExtraKeysBar from './ExtraKeysBar.vue'
import { TerminalInputController } from '../terminal/input-controller'
import { encodeHardwareKey } from '../terminal/hardware-key-encoder'
import type { ModifierStates } from '../terminal/input-controller'
import type { ShortcutPreset } from '../terminal/key-definitions'
import type { TerminalKey, TerminalModifier } from '../terminal/key-encoder'
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
const extraKeys = ref<InstanceType<typeof ExtraKeysBar> | null>(null)
const modifierState = ref<ModifierStates>({ ctrl: 'off', alt: 'off' })
const status = ref<TerminalStatus>('disconnected')
const connectionError = ref('')
const title = ref('')
let controller: TerminalController | undefined
let inputController: TerminalInputController | undefined
let terminalInstance: Terminal | undefined

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
  status.value = 'disconnected'
  inputController?.destroy()
  inputController = undefined
  modifierState.value = { ctrl: 'off', alt: 'off' }
  controller?.destroy()
  controller = undefined
  terminalInstance = undefined
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
  terminalInstance = terminal
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.open(terminalElement.value)

  inputController = new TerminalInputController({
    sendInput: (data) => controller?.sendVirtualInput(data) ?? false,
    getApplicationCursorKeysMode: () => controller?.applicationCursorKeysMode ?? terminal.modes.applicationCursorKeysMode,
    onModifiersChange: (nextState) => {
      const previouslyActive = modifierState.value.ctrl !== 'off' || modifierState.value.alt !== 'off'
      const active = nextState.ctrl !== 'off' || nextState.alt !== 'off'
      modifierState.value = nextState
      if (previouslyActive && !active) {
        extraKeys.value?.blurModifierInput()
        if (status.value === 'connected') terminalInstance?.focus()
      }
    },
  })
  controller = new TerminalController({
    sessionName: props.sessionName,
    terminal,
    fitAddon,
    container: terminalElement.value,
    checkSessionAvailable,
    onState: (nextStatus, error) => {
      status.value = nextStatus
      if (nextStatus !== 'connected') inputController?.reset()
      connectionError.value = error ?? ''
      emit('state', nextStatus, error)
    },
    onTitle: (nextTitle) => { title.value = nextTitle },
  })
}

function handleModifierToggle(modifier: TerminalModifier): void {
  inputController?.toggleModifier(modifier)
  focusForModifierState()
}

function handleModifierLock(modifier: TerminalModifier): void {
  inputController?.lockModifier(modifier)
}

function focusForModifierState(): void {
  if (inputController?.hasActiveModifiers) extraKeys.value?.focusModifierInput()
  else {
    extraKeys.value?.blurModifierInput()
    terminalInstance?.focus()
  }
}

function handleVirtualKey(key: TerminalKey): void {
  inputController?.pressKey(key)
}

function handleVirtualText(text: string, generation: number): void {
  inputController?.submitText(text, 'virtual', generation)
}

function handleHardwareKey(event: KeyboardEvent, generation: number): void {
  const data = encodeHardwareKey(event, controller?.applicationCursorKeysMode ?? false)
  if (data !== undefined) inputController?.submitText(data, 'text', generation)
}

function handlePaste(text: string, generation: number): void {
  inputController?.submitText(text, 'paste', generation)
}

function handleShortcut(preset: ShortcutPreset): void {
  inputController?.sendPreset(preset)
}

watch(() => [props.sessionName, props.enabled] as const, () => {
  disposeTerminal()
  void nextTick(mountTerminal)
}, { flush: 'sync' })
onMounted(mountTerminal)
onBeforeUnmount(disposeTerminal)

defineExpose({
  focusTerminal: () => terminalInstance?.focus(),
  blurTerminal: () => terminalInstance?.blur(),
})
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
    <ExtraKeysBar
      :key="sessionName ?? 'no-session'"
      ref="extraKeys"
      :connected="status === 'connected'"
      :modifier-state="modifierState"
      :input-epoch="inputController?.generation ?? 0"
      @key="handleVirtualKey"
      @text="handleVirtualText"
      @paste="handlePaste"
      @hardware="handleHardwareKey"
      @modifier="handleModifierToggle"
      @lock-modifier="handleModifierLock"
      @shortcut="handleShortcut"
      @focus-modifier-input="focusForModifierState"
    />
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
