import { encodeKey, encodeText } from './key-encoder'
import type { TerminalKey, TerminalModifier } from './key-encoder'

const namedKeys: Readonly<Record<string, TerminalKey>> = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
  Escape: 'ESC', Tab: 'TAB',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
}

export function encodeHardwareKey(event: KeyboardEvent, applicationCursorKeysMode: boolean): string | undefined {
  if (event.isComposing || event.keyCode === 229 || event.metaKey || event.getModifierState('AltGraph')) return undefined
  // Let the native paste event supply clipboard text rather than turning Ctrl+V into input.
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'v') return undefined
  const modifiers: TerminalModifier[] = []
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  const parameter = 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0)
  if (event.key === 'Tab') return event.shiftKey ? '\u001b[Z' : '\t'
  if (event.key === 'Backspace') return `${event.altKey ? '\u001b' : ''}${event.ctrlKey ? '\b' : '\u007f'}`
  if (event.key === 'Delete' || event.key === 'Insert') {
    const code = event.key === 'Delete' ? 3 : 2
    return parameter === 1 ? `\u001b[${code}~` : `\u001b[${code};${parameter}~`
  }
  const named = Object.hasOwn(namedKeys, event.key) ? namedKeys[event.key] : undefined
  if (named) {
    const unmodified = encodeKey(named, { applicationCursorKeysMode })
    if (parameter === 1 || named === 'ESC') return encodeKey(named, { applicationCursorKeysMode, modifiers })
    if (/^\u001b\[[0-9]+~$/.test(unmodified)) return unmodified.replace('~', `;${parameter}~`)
    return `\u001b[1;${parameter}${unmodified.at(-1)}`
  }
  if (event.key === 'Enter' && modifiers.length > 0) return `${event.altKey ? '\u001b' : ''}\r`
  if (modifiers.length > 0 && /^[\x20-\x7e]$/.test(event.key)) return encodeText(event.key, modifiers)
  return undefined
}
