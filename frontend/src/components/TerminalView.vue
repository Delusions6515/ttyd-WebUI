<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_STATUS_LABELS as statusText } from '../terminal/status-labels'
import ExtraKeysBar from './ExtraKeysBar.vue'
import TerminalToolsSheet from './TerminalToolsSheet.vue'
import { TerminalInputController } from '../terminal/input-controller'
import { encodeHardwareKey } from '../terminal/hardware-key-encoder'
import type { ModifierStates } from '../terminal/input-controller'
import { DEFAULT_KEY_ROWS } from '../terminal/key-definitions'
import type { ShortcutPreset, ToolbarKey } from '../terminal/key-definitions'
import type { TerminalKey, TerminalModifier } from '../terminal/key-encoder'
import { canReadClipboardText, readClipboardText, writeClipboardText } from '../composables/useClipboard'
import { TerminalController, sessionAvailabilityFromSnapshot } from '../terminal/terminal-controller'
import type { SessionAvailability, TerminalStatus } from '../terminal/terminal-controller'
import { getBufferText } from '../terminal/buffer-text'

const props = withDefaults(defineProps<{
  sessionName: string | null
  enabled?: boolean
  fontSize?: number
  keyRows?: readonly (readonly ToolbarKey[])[]
  showExtraKeys?: boolean
}>(), {
  enabled: true,
  fontSize: 13,
  keyRows: () => DEFAULT_KEY_ROWS,
  showExtraKeys: true,
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
const localScrollMode = ref(false)
const textInputOpen = ref(false)
const copyViewOpen = ref(false)
const copyText = ref('')
const toolsMessage = ref('')
interface TerminalTarget {
  sessionName: string
  inputGeneration: number
  controller: TerminalController
}
interface LocalTouchGesture {
  identifier: number
  lastY: number
  accumulatedPixels: number
}
type LocalTouchListener = (event: TouchEvent) => void
interface LocalTouchHandlers {
  surface: HTMLElement
  start: LocalTouchListener
  move: LocalTouchListener
  end: LocalTouchListener
  cancel: LocalTouchListener
}
let textTarget: TerminalTarget | undefined
let localTouchHandlers: LocalTouchHandlers | undefined
let localTouchGesture: LocalTouchGesture | undefined
let controller: TerminalController | undefined
let inputController: TerminalInputController | undefined
let terminalInstance: Terminal | undefined

async function checkSessionAvailable(sessionName: string, signal: AbortSignal): Promise<SessionAvailability> {
  try {
    const response = await fetch('/api/sessions', { credentials: 'same-origin', signal })
    if (!response.ok) return { state: 'unknown' }
    return sessionAvailabilityFromSnapshot(await response.json(), sessionName)
  } catch {
    return { state: 'unknown' }
  }
}

function clearLocalTouchGesture(): void {
  localTouchGesture = undefined
}

function stopLocalTouchEvent(event: TouchEvent): void {
  if (!localScrollMode.value) return
  if (event.cancelable) event.preventDefault()
  event.stopImmediatePropagation()
}

function handleLocalTouchStart(event: TouchEvent): void {
  if (!localScrollMode.value) return
  stopLocalTouchEvent(event)
  if (event.touches.length !== 1) {
    clearLocalTouchGesture()
    return
  }
  const touch = event.changedTouches[0]
  if (!touch) return
  localTouchGesture = { identifier: touch.identifier, lastY: touch.clientY, accumulatedPixels: 0 }
}

function handleLocalTouchMove(event: TouchEvent, terminal: Terminal): void {
  if (!localScrollMode.value) return
  stopLocalTouchEvent(event)
  const gesture = localTouchGesture
  if (!gesture || event.touches.length !== 1) {
    clearLocalTouchGesture()
    return
  }
  let changedTouch: Touch | undefined
  for (let index = 0; index < event.changedTouches.length; index++) {
    const touch = event.changedTouches[index]
    if (touch?.identifier === gesture.identifier) changedTouch = touch
  }
  if (!changedTouch) return

  gesture.accumulatedPixels += gesture.lastY - changedTouch.clientY
  gesture.lastY = changedTouch.clientY
  const lines = Math.trunc(gesture.accumulatedPixels / 18)
  if (lines !== 0) {
    gesture.accumulatedPixels -= lines * 18
    terminal.scrollLines(lines)
  }
}

function handleLocalTouchEnd(event: TouchEvent): void {
  if (!localScrollMode.value) return
  stopLocalTouchEvent(event)
  clearLocalTouchGesture()
}

function attachLocalTouchHandlers(surface: HTMLElement, terminal: Terminal): void {
  const handlers: LocalTouchHandlers = {
    surface,
    start: handleLocalTouchStart,
    move: (event) => handleLocalTouchMove(event, terminal),
    end: handleLocalTouchEnd,
    cancel: handleLocalTouchEnd,
  }
  localTouchHandlers = handlers
  surface.addEventListener('touchstart', handlers.start, { capture: true, passive: false })
  surface.addEventListener('touchmove', handlers.move, { capture: true, passive: false })
  surface.addEventListener('touchend', handlers.end, { capture: true, passive: false })
  surface.addEventListener('touchcancel', handlers.cancel, { capture: true, passive: false })
}

function detachLocalTouchHandlers(): void {
  if (!localTouchHandlers) return
  const { surface, start, move, end, cancel } = localTouchHandlers
  surface.removeEventListener('touchstart', start, true)
  surface.removeEventListener('touchmove', move, true)
  surface.removeEventListener('touchend', end, true)
  surface.removeEventListener('touchcancel', cancel, true)
  localTouchHandlers = undefined
  clearLocalTouchGesture()
}

function clearToolState(): void {
  localScrollMode.value = false
  clearLocalTouchGesture()
  textInputOpen.value = false
  textTarget = undefined
  copyViewOpen.value = false
  copyText.value = ''
  toolsMessage.value = ''
}

function disposeTerminal(): void {
  status.value = 'disconnected'
  detachLocalTouchHandlers()
  clearToolState()
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
    fontSize: props.fontSize,
    fontFamily: '"JetBrainsMono Nerd Font Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
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
  attachLocalTouchHandlers(terminalElement.value, terminal)
  terminal.attachCustomWheelEventHandler((event) => {
    if (!localScrollMode.value) return true
    if (event.deltaY !== 0) terminal.scrollLines(Math.sign(event.deltaY) * 3)
    return false
  })

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
      if (nextStatus !== 'connected') {
        inputController?.reset()
        localScrollMode.value = false
        clearLocalTouchGesture()
        textInputOpen.value = false
        textTarget = undefined
      }
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

function captureConnectedTarget(): TerminalTarget | undefined {
  if (!props.sessionName || status.value !== 'connected' || !controller || !inputController) return undefined
  return {
    sessionName: props.sessionName,
    inputGeneration: inputController.generation,
    controller,
  }
}

function ownsTarget(target: TerminalTarget): boolean {
  return props.sessionName === target.sessionName
    && status.value === 'connected'
    && controller === target.controller
    && inputController?.generation === target.inputGeneration
}

function handlePaste(text: string, generation: number): void {
  if (!text || status.value !== 'connected' || inputController?.generation !== generation) return
  terminalInstance?.paste(text)
}

function openTextInput(target = captureConnectedTarget()): void {
  if (!target) {
    toolsMessage.value = '请先连接一个会话'
    return
  }
  toolsMessage.value = ''
  textTarget = target
  textInputOpen.value = true
}

function sendText(text: string, appendEnter: boolean): void {
  const target = textTarget
  if (!target || !ownsTarget(target) || !text || !terminalInstance) return
  terminalInstance.paste(text)
  if (appendEnter) terminalInstance.input('\r', true)
  toolsMessage.value = ''
  textInputOpen.value = false
  textTarget = undefined
}

function closeTextInput(): void {
  textInputOpen.value = false
  textTarget = undefined
}

async function pasteClipboard(): Promise<void> {
  toolsMessage.value = ''
  const target = captureConnectedTarget()
  if (!target) return
  if (!canReadClipboardText()) {
    openTextInput(target)
    return
  }

  const text = await readClipboardText()
  if (!ownsTarget(target)) {
    if (props.sessionName === target.sessionName) toolsMessage.value = '会话连接已变化，未粘贴剪贴板内容'
    return
  }
  if (text === null) {
    toolsMessage.value = '无法读取剪贴板，请在文本框中使用系统粘贴'
    openTextInput(target)
    return
  }
  if (!text) {
    toolsMessage.value = '剪贴板为空'
    return
  }
  terminalInstance?.paste(text)
}

async function copySelection(): Promise<void> {
  toolsMessage.value = ''
  const selection = terminalInstance?.getSelection() ?? ''
  if (!selection) {
    toolsMessage.value = '请先在终端中选择文本'
    return
  }
  const target = captureConnectedTarget()
  if (!target) {
    toolsMessage.value = '终端未连接，无法复制选区'
    return
  }
  const copied = await writeClipboardText(selection)
  if (!ownsTarget(target)) return
  if (copied) {
    toolsMessage.value = '已复制所选文本'
    return
  }
  copyText.value = selection
  copyViewOpen.value = true
  toolsMessage.value = '无法访问剪贴板，请从文本视图使用系统复制'
}

function openCopyView(): void {
  toolsMessage.value = ''
  const buffer = terminalInstance?.buffer.active
  if (!buffer) {
    toolsMessage.value = '当前没有可复制的终端文本'
    return
  }
  copyText.value = getBufferText(buffer)
  copyViewOpen.value = true
}

function closeCopyView(): void {
  toolsMessage.value = ''
  copyViewOpen.value = false
  copyText.value = ''
}

function setLocalScrollMode(enabled: boolean): void {
  if (status.value !== 'connected' || !terminalInstance) return
  clearLocalTouchGesture()
  localScrollMode.value = enabled
  if (!enabled) terminalInstance.scrollToBottom()
}

function scrollLocally(amount: number): void {
  if (status.value === 'connected' && localScrollMode.value) terminalInstance?.scrollLines(amount)
}

function returnToBottom(): void {
  if (status.value !== 'connected' || !terminalInstance) return
  terminalInstance.scrollToBottom()
  localScrollMode.value = false
  clearLocalTouchGesture()
}

function handleShortcut(preset: ShortcutPreset): void {
  inputController?.sendPreset(preset)
}

watch(() => props.fontSize, (fontSize) => controller?.setFontSize(fontSize), { flush: 'post' })
watch(() => props.showExtraKeys, (visible) => {
  if (visible) return
  inputController?.reset()
  if (status.value === 'connected') terminalInstance?.focus()
}, { flush: 'sync' })
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
    <div class="terminal-display">
      <div v-if="!sessionName" class="terminal-empty">请选择会话</div>
      <div v-else ref="terminalElement" class="terminal-container" :class="{ 'is-local-scroll': localScrollMode }"></div>
      <TerminalToolsSheet
        v-if="sessionName"
        :key="sessionName"
        :connected="status === 'connected'"
        :local-scroll-mode="localScrollMode"
        :copy-text="copyText"
        :copy-view-open="copyViewOpen"
        :text-input-open="textInputOpen"
        :message="toolsMessage"
        @copy-selection="copySelection"
        @paste-clipboard="pasteClipboard"
        @open-copy-view="openCopyView"
        @open-text-input="openTextInput"
        @close-copy-view="closeCopyView"
        @close-text-input="closeTextInput"
        @send-text="sendText"
        @toggle-local-scroll="setLocalScrollMode(!localScrollMode)"
        @scroll-local="scrollLocally"
        @scroll-to-bottom="returnToBottom"
      />
    </div>
    <ExtraKeysBar
      v-if="showExtraKeys"
      :key="sessionName ?? 'no-session'"
      ref="extraKeys"
      :connected="status === 'connected'"
      :modifier-state="modifierState"
      :input-epoch="inputController?.generation ?? 0"
      :key-rows="keyRows"
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
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-canvas);
}

.terminal-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.75rem;
  padding: 0 0.625rem;
  color: var(--color-text-muted);
  font: 0.75rem/1.2 var(--font-interface);
}

.status-indicator {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentColor;
}

.terminal-view[data-state='connected'] .status-indicator {
  color: var(--color-success);
}

.terminal-view[data-state='error'] .status-indicator,
.terminal-view[data-state='disconnected'] .status-indicator {
  color: var(--color-error);
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

.terminal-display {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-container,
.terminal-empty {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-container.is-local-scroll {
  touch-action: none;
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
