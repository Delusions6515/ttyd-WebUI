<script setup lang="ts">
import { ref } from 'vue'
import CopyTextSheet from './CopyTextSheet.vue'
import TextInputSheet from './TextInputSheet.vue'
import { COMMON_SHORTCUTS, EXTENDED_KEYS } from '../terminal/key-definitions'
import type { ShortcutPreset, ToolbarKey } from '../terminal/key-definitions'
import type { TerminalKey } from '../terminal/key-encoder'
import type { ScrollDirection } from '../api/sessions'

const props = defineProps<{
  connected: boolean
  copyText: string
  copyViewOpen: boolean
  textInputOpen: boolean
  message: string
}>()

const emit = defineEmits<{
  copySelection: []
  pasteClipboard: []
  openCopyView: []
  openTextInput: []
  closeCopyView: []
  closeTextInput: []
  sendText: [text: string, appendEnter: boolean]
  key: [key: TerminalKey]
  shortcut: [preset: ShortcutPreset]
  scrollTmux: [direction: ScrollDirection, lines?: number]
}>()

const expanded = ref(false)
const localMessage = ref('')
const TMUX_SCROLL_LINES = 20

function copySelection(): void {
  localMessage.value = ''
  emit('copySelection')
}

function openCopyView(): void {
  localMessage.value = ''
  emit('openCopyView')
}

function openTextInput(): void {
  localMessage.value = ''
  emit('openTextInput')
}

function activateExtendedKey(item: ToolbarKey): void {
  if (props.connected && item.action.type === 'key') emit('key', item.action.key)
}

function activateShortcut(preset: ShortcutPreset): void {
  if (props.connected) emit('shortcut', preset)
}
</script>

<template>
  <div class="terminal-tools">
    <button
      type="button"
      class="tools-toggle"
      aria-label="终端工具"
      :aria-expanded="expanded"
      @pointerdown.prevent
      @click="expanded = !expanded"
    >工具</button>
    <section v-if="expanded" class="tools-panel" role="dialog" aria-label="终端工具面板">
      <header>
        <h2>终端工具</h2>
        <button type="button" aria-label="关闭终端工具" @pointerdown.prevent @click="expanded = false">关闭</button>
      </header>
      <div class="tools-actions">
        <button type="button" @pointerdown.prevent @click="copySelection">复制所选文本</button>
        <button type="button" @pointerdown.prevent @click="openCopyView">打开复制视图</button>
        <button type="button" :disabled="!connected" @pointerdown.prevent @click="emit('pasteClipboard')">粘贴</button>
        <button type="button" @pointerdown.prevent @click="openTextInput">输入长文本</button>
      </div>
      <p v-if="localMessage || message" class="tools-message" role="status">{{ localMessage || message }}</p>
      <section class="scroll-tools" aria-label="终端历史滚动">
        <button type="button" :disabled="!connected" @pointerdown.prevent @click="emit('scrollTmux', 'up', TMUX_SCROLL_LINES)">向上滚动</button>
        <button type="button" :disabled="!connected" @pointerdown.prevent @click="emit('scrollTmux', 'down', TMUX_SCROLL_LINES)">向下滚动</button>
        <button type="button" :disabled="!connected" @pointerdown.prevent @click="emit('scrollTmux', 'bottom')">返回底部</button>
      </section>
      <section class="extended-keys" aria-label="扩展终端按键">
        <div class="extended-key-row">
          <button
            v-for="item in EXTENDED_KEYS"
            :key="item.ariaLabel"
            type="button"
            class="extended-key-button"
            :aria-label="item.ariaLabel"
            :disabled="!connected"
            @pointerdown.prevent
            @click="activateExtendedKey(item)"
          >{{ item.label }}</button>
        </div>
        <div class="extended-shortcuts">
          <button
            v-for="preset in COMMON_SHORTCUTS"
            :key="preset.label"
            type="button"
            class="extended-key-button"
            :aria-label="preset.label"
            :disabled="!connected"
            @pointerdown.prevent
            @click="activateShortcut(preset)"
          >{{ preset.label }}</button>
        </div>
      </section>
    </section>
    <CopyTextSheet :open="copyViewOpen" :text="copyText" @close="emit('closeCopyView')" />
    <TextInputSheet :open="textInputOpen" :connected="connected" @close="emit('closeTextInput')" @send="(text, appendEnter) => emit('sendText', text, appendEnter)" />
  </div>
</template>

<style scoped>
.terminal-tools {
  position: absolute;
  z-index: 2;
  inset: 0;
  pointer-events: none;
}

.tools-toggle,
.tools-panel button {
  min-height: 2rem;
  border: 1px solid #383e49;
  border-radius: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: #20242c;
  color: #e8ebf1;
  font: 0.75rem/1.2 system-ui, sans-serif;
}

.tools-toggle {
  position: absolute;
  top: 0.4rem;
  right: 0.5rem;
  pointer-events: auto;
}

.tools-toggle:focus-visible,
.tools-panel button:focus-visible {
  outline: 2px solid #84b6ff;
  outline-offset: 2px;
}

.tools-panel {
  position: absolute;
  z-index: 5;
  top: 0.4rem;
  right: 0.5rem;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: min(22rem, calc(100vw - 1rem));
  max-width: calc(100% - 1rem);
  max-height: min(65vh, 32rem);
  overflow: auto;
  padding: 0.75rem;
  border: 1px solid #414958;
  border-radius: 0.65rem;
  background: #191d25;
  box-shadow: 0 0.8rem 2rem #0009;
  color: #e8ebf1;
}

.tools-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tools-panel h2 {
  margin: 0;
  font: 600 0.9rem/1.2 system-ui, sans-serif;
}

.tools-actions,
.scroll-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.scroll-tools,
.extended-keys {
  padding-top: 0.55rem;
  border-top: 1px solid #343a45;
}

.extended-keys {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.extended-key-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.3rem;
}

.extended-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.extended-key-button {
  flex: 1 1 5rem;
  min-width: 0;
}

.tools-panel button:disabled {
  opacity: 0.45;
}

.tools-message {
  margin: 0;
  color: #ffdf9e;
  font: 0.75rem/1.4 system-ui, sans-serif;
}
</style>
