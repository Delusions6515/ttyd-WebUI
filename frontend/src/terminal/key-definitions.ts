import type { InputToken, TerminalKey, TerminalModifier } from './key-encoder'

export type ModifierMode = 'off' | 'once' | 'locked'
export type ModifierStates = Record<TerminalModifier, ModifierMode>

export type ToolbarKeyAction =
  | { type: 'key'; key: TerminalKey }
  | { type: 'text'; text: string }
  | { type: 'modifier'; modifier: TerminalModifier }

export interface ToolbarKey {
  label: string
  ariaLabel: string
  action: ToolbarKeyAction
}

export interface ShortcutPreset {
  label: string
  modifiers: readonly TerminalModifier[]
  sequence: readonly InputToken[]
}

function key(label: string, name: TerminalKey, ariaLabel = label): ToolbarKey {
  return { label, ariaLabel, action: { type: 'key', key: name } }
}

function text(label: string, value = label, ariaLabel = label): ToolbarKey {
  return { label, ariaLabel, action: { type: 'text', text: value } }
}

function modifier(name: TerminalModifier, label: string): ToolbarKey {
  return { label, ariaLabel: label, action: { type: 'modifier', modifier: name } }
}

export const DEFAULT_KEY_ROWS: readonly (readonly ToolbarKey[])[] = [
  [
    key('ESC', 'ESC'), text('/'), text('-'), key('HOME', 'HOME'), key('↑', 'UP', '↑'), key('END', 'END'), key('PGUP', 'PGUP'),
  ],
  [
    key('TAB', 'TAB'), modifier('ctrl', 'CTRL'), modifier('alt', 'ALT'),
    key('←', 'LEFT', '←'), key('↓', 'DOWN', '↓'), key('→', 'RIGHT', '→'), key('PGDN', 'PGDN'),
  ],
]

export const FUNCTION_KEYS: readonly TerminalKey[] = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]

export const EXTENDED_KEYS: readonly ToolbarKey[] = FUNCTION_KEYS.map((name) => key(name, name))

function shortcut(label: string, modifiers: readonly TerminalModifier[], token: InputToken): ShortcutPreset {
  return { label, modifiers, sequence: [token] }
}

export const COMMON_SHORTCUTS: readonly ShortcutPreset[] = [
  shortcut('Ctrl+C', ['ctrl'], { type: 'text', text: 'c' }),
  shortcut('Ctrl+D', ['ctrl'], { type: 'text', text: 'd' }),
  shortcut('Ctrl+L', ['ctrl'], { type: 'text', text: 'l' }),
  shortcut('Ctrl+Z', ['ctrl'], { type: 'text', text: 'z' }),
  shortcut('Alt+B', ['alt'], { type: 'text', text: 'b' }),
  shortcut('Alt+F', ['alt'], { type: 'text', text: 'f' }),
  shortcut('Ctrl+Alt+F1', ['ctrl', 'alt'], { type: 'key', key: 'F1' }),
  shortcut('Ctrl+Alt+F2', ['ctrl', 'alt'], { type: 'key', key: 'F2' }),
]
