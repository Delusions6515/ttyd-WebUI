<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  text: string
}>()

const emit = defineEmits<{
  close: []
}>()

const textarea = ref<HTMLTextAreaElement>()

async function selectSnapshot(): Promise<void> {
  await nextTick()
  if (!props.open || !textarea.value) return
  textarea.value.focus()
  textarea.value.select()
}

function close(): void {
  if (textarea.value && document.activeElement === textarea.value) textarea.value.blur()
  emit('close')
}

watch(() => props.open, (open) => {
  if (open) void selectSnapshot()
  else if (textarea.value && document.activeElement === textarea.value) textarea.value.blur()
}, { flush: 'sync', immediate: true })

onBeforeUnmount(() => {
  if (textarea.value && document.activeElement === textarea.value) textarea.value.blur()
})
</script>

<template>
  <section v-if="open" class="copy-text-sheet" role="dialog" aria-label="复制终端文本">
    <header>
      <h2>复制终端文本</h2>
      <button type="button" aria-label="关闭复制视图" @pointerdown.prevent @click="close">关闭</button>
    </header>
    <p>选择文本后使用系统的复制操作。</p>
    <textarea
      ref="textarea"
      :value="text"
      aria-label="终端文本快照"
      readonly
      spellcheck="false"
      @focus="($event.target as HTMLTextAreaElement).select()"
    ></textarea>
  </section>
</template>

<style scoped>
.copy-text-sheet {
  position: absolute;
  z-index: 6;
  inset: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
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

.copy-text-sheet header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.copy-text-sheet h2,
.copy-text-sheet p {
  margin: 0;
}

.copy-text-sheet h2 {
  font-size: 1rem;
}

.copy-text-sheet p {
  color: #aeb4c0;
  font-size: 0.75rem;
}

.copy-text-sheet textarea {
  flex: 1 1 auto;
  min-height: 4rem;
  resize: none;
  border: 1px solid #414958;
  border-radius: 0.45rem;
  padding: 0.65rem;
  background: #101319;
  color: inherit;
  font: 0.9rem/1.45 ui-monospace, monospace;
}

.copy-text-sheet button {
  min-height: 2.4rem;
  border: 1px solid #414958;
  border-radius: 0.45rem;
  padding: 0.35rem 0.65rem;
  background: #252b36;
  color: inherit;
}
</style>
