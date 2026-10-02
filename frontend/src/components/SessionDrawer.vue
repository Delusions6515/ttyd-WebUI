<script setup lang="ts">
import { TERMINAL_STATUS_LABELS as terminalStatusLabels } from '../terminal/status-labels'
import SessionActions from './SessionActions.vue'
import type { Session, SessionAction, TerminalConnectionStatus, SessionStatus, Shell } from '../types/session'

withDefaults(defineProps<{
  open: boolean
  collapsed?: boolean
  sessions: Session[]
  shells: Shell[]
  selectedName: string | null
  loading: boolean
  shellsLoading: boolean
  error: string
  shellError: string
  notificationError: string
  pendingActions: Partial<Record<string, SessionAction>>
  terminalStatus: TerminalConnectionStatus
}>(), {
  collapsed: false,
})

defineEmits<{
  close: []
  refresh: []
  refreshShells: []
  createRequest: []
  selectSession: [name: string]
  stopSession: [name: string]
  restartSession: [name: string]
  deleteSession: [name: string]
}>()

const sessionStatusLabels: Record<SessionStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
}

</script>

<template>
  <div class="session-drawer" :class="{ 'is-open': open, 'is-collapsed': collapsed }">
    <button
      v-if="open"
      class="drawer-backdrop"
      type="button"
      aria-label="Close sessions"
      @click="$emit('close')"
    ></button>
    <aside class="drawer-panel" aria-label="Sessions">
      <header class="drawer-header">
        <div>
          <h2>Sessions</h2>
          <p>Manage remote terminal tasks</p>
        </div>
        <button v-if="open" class="drawer-close" type="button" aria-label="Close sessions" @click="$emit('close')">×</button>
      </header>

      <div v-if="notificationError" class="drawer-notice" role="status">{{ notificationError }}</div>
      <div v-if="error" class="drawer-error" role="alert">
        <span>{{ error }}</span>
        <button type="button" @click="$emit('refresh')">Retry list</button>
      </div>
      <div v-if="shellError" class="drawer-error" role="alert">
        <span>Available shells could not be loaded: {{ shellError }}</span>
        <button type="button" @click="$emit('refreshShells')">Retry shells</button>
      </div>

      <div class="drawer-list-heading">
        <span>All sessions</span>
        <button type="button" aria-label="Refresh sessions" :disabled="loading" @click="$emit('refresh')">↻</button>
      </div>
      <div v-if="loading && !sessions.length" class="drawer-empty">Loading sessions…</div>
      <div v-else-if="!sessions.length" class="drawer-empty">
        <strong>No sessions yet</strong>
        <span>Create a session to start using a remote shell.</span>
      </div>
      <ul v-else class="session-list">
        <li v-for="session in sessions" :key="session.name" class="session-item">
          <button
            class="session-select"
            :class="{ selected: session.name === selectedName }"
            :aria-current="session.name === selectedName ? 'true' : undefined"
            :data-testid="`session-${session.name}`"
            @click="$emit('selectSession', session.name)"
          >
            <span class="session-indicator" :data-state="session.status" aria-hidden="true"></span>
            <span class="session-info">
              <strong>{{ session.name }}</strong>
              <small>{{ session.shell || 'Default shell' }} · {{ sessionStatusLabels[session.status] }}</small>
            </span>
          </button>
          <div v-if="session.name === selectedName" class="terminal-connection" aria-live="polite">
            Terminal: {{ terminalStatusLabels[terminalStatus] }}
          </div>
          <SessionActions
            :session="session"
            :pending-action="pendingActions[session.name]"
            @stop="$emit('stopSession', $event)"
            @restart="$emit('restartSession', $event)"
            @remove="$emit('deleteSession', $event)"
          />
        </li>
      </ul>

      <footer class="drawer-footer">
        <button
          class="create-session-button"
          type="button"
          data-testid="create-session"
          :disabled="shellsLoading || !shells.length"
          @click="$emit('createRequest')"
        >
          + New session
        </button>
        <span v-if="!shellsLoading && !shells.length" class="shell-unavailable">
          No available shells
        </span>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.session-drawer {
  display: none;
}

.drawer-backdrop {
  position: fixed;
  z-index: 39;
  inset: 0;
  border: 0;
  background: rgb(0 0 0 / 58%);
}

.drawer-panel {
  position: fixed;
  z-index: 40;
  inset-block: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: min(86vw, 23rem);
  max-width: 100%;
  padding: max(0.8rem, env(safe-area-inset-top)) 0 max(0.8rem, env(safe-area-inset-bottom));
  border-right: 1px solid #333945;
  background: #191c23;
  color: #e8ebf1;
  box-shadow: 0.7rem 0 2rem rgb(0 0 0 / 30%);
  font: 0.875rem/1.35 system-ui, sans-serif;
}

.drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.25rem 1rem 0.9rem;
  border-bottom: 1px solid #2b303a;
}

.drawer-header h2 {
  margin: 0;
  font-size: 1rem;
}

.drawer-header p {
  margin: 0.25rem 0 0;
  color: #9da6b4;
  font-size: 0.75rem;
}

.drawer-close,
.drawer-list-heading button {
  width: 2.25rem;
  min-height: 2.25rem;
  border: 1px solid #39404b;
  border-radius: 0.4rem;
  background: #232832;
  color: #e8ebf1;
  font-size: 1.1rem;
}

.drawer-notice,
.drawer-error {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.75rem 0.75rem 0;
  border-radius: 0.45rem;
  padding: 0.6rem 0.7rem;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
}

.drawer-notice {
  background: #382f1b;
  color: #edcf8c;
}

.drawer-error {
  background: #3b2429;
  color: #ffb4bb;
}

.drawer-error button {
  align-self: flex-start;
  border: 0;
  padding: 0.1rem 0;
  background: transparent;
  color: #ffd1d5;
  text-decoration: underline;
}

.drawer-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3.1rem;
  padding: 0.4rem 0.85rem 0.4rem 1rem;
  color: #aeb6c3;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.drawer-list-heading button {
  font-size: 1.25rem;
}

.drawer-empty {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0 0.75rem;
  border: 1px dashed #3b424f;
  border-radius: 0.55rem;
  padding: 1rem;
  color: #d4d9e2;
  text-align: center;
}

.drawer-empty span {
  color: #9da6b4;
  font-size: 0.75rem;
}

.session-list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0 0.5rem;
  overflow: auto;
  list-style: none;
}

.session-item {
  border-bottom: 1px solid #2c313b;
}

.session-select {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-height: 3.35rem;
  border: 1px solid transparent;
  border-radius: 0.45rem;
  padding: 0.55rem 0.7rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.session-select.selected {
  border-color: #42689a;
  background: #222c3b;
}

.session-indicator {
  flex: 0 0 auto;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #9da6b4;
}

.session-indicator[data-state='running'] {
  background: #5fc98b;
}

.session-indicator[data-state='starting'],
.session-indicator[data-state='stopping'] {
  background: #edc067;
}

.session-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.session-info strong,
.session-info small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-info small,
.terminal-connection {
  color: #a3adbb;
  font-size: 0.72rem;
}

.terminal-connection {
  padding: 0 0.75rem 0.4rem 2.8rem;
}

.drawer-footer {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: auto;
  border-top: 1px solid #303641;
  padding: 0.75rem;
}

.create-session-button {
  min-height: 2.75rem;
  border: 1px solid #517db6;
  border-radius: 0.5rem;
  background: #28466d;
  color: white;
  font: 600 0.875rem system-ui, sans-serif;
}

.create-session-button:disabled {
  opacity: 0.55;
}

.shell-unavailable {
  color: #e6b6bb;
  font-size: 0.75rem;
}

@media (max-width: 799px) {
  .session-drawer.is-open {
    display: block;
  }
}

@media (min-width: 800px) {
  .session-drawer {
    position: relative;
    z-index: 1;
    display: flex;
    flex: 0 0 17.5rem;
    width: 17.5rem;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid #303641;
  }

  .session-drawer.is-collapsed {
    display: none;
  }

  .drawer-backdrop {
    display: none;
  }

  .drawer-panel {
    position: absolute;
    inset: 0;
    width: 100%;
    box-shadow: none;
  }
}
</style>
