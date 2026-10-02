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
import { sessionApi } from '../api/sessions'
import type { ScrollDirection } from '../api/sessions'
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
const textInputOpen = ref(false)
const copyViewOpen = ref(false)
const copyText = ref('')
const toolsMessage = ref('')
interface TerminalTarget {
  sessionName: string
  inputGeneration: number
  controller: TerminalController
}
let textTarget: TerminalTarget | undefined
let controller: TerminalController | undefined
let inputController: TerminalInputController | undefined
let terminalInstance: Terminal | undefined
interface ScrollGesture {
  identifier: number
  lastY: number
}
let scrollGesture: ScrollGesture | undefined
let scrollPixels = 0
// Scroll requests run in order, so a fast wheel or swipe cannot reorder tmux history.
let scrollChain: Promise<void> = Promise.resolve()
const SCROLL_PIXELS_PER_LINE = 18
const MAX_SCROLL_LINES = 100

async function checkSessionAvailable(sessionName: string, signal: AbortSignal): Promise<SessionAvailability> {
  try {
    const response = await fetch('/api/sessions', { credentials: 'same-origin', signal })
    if (!response.ok) return { state: 'unknown' }
    return sessionAvailabilityFromSnapshot(await response.json(), sessionName)
  } catch {
    return { state: 'unknown' }
  }
}

// Tracks whether the terminal itself owned focus before a modifier moved it to the
// composition field. Only then may focus be handed back, so tapping a toolbar key on a
// touch device never summons the on-screen keyboard by itself.
let terminalHadFocus = false

function captureTerminalFocus(): void {
  const active = typeof document === 'undefined' ? null : document.activeElement
  terminalHadFocus = Boolean(active && terminalElement.value?.contains(active))
}

function restoreTerminalFocus(): void {
  if (!terminalHadFocus) return
  // Already back inside the terminal (another handler restored it): focus() here would be a
  // redundant call and, on a real device, an extra chance to disturb the keyboard state.
  if (terminalElement.value?.contains(document.activeElement)) return
  if (status.value === 'connected') terminalInstance?.focus()
}

function clearToolState(): void {
  textInputOpen.value = false
  textTarget = undefined
  copyViewOpen.value = false
  copyText.value = ''
  toolsMessage.value = ''
}

function disposeTerminal(): void {
  status.value = 'disconnected'
  terminalHadFocus = false
  detachScrollHandlers()
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
  attachScrollHandlers(terminalElement.value)

  inputController = new TerminalInputController({
    sendInput: (data) => controller?.sendVirtualInput(data) ?? false,
    getApplicationCursorKeysMode: () => controller?.applicationCursorKeysMode ?? terminal.modes.applicationCursorKeysMode,
    onModifiersChange: (nextState) => {
      const previouslyActive = modifierState.value.ctrl !== 'off' || modifierState.value.alt !== 'off'
      const active = nextState.ctrl !== 'off' || nextState.alt !== 'off'
      modifierState.value = nextState
      if (previouslyActive && !active) {
        extraKeys.value?.blurModifierInput()
        restoreTerminalFocus()
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
        terminalHadFocus = false
        endScrollTouch()
        inputController?.reset()
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
  // Remember the focus owner before a modifier claims it, so a later release can hand it back.
  if (!inputController?.hasActiveModifiers) captureTerminalFocus()
  inputController?.toggleModifier(modifier)
  focusForModifierState()
}

function handleModifierLock(modifier: TerminalModifier): void {
  if (!inputController?.hasActiveModifiers) captureTerminalFocus()
  inputController?.lockModifier(modifier)
}

function focusForModifierState(): void {
  if (inputController?.hasActiveModifiers) extraKeys.value?.focusModifierInput()
  else {
    extraKeys.value?.blurModifierInput()
    restoreTerminalFocus()
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

function handleShortcut(preset: ShortcutPreset): void {
  inputController?.sendPreset(preset)
}

function scrollTmux(direction: ScrollDirection, lines?: number): void {
  const target = captureConnectedTarget()
  if (!target) return
  toolsMessage.value = ''
  scrollChain = scrollChain
    .then(async () => {
      if (!ownsTarget(target)) return
      await sessionApi.scrollSession(target.sessionName, direction, lines)
    })
    .catch((error: unknown) => {
      if (ownsTarget(target)) toolsMessage.value = error instanceof Error ? error.message : '无法滚动终端历史'
    })
}

// delta > 0 means the reader is moving toward older output, matching tmux copy-mode up.
function scrollByPixels(delta: number): void {
  scrollPixels += delta
  const lines = Math.trunc(scrollPixels / SCROLL_PIXELS_PER_LINE)
  if (lines === 0) return
  scrollPixels -= lines * SCROLL_PIXELS_PER_LINE
  scrollTmux(lines > 0 ? 'up' : 'down', Math.min(Math.abs(lines), MAX_SCROLL_LINES))
}

function handleScrollTouchStart(event: TouchEvent): void {
  if (event.touches.length !== 1) {
    scrollGesture = undefined
    return
  }
  const touch = event.changedTouches[0]
  if (!touch) return
  scrollGesture = { identifier: touch.identifier, lastY: touch.clientY }
  scrollPixels = 0
}

function handleScrollTouchMove(event: TouchEvent): void {
  const gesture = scrollGesture
  if (!gesture || status.value !== 'connected') return
  if (event.touches.length !== 1) {
    endScrollTouch()
    return
  }
  let changedTouch: Touch | undefined
  for (let index = 0; index < event.changedTouches.length; index++) {
    const touch = event.changedTouches[index]
    if (touch?.identifier === gesture.identifier) changedTouch = touch
  }
  if (!changedTouch) return
  const delta = changedTouch.clientY - gesture.lastY
  if (delta === 0) return
  gesture.lastY = changedTouch.clientY
  // Keep a handled swipe out of xterm's local viewport and TUI input handlers.
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  scrollByPixels(delta)
}

function endScrollTouch(): void {
  scrollGesture = undefined
  scrollPixels = 0
}

function handleScrollWheel(event: WheelEvent): void {
  if (status.value !== 'connected' || event.deltaY === 0 || event.ctrlKey) return
  // Capture before xterm's nested viewport can consume the wheel or turn it into keys.
  event.preventDefault()
  event.stopPropagation()
  scrollByPixels(Math.sign(-event.deltaY) * 3 * SCROLL_PIXELS_PER_LINE)
}

interface ScrollTouchHandlers {
  start: (event: TouchEvent) => void
  move: (event: TouchEvent) => void
  end: () => void
}
let scrollTouchHandlers: ScrollTouchHandlers | undefined

function attachScrollHandlers(surface: HTMLElement): void {
  surface.addEventListener('wheel', handleScrollWheel, { capture: true, passive: false })
  const handlers: ScrollTouchHandlers = {
    start: handleScrollTouchStart,
    move: handleScrollTouchMove,
    end: endScrollTouch,
  }
  scrollTouchHandlers = handlers
  surface.addEventListener('touchstart', handlers.start, { capture: true, passive: true })
  surface.addEventListener('touchmove', handlers.move, { capture: true, passive: false })
  surface.addEventListener('touchend', handlers.end, { capture: true, passive: true })
  surface.addEventListener('touchcancel', handlers.end, { capture: true, passive: true })
}

function detachScrollHandlers(): void {
  const handlers = scrollTouchHandlers
  scrollTouchHandlers = undefined
  if (!handlers || !terminalElement.value) return
  terminalElement.value.removeEventListener('wheel', handleScrollWheel, true)
  terminalElement.value.removeEventListener('touchstart', handlers.start, true)
  terminalElement.value.removeEventListener('touchmove', handlers.move, true)
  terminalElement.value.removeEventListener('touchend', handlers.end, true)
  terminalElement.value.removeEventListener('touchcancel', handlers.end, true)
  endScrollTouch()
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
      <div v-else ref="terminalElement" class="terminal-container"></div>
      <TerminalToolsSheet
        v-if="sessionName"
        :key="sessionName"
        :connected="status === 'connected'"
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
        @key="handleVirtualKey"
        @shortcut="handleShortcut"
        @scroll-tmux="scrollTmux"
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
