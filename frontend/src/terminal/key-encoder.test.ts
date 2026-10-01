import { describe, expect, it } from 'vitest'
import { encodeKey, encodeSequence, encodeText } from './key-encoder'
import type { InputToken, TerminalModifier } from './key-encoder'
import { COMMON_SHORTCUTS, DEFAULT_KEY_ROWS, FUNCTION_KEYS } from './key-definitions'

describe('key definitions and terminal key encoding', () => {
  it('defines the requested two default key rows', () => {
    expect(DEFAULT_KEY_ROWS.map((row) => row.map(({ label }) => label))).toEqual([
      ['ESC', '/', '-', 'HOME', '↑', 'END', 'PGUP'],
      ['TAB', 'CTRL', 'ALT', '←', '↓', '→', 'PGDN'],
    ])
  })

  it('matches xterm Home/End CSI and application-cursor sequences', () => {
    expect(encodeKey('UP', { applicationCursorKeysMode: false })).toBe('\u001b[A')
    expect(encodeKey('UP', { applicationCursorKeysMode: true })).toBe('\u001bOA')
    expect(encodeKey('LEFT', { applicationCursorKeysMode: true })).toBe('\u001bOD')
    expect(encodeKey('HOME', { applicationCursorKeysMode: false })).toBe('\u001b[H')
    expect(encodeKey('END', { applicationCursorKeysMode: false })).toBe('\u001b[F')
    expect(encodeKey('HOME', { applicationCursorKeysMode: true })).toBe('\u001bOH')
    expect(encodeKey('END', { applicationCursorKeysMode: true })).toBe('\u001bOF')
    expect(encodeKey('HOME', { applicationCursorKeysMode: true, modifiers: ['ctrl', 'alt'] }))
      .toBe('\u001b[1;7H')
    expect(encodeKey('END', { applicationCursorKeysMode: true, modifiers: ['ctrl', 'alt'] }))
      .toBe('\u001b[1;7F')
  })

  it('encodes default and extended named keys, including every function key', () => {
    const base = { applicationCursorKeysMode: false }
    expect(encodeKey('ESC', base)).toBe('\u001b')
    expect(encodeKey('ESC', { ...base, modifiers: ['alt'] })).toBe('\u001b\u001b')
    expect(encodeKey('TAB', base)).toBe('\t')
    expect(encodeKey('PGUP', base)).toBe('\u001b[5~')
    expect(encodeKey('PGDN', base)).toBe('\u001b[6~')
    expect(encodeKey('TAB', { ...base, modifiers: ['alt'] })).toBe('\t')
    expect(encodeKey('PGUP', { ...base, modifiers: ['alt'] })).toBe('\u001b[5~')
    expect(encodeKey('PGUP', { ...base, modifiers: ['ctrl', 'alt'] })).toBe('\u001b[5;7~')
    expect(FUNCTION_KEYS.map((key) => encodeKey(key, base))).toEqual([
      '\u001bOP', '\u001bOQ', '\u001bOR', '\u001bOS',
      '\u001b[15~', '\u001b[17~', '\u001b[18~', '\u001b[19~',
      '\u001b[20~', '\u001b[21~', '\u001b[23~', '\u001b[24~',
    ])
  })

  it('encodes Ctrl, Alt, Ctrl+Alt, and modified cursor keys without altering Unicode text', () => {
    expect(encodeText('c', ['ctrl'])).toBe('\u0003')
    expect(encodeText('D', ['ctrl'])).toBe('\u0004')
    expect(encodeText('l', ['ctrl'])).toBe('\u000c')
    expect(encodeText('z', ['ctrl'])).toBe('\u001a')
    expect(encodeText('b', ['alt'])).toBe('\u001bb')
    expect(encodeText('f', ['alt'])).toBe('\u001bf')
    expect(encodeText('x', ['ctrl', 'alt'])).toBe('\u001b\u0018')
    expect(encodeText('\u001b', ['alt'])).toBe('\u001b\u001b')
    expect(encodeText('\r', ['alt'])).toBe('\u001b\r')
    expect(encodeText('中文🙂', ['ctrl', 'alt'])).toBe('中文🙂')
    expect(encodeText('ASCII 中文🙂', ['ctrl', 'alt'])).toBe('ASCII 中文🙂')
    expect(encodeKey('UP', { applicationCursorKeysMode: true, modifiers: ['ctrl', 'alt'] }))
      .toBe('\u001b[1;7A')
  })

  it('encodes named preset sequences and keeps slash/dash as literal text keys', () => {
    const base = { applicationCursorKeysMode: false }
    const tokens: InputToken[] = [
      { type: 'key', key: 'HOME' },
      { type: 'text', text: '/' },
      { type: 'text', text: '-' },
      { type: 'key', key: 'F12' },
    ]
    expect(encodeSequence(tokens, base)).toBe('\u001b[H/-\u001b[24~')
    expect(COMMON_SHORTCUTS.map((preset: { label: string }) => preset.label)).toEqual([
      'Ctrl+C', 'Ctrl+D', 'Ctrl+L', 'Ctrl+Z', 'Alt+B', 'Alt+F', 'Ctrl+Alt+F1', 'Ctrl+Alt+F2',
    ])
    const ctrlC = COMMON_SHORTCUTS[0]!
    expect(encodeSequence(ctrlC.sequence, { ...base, modifiers: ctrlC.modifiers as readonly TerminalModifier[] }))
      .toBe('\u0003')
  })
})
