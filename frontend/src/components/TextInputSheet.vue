<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  connected: boolean
}>()

const emit = defineEmits<{
  close: []
  send: [text: string, appendEnter: boolean]
}>()

const textarea = ref<HTMLTextAreaElement>()
const text = ref('')
const composing = ref(false)

function clearAndBlur(): void {
  composing.value = false
  text.value = ''
  if (textarea.value && document.activeElement === textarea.value) textarea.value.blur()
}

async function focusForInput(): Promise<void> {
  text.value = ''
  composing.value = false
  await nextTick()
  if (props.open) textarea.value?.focus()
}

function close(): void {
  clearAndBlur()
  emit('close')
}

function send(appendEnter: boolean): void {
  if (!props.connected || composing.value || !text.value) return
  emit('send', text.value, appendEnter)
  close()
}

watch(() => props.open, (open) => {
  if (open) void focusForInput()
  else clearAndBlur()
}, { flush: 'sync', immediate: true })

onBeforeUnmount(clearAndBlur)
</script>

<template>
  <section v-if="open" class="text-input-sheet" role="dialog" aria-label="输入文本">
    <header class="sheet-header">
      <h2>输入文本</h2>
      <button type="button" aria-label="关闭文本输入" @pointerdown.prevent @click="close">关闭</button>
    </header>
    <textarea
      ref="textarea"
      v-model="text"
      aria-label="要发送的文本"
      rows="6"
      :disabled="!connected"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    ></textarea>
    <p v-if="composing" class="composition-note" role="status">请先完成输入法候选确认</p>
    <footer>
      <button type="button" :disabled="!connected || composing || !text" @pointerdown.prevent @click="send(false)">发送文本</button>
      <button type="button" :disabled="!connected || composing || !text" @pointerdown.prevent @click="send(true)">发送并回车</button>
    </footer>
  </section>
</template>

<style scoped>
.text-input-sheet {
  position: absolute;
  z-index: 6;
  inset: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  pointer-events: auto;
  min-height: 0;
  padding: 0.8rem;
  border: 1px solid #414958;
  border-radius: 0.7rem;
  background: #191d25;
  box-shadow: 0 0.8rem 2.5rem #0009;
  color: #e8ebf1;
  font: 0.875rem/1.4 system-ui, sans-serif;
}

.sheet-header,
.text-input-sheet footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sheet-header h2 {
  margin: 0;
  font-size: 1rem;
}

.text-input-sheet textarea {
  flex: 1 1 auto;
  min-height: 4rem;
  resize: none;
  border: 1px solid #414958;
  border-radius: 0.45rem;
  padding: 0.65rem;
  background: #101319;
  color: inherit;
  font: 1rem/1.45 ui-monospace, monospace;
}

.text-input-sheet button {
  min-height: 2.4rem;
  border: 1px solid #414958;
  border-radius: 0.45rem;
  padding: 0.35rem 0.65rem;
  background: #252b36;
  color: inherit;
}

.text-input-sheet button:disabled {
  opacity: 0.5;
}

.composition-note {
  margin: 0;
  color: #ffdf9e;
  font-size: 0.75rem;
}
</style>
