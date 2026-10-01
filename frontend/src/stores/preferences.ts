import { reactive } from 'vue'
import { DEFAULT_KEY_ROWS } from '../terminal/key-definitions'
import type { ToolbarKey, ToolbarKeyAction } from '../terminal/key-definitions'
import { TERMINAL_KEYS } from '../terminal/key-encoder'
import type { InputToken, TerminalKey, TerminalModifier } from '../terminal/key-encoder'

export const PREFERENCES_STORAGE_KEY = 'ttyd-webui.preferences'
const PREFERENCES_VERSION = 1
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32
const TERMINAL_KEY_SET = new Set<string>(TERMINAL_KEYS)

export interface PreferencesSnapshot {
  keyRows: ToolbarKey[][]
  fontSize: number
  showExtraKeys: boolean
}

export interface PreferencesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const DEFAULT_PREFERENCES: PreferencesSnapshot = {
  keyRows: DEFAULT_KEY_ROWS.map((row) => row.map((item) => ({
    label: item.label,
    ariaLabel: item.ariaLabel,
    action: cloneAction(item.action),
  }))),
  fontSize: 13,
  showExtraKeys: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTerminalKey(value: unknown): value is TerminalKey {
  return typeof value === 'string' && TERMINAL_KEY_SET.has(value)
}

function isModifier(value: unknown): value is TerminalModifier {
  return value === 'ctrl' || value === 'alt'
}

function isPrintableText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function parseToken(value: unknown): InputToken | null {
  if (!isRecord(value)) return null
  if (value.type === 'key' && isTerminalKey(value.key)) return { type: 'key', key: value.key }
  if (value.type === 'text' && isPrintableText(value.text, 16)) return { type: 'text', text: value.text }
  return null
}

function parseAction(value: unknown): ToolbarKeyAction | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'key':
      return isTerminalKey(value.key) ? { type: 'key', key: value.key } : null
    case 'text':
      return isPrintableText(value.text, 16) ? { type: 'text', text: value.text } : null
    case 'modifier':
      return isModifier(value.modifier) ? { type: 'modifier', modifier: value.modifier } : null
    case 'shortcut': {
      if (!Array.isArray(value.modifiers) || !Array.isArray(value.sequence) || value.sequence.length === 0) return null
      const modifiers: TerminalModifier[] = []
      for (const modifier of value.modifiers) {
        if (!isModifier(modifier) || modifiers.includes(modifier)) return null
        modifiers.push(modifier)
      }
      const sequence: InputToken[] = []
      for (const token of value.sequence) {
        const parsed = parseToken(token)
        if (!parsed) return null
        sequence.push(parsed)
      }
      return { type: 'shortcut', modifiers, sequence }
    }
    default:
      return null
  }
}

function cloneAction(action: ToolbarKeyAction): ToolbarKeyAction {
  switch (action.type) {
    case 'key': return { type: 'key', key: action.key }
    case 'text': return { type: 'text', text: action.text }
    case 'modifier': return { type: 'modifier', modifier: action.modifier }
    case 'shortcut': return {
      type: 'shortcut',
      modifiers: [...action.modifiers],
      sequence: action.sequence.map((token) => token.type === 'key'
        ? { type: 'key', key: token.key }
        : { type: 'text', text: token.text }),
    }
  }
}

export function copyPreferences(preferences: PreferencesSnapshot): PreferencesSnapshot {
  return {
    keyRows: preferences.keyRows.map((row) => row.map((item) => ({
      label: item.label,
      ariaLabel: item.ariaLabel,
      action: cloneAction(item.action),
    }))),
    fontSize: preferences.fontSize,
    showExtraKeys: preferences.showExtraKeys,
  }
}

export function validatePreferences(value: unknown): PreferencesSnapshot | null {
  if (!isRecord(value)
    || !Number.isInteger(value.fontSize) || (value.fontSize as number) < MIN_FONT_SIZE || (value.fontSize as number) > MAX_FONT_SIZE
    || typeof value.showExtraKeys !== 'boolean'
    || !Array.isArray(value.keyRows) || value.keyRows.length !== 2) return null

  const keyRows: ToolbarKey[][] = []
  for (const rowValue of value.keyRows) {
    if (!Array.isArray(rowValue) || rowValue.length === 0) return null
    const row: ToolbarKey[] = []
    for (const itemValue of rowValue) {
      if (!isRecord(itemValue)
        || typeof itemValue.label !== 'string' || itemValue.label.length === 0 || itemValue.label.length > 12
        || typeof itemValue.ariaLabel !== 'string' || itemValue.ariaLabel.length === 0 || itemValue.ariaLabel.length > 48) return null
      const action = parseAction(itemValue.action)
      if (!action) return null
      row.push({ label: itemValue.label, ariaLabel: itemValue.ariaLabel, action })
    }
    keyRows.push(row)
  }
  return { keyRows, fontSize: value.fontSize as number, showExtraKeys: value.showExtraKeys }
}

function browserStorage(): PreferencesStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function readStoredPreferences(storage: PreferencesStorage | null): PreferencesSnapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== PREFERENCES_VERSION) return null
    return validatePreferences(parsed)
  } catch {
    return null
  }
}

function encodePreferences(preferences: PreferencesSnapshot): string {
  return JSON.stringify({ version: PREFERENCES_VERSION, ...copyPreferences(preferences) })
}

export function createPreferencesStore(storage?: PreferencesStorage | null) {
  const activeStorage = storage === undefined ? browserStorage() : storage
  const state = reactive(copyPreferences(readStoredPreferences(activeStorage) ?? DEFAULT_PREFERENCES))

  function write(preferences: PreferencesSnapshot): void {
    if (!activeStorage) return
    try {
      activeStorage.setItem(PREFERENCES_STORAGE_KEY, encodePreferences(preferences))
    } catch {
      // Keep browser-session preferences usable when storage is unavailable.
    }
  }

  function save(value: unknown): boolean {
    const parsed = validatePreferences(value)
    if (!parsed) return false
    Object.assign(state, copyPreferences(parsed))
    write(parsed)
    return true
  }

  function reset(): void {
    Object.assign(state, copyPreferences(DEFAULT_PREFERENCES))
    write(DEFAULT_PREFERENCES)
  }

  return { state, save, reset }
}
