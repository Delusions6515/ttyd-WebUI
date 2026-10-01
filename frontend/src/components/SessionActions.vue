<script setup lang="ts">
import { ref } from 'vue'
import type { Session, SessionAction } from '../types/session'

const props = defineProps<{
  session: Session
  pendingAction?: SessionAction
}>()

defineEmits<{
  stop: [name: string]
  restart: [name: string]
  remove: [name: string]
}>()

const confirmingDelete = ref(false)
</script>

<template>
  <div class="session-actions" @click.stop>
    <span v-if="pendingAction" class="action-pending" role="status">
      {{ pendingAction === 'stop' ? 'Stopping…' : pendingAction === 'restart' ? 'Resuming…' : 'Deleting…' }}
    </span>
    <button
      v-if="session.status === 'running'"
      type="button"
      :disabled="!!pendingAction"
      :aria-label="`Stop ${session.name}`"
      @click="$emit('stop', session.name)"
    >
      Stop
    </button>
    <button
      v-else-if="session.status === 'stopped'"
      type="button"
      :disabled="!!pendingAction"
      :aria-label="`Resume ${session.name}`"
      @click="$emit('restart', session.name)"
    >
      Resume
    </button>
    <button
      type="button"
      :disabled="!!pendingAction || session.status === 'starting' || session.status === 'stopping'"
      :aria-label="`Delete ${session.name}`"
      :data-testid="`delete-${session.name}`"
      @click="confirmingDelete = true"
    >
      Delete
    </button>
    <div v-if="confirmingDelete" class="confirm-backdrop" @click.self="confirmingDelete = false">
      <section class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="`Delete ${session.name}`">
        <h3>Delete {{ session.name }}?</h3>
        <p>This will end the tmux task for this session. This cannot be undone.</p>
        <div class="confirm-actions">
          <button type="button" data-testid="cancel-delete" @click="confirmingDelete = false">Cancel</button>
          <button
            type="button"
            class="danger-button"
            data-testid="confirm-delete"
            @click="$emit('remove', session.name); confirmingDelete = false"
          >
            Delete session
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.session-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.75rem 0.5rem 2.8rem;
}

.session-actions button {
  min-height: 2rem;
  border: 1px solid #414754;
  border-radius: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: #252a33;
  color: #d6dbe4;
  font: 0.75rem system-ui, sans-serif;
}

.session-actions button:disabled {
  opacity: 0.55;
}

.action-pending {
  color: #aeb9ca;
  font: 0.75rem system-ui, sans-serif;
}

.confirm-backdrop {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 60%);
}

.confirm-dialog {
  width: min(100%, 24rem);
  border: 1px solid #464d59;
  border-radius: 0.7rem;
  padding: 1rem;
  background: #1b1f26;
  color: #eceff4;
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 45%);
}

.confirm-dialog h3 {
  margin: 0 0 0.5rem;
  font: 600 1rem system-ui, sans-serif;
}

.confirm-dialog p {
  margin: 0 0 1rem;
  color: #b4bcc9;
  font: 0.875rem/1.45 system-ui, sans-serif;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.confirm-actions .danger-button {
  border-color: #a94e57;
  background: #702f38;
  color: white;
}
</style>
