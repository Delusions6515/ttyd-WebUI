<script setup lang="ts">
import { ref, watch } from 'vue'
import { DEFAULT_PREFERENCES, copyPreferences, validatePreferences } from '../stores/preferences'
import type { PreferencesSnapshot } from '../stores/preferences'
import type { ToolbarKey, ToolbarKeyAction } from '../terminal/key-definitions'
import { TERMINAL_KEYS } from '../terminal/key-encoder'
import type { TerminalKey, TerminalModifier } from '../terminal/key-encoder'

const props = defineProps<{
  open: boolean
  preferences: PreferencesSnapshot
}>()

const emit = defineEmits<{
  close: []
  save: [preferences: PreferencesSnapshot]
  reset: []
}>()

const draft = ref<PreferencesSnapshot>(copyPreferences(DEFAULT_PREFERENCES))
const modifiers: readonly TerminalModifier[] = ['ctrl', 'alt']

watch(() => props.open, (open) => {
  if (open) draft.value = copyPreferences(props.preferences)
}, { immediate: true })

function editItem(rowIndex: number, keyIndex: number, edit: (item: ToolbarKey) => ToolbarKey): void {
  const next = copyPreferences(draft.value)
  const row = next.keyRows[rowIndex]
  const item = row?.[keyIndex]
  if (!row || !item) return
  row[keyIndex] = edit(item)
  draft.value = next
}

function onValue(event: Event): string {
  return (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
}

function setLabel(rowIndex: number, keyIndex: number, event: Event): void {
  const label = onValue(event)
  editItem(rowIndex, keyIndex, (item) => ({ ...item, label, ariaLabel: label }))
}

function actionForType(type: string): ToolbarKeyAction {
  switch (type) {
    case 'key': return { type: 'key', key: 'UP' }
    case 'text': return { type: 'text', text: '/' }
    case 'modifier': return { type: 'modifier', modifier: 'ctrl' }
    case 'shortcut': return { type: 'shortcut', modifiers: [], sequence: [{ type: 'key', key: 'F1' }] }
    default: return { type: 'key', key: 'UP' }
  }
}

function setActionType(rowIndex: number, keyIndex: number, event: Event): void {
  const action = actionForType(onValue(event))
  editItem(rowIndex, keyIndex, (item) => ({ ...item, action }))
}

function setKey(rowIndex: number, keyIndex: number, event: Event): void {
  const value = onValue(event)
  if (!TERMINAL_KEYS.includes(value as TerminalKey)) return
  editItem(rowIndex, keyIndex, (item) => item.action.type === 'key'
    ? { ...item, action: { ...item.action, key: value as TerminalKey } }
    : item)
}

function setText(rowIndex: number, keyIndex: number, event: Event): void {
  const text = onValue(event)
  editItem(rowIndex, keyIndex, (item) => item.action.type === 'text'
    ? { ...item, action: { ...item.action, text } }
    : item)
}

function setModifier(rowIndex: number, keyIndex: number, event: Event): void {
  const modifier = onValue(event)
  if (modifier !== 'ctrl' && modifier !== 'alt') return
  editItem(rowIndex, keyIndex, (item) => item.action.type === 'modifier'
    ? { ...item, action: { ...item.action, modifier } }
    : item)
}

function checked(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked
}

function toggleShortcutModifier(rowIndex: number, keyIndex: number, modifier: TerminalModifier, event: Event): void {
  const enabled = checked(event)
  editItem(rowIndex, keyIndex, (item) => {
    if (item.action.type !== 'shortcut') return item
    const active = new Set(item.action.modifiers)
    if (enabled) active.add(modifier)
    else active.delete(modifier)
    return {
      ...item,
      action: { ...item.action, modifiers: modifiers.filter((entry) => active.has(entry)) },
    }
  })
}

function updateTokenType(rowIndex: number, keyIndex: number, tokenIndex: number, event: Event): void {
  const type = onValue(event)
  editItem(rowIndex, keyIndex, (item) => {
    if (item.action.type !== 'shortcut') return item
    const sequence = [...item.action.sequence]
    if (type === 'key') sequence[tokenIndex] = { type: 'key', key: 'F1' }
    else if (type === 'text') sequence[tokenIndex] = { type: 'text', text: 'x' }
    return { ...item, action: { ...item.action, sequence } }
  })
}

function updateTokenKey(rowIndex: number, keyIndex: number, tokenIndex: number, event: Event): void {
  const value = onValue(event)
  if (!TERMINAL_KEYS.includes(value as TerminalKey)) return
  editItem(rowIndex, keyIndex, (item) => {
    if (item.action.type !== 'shortcut') return item
    const sequence = [...item.action.sequence]
    if (sequence[tokenIndex]?.type === 'key') sequence[tokenIndex] = { type: 'key', key: value as TerminalKey }
    return { ...item, action: { ...item.action, sequence } }
  })
}

function updateTokenText(rowIndex: number, keyIndex: number, tokenIndex: number, event: Event): void {
  const text = onValue(event)
  editItem(rowIndex, keyIndex, (item) => {
    if (item.action.type !== 'shortcut') return item
    const sequence = [...item.action.sequence]
    if (sequence[tokenIndex]?.type === 'text') sequence[tokenIndex] = { type: 'text', text }
    return { ...item, action: { ...item.action, sequence } }
  })
}

function addSequenceStep(rowIndex: number, keyIndex: number): void {
  editItem(rowIndex, keyIndex, (item) => item.action.type === 'shortcut'
    ? { ...item, action: { ...item.action, sequence: [...item.action.sequence, { type: 'key', key: 'F1' }] } }
    : item)
}

function removeSequenceStep(rowIndex: number, keyIndex: number, tokenIndex: number): void {
  editItem(rowIndex, keyIndex, (item) => item.action.type === 'shortcut' && item.action.sequence.length > 1
    ? { ...item, action: { ...item.action, sequence: item.action.sequence.filter((_token, index) => index !== tokenIndex) } }
    : item)
}

function addKey(rowIndex: number): void {
  const next = copyPreferences(draft.value)
  const row = next.keyRows[rowIndex]
  if (!row) return
  const key: TerminalKey = 'F1'
  row.push({ label: key, ariaLabel: key, action: { type: 'key', key } })
  draft.value = next
}

function removeKey(rowIndex: number, keyIndex: number): void {
  const next = copyPreferences(draft.value)
  const row = next.keyRows[rowIndex]
  if (!row || row.length <= 1) return
  row.splice(keyIndex, 1)
  draft.value = next
}

function setFontSize(event: Event): void {
  draft.value = { ...draft.value, fontSize: Number(onValue(event)) }
}

function setExtraKeysVisible(event: Event): void {
  draft.value = { ...draft.value, showExtraKeys: checked(event) }
}

function save(): void {
  if (!validatePreferences(draft.value)) return
  emit('save', copyPreferences(draft.value))
  emit('close')
}

function restoreDefaults(): void {
  draft.value = copyPreferences(DEFAULT_PREFERENCES)
  emit('reset')
}
</script>

<template>
  <div v-if="open" class="settings-backdrop" @pointerdown.self="emit('close')">
    <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header">
        <div>
          <h2 id="settings-title">设置</h2>
          <p>偏好只保存在当前浏览器。</p>
        </div>
        <button type="button" aria-label="关闭设置" @pointerdown.prevent @click="emit('close')">关闭</button>
      </header>
      <form class="settings-content" @submit.prevent="save">
        <section class="settings-section" aria-labelledby="terminal-preferences-title">
          <h3 id="terminal-preferences-title">终端显示</h3>
          <label class="font-size-control">
            <span>终端字号：{{ draft.fontSize }} px</span>
            <input
              type="range"
              aria-label="终端字号"
              min="8"
              max="32"
              step="1"
              :value="draft.fontSize"
              @input="setFontSize"
            >
          </label>
          <label class="visibility-control">
            <input
              type="checkbox"
              aria-label="显示快捷键栏"
              :checked="draft.showExtraKeys"
              @change="setExtraKeysVisible"
            >
            显示快捷键栏
          </label>
        </section>

        <section class="settings-section" aria-labelledby="key-row-settings-title">
          <h3 id="key-row-settings-title">快捷键行</h3>
          <p class="settings-help">选择终端具名键、普通字符或组合序列；配置是按键数据，不会执行脚本。</p>
          <fieldset v-for="(row, rowIndex) in draft.keyRows" :key="rowIndex" class="key-row-editor">
            <legend>第 {{ rowIndex + 1 }} 行</legend>
            <article v-for="(item, keyIndex) in row" :key="`${rowIndex}-${keyIndex}`" class="key-editor">
              <div class="key-editor-heading">
                <strong>第 {{ keyIndex + 1 }} 个键</strong>
                <button
                  type="button"
                  :aria-label="`删除第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个键`"
                  :disabled="row.length <= 1"
                  @pointerdown.prevent
                  @click="removeKey(rowIndex, keyIndex)"
                >删除</button>
              </div>
              <label>
                <span>键位标签</span>
                <input
                  :aria-label="`键位标签，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  maxlength="12"
                  :value="item.label"
                  @input="setLabel(rowIndex, keyIndex, $event)"
                >
              </label>
              <label>
                <span>动作类型</span>
                <select
                  :aria-label="`键位动作，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  :value="item.action.type"
                  @change="setActionType(rowIndex, keyIndex, $event)"
                >
                  <option value="key">具名终端键</option>
                  <option value="text">普通字符</option>
                  <option value="modifier">Ctrl / Alt 修饰键</option>
                  <option value="shortcut">组合序列</option>
                </select>
              </label>
              <label v-if="item.action.type === 'key'">
                <span>终端键</span>
                <select
                  :aria-label="`具名终端键，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  :value="item.action.key"
                  @change="setKey(rowIndex, keyIndex, $event)"
                >
                  <option v-for="key in TERMINAL_KEYS" :key="key" :value="key">{{ key }}</option>
                </select>
              </label>
              <label v-else-if="item.action.type === 'text'">
                <span>发送字符</span>
                <input
                  :aria-label="`普通字符，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  maxlength="16"
                  :value="item.action.text"
                  @input="setText(rowIndex, keyIndex, $event)"
                >
              </label>
              <label v-else-if="item.action.type === 'modifier'">
                <span>修饰键</span>
                <select
                  :aria-label="`修饰键，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  :value="item.action.modifier"
                  @change="setModifier(rowIndex, keyIndex, $event)"
                >
                  <option value="ctrl">Ctrl</option>
                  <option value="alt">Alt</option>
                </select>
              </label>
              <div v-else class="shortcut-editor">
                <fieldset class="shortcut-modifiers">
                  <legend>组合修饰键</legend>
                  <label v-for="modifier in modifiers" :key="modifier">
                    <input
                      type="checkbox"
                      :aria-label="`组合修饰键 ${modifier === 'ctrl' ? 'Ctrl' : 'Alt'}，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                      :checked="item.action.modifiers.includes(modifier)"
                      @change="toggleShortcutModifier(rowIndex, keyIndex, modifier, $event)"
                    >
                    {{ modifier === 'ctrl' ? 'Ctrl' : 'Alt' }}
                  </label>
                </fieldset>
                <div v-for="(token, tokenIndex) in item.action.sequence" :key="tokenIndex" class="sequence-step">
                  <label>
                    <span>步骤 {{ tokenIndex + 1 }} 类型</span>
                    <select
                      :aria-label="`快捷序列类型，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个，第 ${tokenIndex + 1} 步`"
                      :value="token.type"
                      @change="updateTokenType(rowIndex, keyIndex, tokenIndex, $event)"
                    >
                      <option value="key">具名键</option>
                      <option value="text">字符</option>
                    </select>
                  </label>
                  <label v-if="token.type === 'key'">
                    <span>按键</span>
                    <select
                      :aria-label="`快捷序列按键，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个，第 ${tokenIndex + 1} 步`"
                      :value="token.key"
                      @change="updateTokenKey(rowIndex, keyIndex, tokenIndex, $event)"
                    >
                      <option v-for="key in TERMINAL_KEYS" :key="key" :value="key">{{ key }}</option>
                    </select>
                  </label>
                  <label v-else>
                    <span>字符</span>
                    <input
                      :aria-label="`快捷序列字符，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个，第 ${tokenIndex + 1} 步`"
                      maxlength="16"
                      :value="token.text"
                      @input="updateTokenText(rowIndex, keyIndex, tokenIndex, $event)"
                    >
                  </label>
                  <button
                    type="button"
                    :aria-label="`删除组合步骤，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个，第 ${tokenIndex + 1} 步`"
                    :disabled="item.action.sequence.length <= 1"
                    @pointerdown.prevent
                    @click="removeSequenceStep(rowIndex, keyIndex, tokenIndex)"
                  >移除步骤</button>
                </div>
                <button
                  type="button"
                  :aria-label="`添加组合步骤，第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个`"
                  @pointerdown.prevent
                  @click="addSequenceStep(rowIndex, keyIndex)"
                >添加步骤</button>
              </div>
            </article>
            <button
              type="button"
              class="add-key-button"
              :aria-label="`添加第 ${rowIndex + 1} 行快捷键`"
              @pointerdown.prevent
              @click="addKey(rowIndex)"
            >添加按键</button>
          </fieldset>
        </section>

        <section class="settings-section settings-about" aria-labelledby="settings-about-title">
          <h3 id="settings-about-title">关于与许可</h3>
          <p>终端字体：JetBrainsMono Nerd Font Mono Regular / Bold。固定来源 Nerd Fonts v3.4.0；JetBrains Mono 与 Nerd Fonts 字体补丁均按随附的 SIL Open Font License 1.1 通知分发。</p>
          <p class="license-links">
            <a href="https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/JetBrainsMono" target="_blank" rel="noreferrer">字体来源与固定版本</a>
            <a href="/fonts/OFL.txt" target="_blank" rel="noreferrer">JetBrains Mono OFL 1.1</a>
            <a href="/fonts/NERD-FONTS-LICENSE.txt" target="_blank" rel="noreferrer">Nerd Fonts 补丁许可说明</a>
          </p>
          <p>复用的 Web TTYd Hub 后端来源及 MIT 声明按固定上游版本记录在本项目第三方通知中。</p>
          <p class="license-links">
            <a href="https://github.com/sosopop/web-ttyd-hub/tree/325822e0328da9bf8aa38394455805438a0f76d5" target="_blank" rel="noreferrer">后端固定源码与上游声明</a>
          </p>
        </section>

        <footer class="settings-actions">
          <button type="button" aria-label="恢复默认设置" @pointerdown.prevent @click="restoreDefaults">恢复默认</button>
          <span class="settings-action-spacer"></span>
          <button type="button" aria-label="取消设置" @pointerdown.prevent @click="emit('close')">取消</button>
          <button type="submit" aria-label="保存设置" :disabled="!validatePreferences(draft)">保存</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0.5rem;
  background: #07080bc7;
}

.settings-sheet {
  display: flex;
  flex-direction: column;
  width: min(44rem, 100%);
  max-height: calc(var(--visual-viewport-height, 100dvh) - 1rem);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 0.85rem 0.85rem 0.6rem 0.6rem;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 1rem 3rem #000a;
}

.settings-header,
.settings-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 0.8rem;
}

.settings-header {
  justify-content: space-between;
  border-bottom: 1px solid #343a45;
}

.settings-header h2,
.settings-section h3 {
  margin: 0;
  font: 600 0.95rem/1.3 var(--font-interface);
}

.settings-header p,
.settings-help {
  margin: 0.15rem 0 0;
  color: var(--color-text-muted);
  font: 0.72rem/1.4 var(--font-interface);
}

.settings-content {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.7rem 0.8rem;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.1rem 0 0.8rem;
}

.settings-section + .settings-section {
  padding-top: 0.8rem;
  border-top: 1px solid #343a45;
}

.font-size-control {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.5rem;
}

.font-size-control input {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: var(--color-accent);
}

.visibility-control,
.shortcut-modifiers label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
}

input[type='checkbox'] {
  width: 1.15rem;
  height: 1.15rem;
  accent-color: var(--color-accent);
}

.key-row-editor,
.shortcut-modifiers {
  min-width: 0;
  margin: 0;
  padding: 0.55rem;
  border: 1px solid #343a45;
  border-radius: 0.55rem;
}

.key-row-editor legend,
.shortcut-modifiers legend {
  padding-inline: 0.3rem;
  color: #c8d0dc;
  font: 600 0.75rem/1.3 var(--font-interface);
}

.key-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.55rem;
  border: 1px solid #2e333d;
  border-radius: 0.5rem;
  background: #14171d;
}

.key-editor-heading {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  color: #c8d0dc;
  font-size: 0.75rem;
}

.key-editor label,
.sequence-step label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  color: var(--color-text-muted);
  font: 0.7rem/1.3 var(--font-interface);
}

.key-editor input,
.key-editor select,
.sequence-step input,
.sequence-step select,
.settings-header button,
.settings-actions button,
.key-editor button,
.add-key-button,
.sequence-step button,
.shortcut-editor > button {
  min-width: 0;
  min-height: 2.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
  padding: 0.35rem 0.5rem;
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: 0.8rem/1.25 var(--font-interface);
}

.key-editor input,
.key-editor select,
.sequence-step input,
.sequence-step select {
  width: 100%;
  background: #1b1f27;
}

.key-editor button,
.sequence-step button {
  padding-inline: 0.4rem;
  color: #c8d0dc;
}

.shortcut-editor {
  display: flex;
  grid-column: 1 / -1;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.shortcut-modifiers {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.75rem;
}

.sequence-step {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: 0.4rem;
  padding: 0.4rem;
  border: 1px solid #343a45;
  border-radius: 0.45rem;
}

.sequence-step button {
  grid-column: 1 / -1;
}

.settings-content :is(button, input, select):focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
}

.settings-content button:disabled,
.settings-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.add-key-button {
  width: 100%;
  margin-top: 0.55rem;
}

.settings-about p {
  margin: 0;
  color: var(--color-text-muted);
  font: 0.72rem/1.5 var(--font-interface);
}

.license-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.8rem;
}

.license-links a {
  color: #9ec3ff;
}

.settings-actions {
  border-top: 1px solid #343a45;
}

.settings-header button,
.settings-actions button {
  min-width: 4.2rem;
  padding-inline: 0.7rem;
}

.settings-action-spacer {
  flex: 1 1 auto;
}

@media (min-width: 800px) {
  .settings-backdrop {
    align-items: center;
  }

  .settings-sheet {
    max-height: min(85vh, 54rem);
    border-radius: 0.85rem;
  }
}
</style>
