export const TERMINAL_KEYS = [
  'ESC', 'TAB', 'HOME', 'END', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'PGUP', 'PGDN',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const

export type TerminalKey = typeof TERMINAL_KEYS[number]

export type TerminalModifier = 'ctrl' | 'alt'

export type InputToken =
  | { type: 'key'; key: TerminalKey }
  | { type: 'text'; text: string }

export interface KeyEncodingOptions {
  applicationCursorKeysMode: boolean
  modifiers?: readonly TerminalModifier[]
}

const cursorFinals: Readonly<Partial<Record<TerminalKey, string>>> = {
  UP: 'A', DOWN: 'B', RIGHT: 'C', LEFT: 'D', HOME: 'H', END: 'F',
}

const functionKeys: Readonly<Partial<Record<TerminalKey, Readonly<{ ss3: string; tilde?: number }>>>> = {
  F1: { ss3: 'P' }, F2: { ss3: 'Q' }, F3: { ss3: 'R' }, F4: { ss3: 'S' },
  F5: { ss3: '', tilde: 15 }, F6: { ss3: '', tilde: 17 }, F7: { ss3: '', tilde: 18 },
  F8: { ss3: '', tilde: 19 }, F9: { ss3: '', tilde: 20 }, F10: { ss3: '', tilde: 21 },
  F11: { ss3: '', tilde: 23 }, F12: { ss3: '', tilde: 24 },
}

function modifierParameter(modifiers: readonly TerminalModifier[]): number {
  return 1 + (modifiers.includes('alt') ? 2 : 0) + (modifiers.includes('ctrl') ? 4 : 0)
}

function modifiedCsi(final: string, modifiers: readonly TerminalModifier[]): string {
  return `\u001b[1;${modifierParameter(modifiers)}${final}`
}

function modifiedTilde(code: number, modifiers: readonly TerminalModifier[]): string {
  return `\u001b[${code};${modifierParameter(modifiers)}~`
}

export function encodeKey(key: TerminalKey, options: KeyEncodingOptions): string {
  const modifiers = options.modifiers ?? []
  const modified = modifiers.length > 0
  if (key === 'ESC') return encodeText('\u001b', modifiers)
  if (key === 'TAB') return '\t'

  const cursorFinal = cursorFinals[key]
  if (cursorFinal) {
    if (modified) return modifiedCsi(cursorFinal, modifiers)
    if (options.applicationCursorKeysMode) {
      return `\u001bO${cursorFinal}`
    }
    return `\u001b[${cursorFinal}`
  }

  if (key === 'PGUP' || key === 'PGDN') {
    const code = key === 'PGUP' ? 5 : 6
    return modifiers.includes('ctrl') ? modifiedTilde(code, modifiers) : `\u001b[${code}~`
  }

  const functionKey = functionKeys[key]
  if (functionKey) {
    if (functionKey.tilde !== undefined) {
      return modified ? modifiedTilde(functionKey.tilde, modifiers) : `\u001b[${functionKey.tilde}~`
    }
    return modified ? modifiedCsi(functionKey.ss3, modifiers) : `\u001bO${functionKey.ss3}`
  }

  return ''
}

export function encodeText(text: string, modifiers: readonly TerminalModifier[] = []): string {
  if (!text) return ''
  if (text === '\u001b') return modifiers.includes('alt') ? '\u001b\u001b' : '\u001b'
  if (text === '\r') return modifiers.includes('alt') ? '\u001b\r' : '\r'
  const codePoints = [...text]
  if (codePoints.length !== 1 || !/^[\x20-\x7e]$/.test(text)) return text

  let encoded = text
  if (modifiers.includes('ctrl')) {
    const character = text.toUpperCase()
    const code = character.charCodeAt(0)
    if ((code >= 0x40 && code <= 0x5f) || code === 0x20) {
      encoded = String.fromCharCode(code & 0x1f)
    } else if (text === '?') {
      encoded = '\u007f'
    }
  }
  if (modifiers.includes('alt')) encoded = `\u001b${encoded}`
  return encoded
}

export function encodeSequence(sequence: readonly InputToken[], options: KeyEncodingOptions): string {
  const modifiers = options.modifiers ?? []
  return sequence.map((token) => token.type === 'key'
    ? encodeKey(token.key, { ...options, modifiers })
    : encodeText(token.text, modifiers)).join('')
}
