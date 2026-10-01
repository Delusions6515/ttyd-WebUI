<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModifierInput from './ModifierInput.vue'
import { COMMON_SHORTCUTS, DEFAULT_KEY_ROWS, EXTENDED_KEYS } from '../terminal/key-definitions'
import type { ShortcutPreset, ToolbarKey } from '../terminal/key-definitions'
import type { TerminalKey, TerminalModifier } from '../terminal/key-encoder'
import type { ModifierStates } from '../terminal/input-controller'

const props = defineProps<{
  connected: boolean
  modifierState: ModifierStates
  inputEpoch: number
}>()

const emit = defineEmits<{
  key: [key: TerminalKey]
  text: [text: string, generation: number]
  paste: [text: string, generation: number]
  hardware: [event: KeyboardEvent, generation: number]
  modifier: [modifier: TerminalModifier]
  lockModifier: [modifier: TerminalModifier]
  shortcut: [preset: ShortcutPreset]
  focusModifierInput: []
}>()

const expanded = ref(false)
const modifierInput = ref<InstanceType<typeof ModifierInput> | null>(null)
interface ModifierPress {
  timer: ReturnType<typeof setTimeout>
  longPressed: boolean
}
const modifierPresses = new Map<TerminalModifier, ModifierPress>()
const suppressClick = new Set<TerminalModifier>()

function activate(action: ToolbarKey['action']): void {
  if (!props.connected) return
  switch (action.type) {
    case 'key':
      emit('key', action.key)
      break
    case 'text':
      emit('text', action.text, props.inputEpoch)
      break
    case 'modifier':
      if (suppressClick.delete(action.modifier)) return
      emit('modifier', action.modifier)
      emit('focusModifierInput')
      break
  }
}

function activateShortcut(preset: ShortcutPreset): void {
  if (props.connected) emit('shortcut', preset)
}

function onPointerDown(item: ToolbarKey, event: PointerEvent): void {
  if (item.action.type === 'modifier') onModifierPointerDown(item.action.modifier)
  else event.preventDefault()
}

function onModifierPointerDown(modifier: TerminalModifier): void {
  if (!props.connected) return
  const prior = modifierPresses.get(modifier)
  if (prior) clearTimeout(prior.timer)
  const press: ModifierPress = {
    longPressed: false,
    timer: setTimeout(() => {
      press.longPressed = true
      emit('lockModifier', modifier)
    }, 500),
  }
  modifierPresses.set(modifier, press)
}

function onModifierPointerUp(modifier: TerminalModifier): void {
  const press = modifierPresses.get(modifier)
  if (!press) return
  clearTimeout(press.timer)
  modifierPresses.delete(modifier)
  if (press.longPressed) {
    suppressClick.add(modifier)
    emit('focusModifierInput')
  }
}

function onModifierPointerCancel(modifier: TerminalModifier): void {
  const press = modifierPresses.get(modifier)
  if (press) clearTimeout(press.timer)
  modifierPresses.delete(modifier)
  suppressClick.delete(modifier)
}

function clearPendingModifierPresses(): void {
  for (const press of modifierPresses.values()) clearTimeout(press.timer)
  modifierPresses.clear()
  suppressClick.clear()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') clearPendingModifierPresses()
}

function focusModifierInput(): void {
  modifierInput.value?.focus()
}

function blurModifierInput(): void {
  modifierInput.value?.blur()
}

watch(() => props.connected, (connected) => {
  if (!connected) {
    clearPendingModifierPresses()
    blurModifierInput()
  }
}, { flush: 'sync' })

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearPendingModifierPresses()
})

defineExpose({ focusModifierInput, blurModifierInput })
</script>

<template>
  <nav class="extra-keys-bar" aria-label="终端快捷键">
    <div v-for="(row, index) in DEFAULT_KEY_ROWS" :key="index" class="extra-key-row">
      <button
        v-for="item in row"
        :key="item.ariaLabel"
        type="button"
        class="extra-key-button"
        :class="{ 'modifier-button': item.action.type === 'modifier' }"
        :aria-label="item.ariaLabel"
        :aria-pressed="item.action.type === 'modifier' ? modifierState[item.action.modifier] !== 'off' : undefined"
        :data-mode="item.action.type === 'modifier' ? modifierState[item.action.modifier] : undefined"
        :disabled="!connected"
        @pointerdown="onPointerDown(item, $event)"
        @pointerup="item.action.type === 'modifier' ? onModifierPointerUp(item.action.modifier) : undefined"
        @pointercancel="item.action.type === 'modifier' ? onModifierPointerCancel(item.action.modifier) : undefined"
        @click="activate(item.action)"
      >{{ item.label }}</button>
    </div>
    <div class="extra-key-actions">
      <ModifierInput
        ref="modifierInput"
        :input-epoch="inputEpoch"
        :active="modifierState.ctrl !== 'off' || modifierState.alt !== 'off'"
        :disabled="!connected"
        @commit="(text, generation) => emit('text', text, generation)"
        @paste="(text, generation) => emit('paste', text, generation)"
        @hardware="(event, generation) => emit('hardware', event, generation)"
      />
      <button type="button" class="extra-key-more" :aria-expanded="expanded" @pointerdown.prevent @click="expanded = !expanded">
        {{ expanded ? '收起扩展键' : '更多按键' }}
      </button>
    </div>
    <div v-if="expanded" class="extra-key-expanded" aria-label="扩展终端按键">
      <div class="extra-key-row extra-key-function-row">
        <button
          v-for="item in EXTENDED_KEYS"
          :key="item.ariaLabel"
          type="button"
          class="extra-key-button"
          :aria-label="item.ariaLabel"
          :disabled="!connected"
          @pointerdown.prevent
          @click="activate(item.action)"
        >{{ item.label }}</button>
      </div>
      <div class="extra-key-shortcuts">
        <button
          v-for="preset in COMMON_SHORTCUTS"
          :key="preset.label"
          type="button"
          class="extra-key-button shortcut-button"
          :aria-label="preset.label"
          :disabled="!connected"
          @pointerdown.prevent
          @click="activateShortcut(preset)"
        >{{ preset.label }}</button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.extra-keys-bar {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.35rem 0.45rem;
  border-top: 1px solid #292d36;
  background: #171a20;
  color: #e8ebf1;
  touch-action: manipulation;
}

.extra-key-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.3rem;
}

.extra-key-button,
.extra-key-more {
  min-width: 0;
  min-height: 2.65rem;
  border: 1px solid #383e49;
  border-radius: 0.45rem;
  padding: 0.25rem 0.15rem;
  background: #20242c;
  color: inherit;
  font: 600 0.8rem/1.1 system-ui, sans-serif;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}

.extra-key-button:active,
.extra-key-button[data-mode='once'] {
  border-color: #76a9ed;
  background: #2b3b51;
}

.extra-key-button[data-mode='locked'] {
  border-color: #e8b763;
  background: #49391e;
  color: #ffdf9e;
}

.extra-key-button:focus-visible,
.extra-key-more:focus-visible {
  outline: 2px solid #84b6ff;
  outline-offset: 2px;
}

.extra-key-button:disabled {
  opacity: 0.45;
}

.extra-key-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
}

.extra-key-more {
  min-height: 1.8rem;
  padding: 0.2rem 0.6rem;
  color: #aeb4c0;
  font-size: 0.7rem;
}

.extra-key-expanded {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 30vh;
  overflow: auto;
}

.extra-key-function-row {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.extra-key-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.shortcut-button {
  flex: 1 1 5rem;
}
</style>
