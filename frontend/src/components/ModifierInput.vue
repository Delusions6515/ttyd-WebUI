<script setup lang="ts">
import { ref } from 'vue'
import { encodeHardwareKey } from '../terminal/hardware-key-encoder'

const props = withDefaults(defineProps<{
  inputEpoch: number
  active?: boolean
  disabled?: boolean
}>(), { active: false, disabled: false })

const emit = defineEmits<{
  commit: [text: string, generation: number]
  paste: [text: string, generation: number]
  hardware: [event: KeyboardEvent, generation: number]
}>()

const field = ref<HTMLInputElement>()
let composing = false
let focusEpoch = props.inputEpoch
let compositionEpoch = focusEpoch
let skipNextInput: string | undefined

function onFocus(): void {
  focusEpoch = props.inputEpoch
}

function sendCommit(text: string, generation: number): void {
  if (text && !props.disabled) emit('commit', text, generation)
}

function onCompositionStart(): void {
  composing = true
  compositionEpoch = focusEpoch
  skipNextInput = undefined
}

function onCompositionEnd(event: CompositionEvent): void {
  composing = false
  const text = field.value?.value || event.data
  if (field.value) field.value.value = ''
  if (text) {
    sendCommit(text, compositionEpoch)
    skipNextInput = text
  }
}

function onInput(event: InputEvent): void {
  if (props.disabled || composing || event.isComposing) return
  const input = event.currentTarget as HTMLInputElement
  const text = input.value
  input.value = ''
  if (!text) {
    skipNextInput = undefined
    return
  }

  if (skipNextInput !== undefined) {
    const duplicate = text === skipNextInput
    skipNextInput = undefined
    if (duplicate) return
  }

  if (event.inputType === 'insertFromPaste') emit('paste', text, focusEpoch)
  else sendCommit(text, focusEpoch)
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault()
  skipNextInput = undefined
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (field.value) field.value.value = ''
  if (text && !props.disabled) emit('paste', text, focusEpoch)
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled || composing || event.isComposing || event.keyCode === 229) return
  if (encodeHardwareKey(event, false) !== undefined) {
    event.preventDefault()
    emit('hardware', event, focusEpoch)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    sendCommit('\r', focusEpoch)
  }
}

function focus(): void {
  if (!props.disabled) field.value?.focus()
}

function blur(): void {
  field.value?.blur()
}

defineExpose({ focus, blur })
</script>

<template>
  <div class="modifier-entry" :class="{ 'is-active': active }">
    <span v-if="active" class="modifier-input-label">组合输入</span>
    <input
      ref="field"
      class="modifier-input"
      type="text"
      aria-label="虚拟 Ctrl/Alt 组合输入"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="done"
      inputmode="text"
      :disabled="disabled"
      @focus="onFocus"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @input="onInput"
      @paste="onPaste"
      @keydown="onKeydown"
    >
  </div>
</template>

<style scoped>
.modifier-entry {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0.01;
}

.modifier-entry.is-active {
  position: static;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.4rem;
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 2rem;
  overflow: visible;
  opacity: 1;
}

.modifier-input-label {
  flex: 0 0 auto;
  color: #aeb4c0;
  font: 0.7rem system-ui, sans-serif;
}

.modifier-input {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0.01;
  pointer-events: none;
}

.is-active .modifier-input {
  position: static;
  flex: 1 1 auto;
  width: 0;
  height: 2rem;
  min-width: 0;
  border: 1px solid #454c59;
  border-radius: 0.35rem;
  padding: 0.2rem 0.45rem;
  background: #111318;
  color: #e8ebf1;
  font: 0.85rem system-ui, sans-serif;
  opacity: 1;
  pointer-events: auto;
}
</style>
