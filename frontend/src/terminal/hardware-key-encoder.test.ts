// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { encodeHardwareKey } from './hardware-key-encoder'

describe('hardware key input from the modifier field', () => {
  it('encodes physical modifiers and application navigation independently of virtual state', () => {
    expect(encodeHardwareKey(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }), false)).toBe('\u0003')
    expect(encodeHardwareKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }), true)).toBe('\u001bOA')
    expect(encodeHardwareKey(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, altKey: true }), true)).toBe('\u001b[1;4A')
    expect(encodeHardwareKey(new KeyboardEvent('keydown', { key: 'F5', ctrlKey: true }), false)).toBe('\u001b[15;5~')
    expect(encodeHardwareKey(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }), false)).toBe('\u001b[Z')
  })

  it('leaves committed text, IME, system shortcuts and native clipboard paste alone', () => {
    for (const init of [
      { key: 'x' }, { key: '中文' }, { key: 'Enter', isComposing: true },
      { key: 'c', metaKey: true }, { key: 'v', ctrlKey: true },
    ]) expect(encodeHardwareKey(new KeyboardEvent('keydown', init), false)).toBeUndefined()
  })
})
