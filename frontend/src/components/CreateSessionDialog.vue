<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Shell } from '../types/session'

const props = defineProps<{
  open: boolean
  shells: Shell[]
  pending: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  create: [name: string, shell: string]
}>()

const name = ref('')
const shell = ref(props.shells[0]?.id ?? '')

watch(() => props.open, (open) => {
  if (open) {
    name.value = ''
    shell.value = props.shells[0]?.id ?? ''
  }
})
watch(() => props.shells, (shells) => {
  if (!shells.some(({ id }) => id === shell.value)) shell.value = shells[0]?.id ?? ''
})

function submit(): void {
  if (!shell.value || props.pending) return
  emit('create', name.value, shell.value)
}
</script>

<template>
  <div v-if="open" class="create-backdrop" @click.self="$emit('close')">
    <section class="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-session-title">
      <header class="dialog-header">
        <div>
          <h2 id="create-session-title">New session</h2>
          <p>Start a shell in a managed tmux task.</p>
        </div>
        <button type="button" class="dialog-close" aria-label="Close" @click="$emit('close')">×</button>
      </header>
      <form @submit.prevent="submit">
        <label for="session-name">Session name (optional)</label>
        <input
          id="session-name"
          v-model="name"
          type="text"
          autocomplete="off"
          placeholder="Automatic name"
          :disabled="pending"
        >
        <small>Leave blank to use the next available name.</small>

        <label for="session-shell">Shell</label>
        <select id="session-shell" v-model="shell" :disabled="pending || !shells.length" required>
          <option v-for="availableShell in shells" :key="availableShell.id" :value="availableShell.id">
            {{ availableShell.name }}
          </option>
        </select>

        <p v-if="error" class="create-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button type="button" class="secondary-button" :disabled="pending" @click="$emit('close')">Cancel</button>
          <button type="submit" class="primary-button" :disabled="pending || !shell">
            {{ pending ? 'Creating…' : 'Create session' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.create-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
  background: rgb(0 0 0 / 65%);
}

.create-dialog {
  width: min(100%, 28rem);
  max-height: 100%;
  overflow: auto;
  border: 1px solid #414854;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #1b1f26;
  color: #edf0f5;
  box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 45%);
  font: 0.875rem system-ui, sans-serif;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.dialog-header p {
  margin: 0.3rem 0 0;
  color: #aab2c0;
  font-size: 0.78rem;
}

.dialog-close {
  width: 2.2rem;
  height: 2.2rem;
  border: 1px solid #3c424e;
  border-radius: 0.4rem;
  background: #252a33;
  color: inherit;
  font-size: 1.15rem;
}

.create-dialog form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.create-dialog label {
  margin-top: 0.55rem;
  color: #dce1e9;
  font-weight: 600;
}

.create-dialog input,
.create-dialog select {
  box-sizing: border-box;
  width: 100%;
  min-height: 2.7rem;
  border: 1px solid #454c58;
  border-radius: 0.45rem;
  padding: 0.45rem 0.6rem;
  background: #11151b;
  color: #edf0f5;
  font: inherit;
}

.create-dialog small {
  color: #9da6b4;
  font-size: 0.72rem;
}

.create-error {
  margin: 0.4rem 0 0;
  border-radius: 0.4rem;
  padding: 0.6rem;
  background: #3b2429;
  color: #ffb4bb;
  overflow-wrap: anywhere;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: 1rem;
}

.dialog-actions button {
  min-height: 2.5rem;
  border: 1px solid #454c58;
  border-radius: 0.45rem;
  padding: 0.45rem 0.8rem;
  font: 600 0.85rem system-ui, sans-serif;
}

.secondary-button {
  background: #242932;
  color: #e4e8ef;
}

.primary-button {
  border-color: #517db6 !important;
  background: #28466d;
  color: white;
}

.dialog-actions button:disabled {
  opacity: 0.55;
}
</style>
