<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import CreateSessionDialog from './components/CreateSessionDialog.vue'
import SessionDrawer from './components/SessionDrawer.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import TerminalView from './components/TerminalView.vue'
import { useVisualViewport } from './composables/useVisualViewport'
import { createPreferencesStore } from './stores/preferences'
import { createSessionStore } from './stores/sessions'
import type { TerminalConnectionStatus } from './types/session'
import './styles/theme.css'
import './styles/fonts.css'
import './styles/layout.css'

const store = createSessionStore()
const preferenceStore = createPreferencesStore()
const { state } = store
const { state: preferences } = preferenceStore
const viewport = useVisualViewport()
const drawerOpen = ref(false)
const sidebarCollapsed = ref(false)
const createDialogOpen = ref(false)
const settingsOpen = ref(false)
const keyboardRequested = ref(false)
const terminalStatus = ref<TerminalConnectionStatus>('disconnected')
const terminalView = ref<{ focusTerminal(): void; blurTerminal(): void } | null>(null)
const selectedSession = computed(() => state.sessions.find(({ name }) => name === state.selectedName) ?? null)
const visibleTerminalStatus = computed<TerminalConnectionStatus>(() => (
  selectedSession.value?.status === 'stopped' ? 'stopped' : terminalStatus.value
))
const appStyle = computed(() => ({
  '--visual-viewport-height': `${viewport.height.value}px`,
  '--visual-viewport-offset-top': `${viewport.offsetTop.value}px`,
}))

function selectSession(name: string): void {
  store.selectSession(name)
  drawerOpen.value = false
}

function toggleKeyboard(): void {
  if (keyboardRequested.value) terminalView.value?.blurTerminal()
  else terminalView.value?.focusTerminal()
  keyboardRequested.value = !keyboardRequested.value
}

async function createSession(name: string, shell: string): Promise<void> {
  if (await store.createSession(name, shell)) {
    createDialogOpen.value = false
    drawerOpen.value = false
  }
}

onMounted(() => store.start())
onBeforeUnmount(() => store.destroy())
watch(() => state.selectedName, () => { keyboardRequested.value = false })
</script>

<template>
  <div class="app-shell" :style="appStyle">
    <AppHeader
      :session-name="state.selectedName"
      :terminal-status="visibleTerminalStatus"
      :keyboard-requested="keyboardRequested"
      @toggle-sessions="drawerOpen = true"
      @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
      @toggle-keyboard="toggleKeyboard"
      @open-settings="settingsOpen = true"
    />
    <div class="app-workspace">
      <SessionDrawer
        :open="drawerOpen"
        :collapsed="sidebarCollapsed"
        :sessions="state.sessions"
        :shells="state.shells"
        :selected-name="state.selectedName"
        :loading="state.loading"
        :shells-loading="state.shellsLoading"
        :error="state.error"
        :shell-error="state.shellError"
        :notification-error="state.notificationError"
        :pending-actions="state.pendingActions"
        :terminal-status="visibleTerminalStatus"
        @close="drawerOpen = false"
        @refresh="store.refresh"
        @refresh-shells="store.refreshShells"
        @create-request="createDialogOpen = true"
        @select-session="selectSession"
        @stop-session="store.stopSession"
        @restart-session="store.restartSession"
        @delete-session="store.deleteSession"
      />
      <main class="terminal-main" aria-label="Terminal workspace">
        <TerminalView
          ref="terminalView"
          :session-name="state.selectedName"
          :enabled="selectedSession?.status === 'running'"
          :font-size="preferences.fontSize"
          :key-rows="preferences.keyRows"
          :show-extra-keys="preferences.showExtraKeys"
          @state="(status) => { terminalStatus = status }"
        />
      </main>
    </div>
    <SettingsSheet
      :open="settingsOpen"
      :preferences="preferences"
      @close="settingsOpen = false"
      @save="preferenceStore.save"
      @reset="preferenceStore.reset"
    />
    <CreateSessionDialog
      :open="createDialogOpen"
      :shells="state.shells"
      :pending="state.creating"
      :error="state.error"
      @close="createDialogOpen = false"
      @create="createSession"
    />
  </div>
</template>
