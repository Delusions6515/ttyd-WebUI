import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalInputController } from './input-controller'
import type { InputToken } from './key-encoder'
import { COMMON_SHORTCUTS } from './key-definitions'

function makeController(options: { send?: (data: string) => boolean } = {}) {
  const send = options.send ?? vi.fn(() => true)
  const applicationCursorKeysMode = { value: false }
  const controller = new TerminalInputController({
    sendInput: send,
    getApplicationCursorKeysMode: () => applicationCursorKeysMode.value,
  })
  return { controller, send, applicationCursorKeysMode }
}

afterEach(() => vi.useRealTimers())

describe('TerminalInputController', () => {
  it('consumes one-shot modifiers once and keeps locked modifiers until toggled off', () => {
    const { controller, send } = makeController()
    controller.toggleModifier('ctrl')
    expect(controller.modifiers).toEqual({ ctrl: 'once', alt: 'off' })
    expect(controller.submitText('c')).toBe(true)
    expect(send).toHaveBeenLastCalledWith('\u0003')
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })

    controller.lockModifier('ctrl')
    controller.pressKey('TAB')
    controller.pressKey('TAB')
    expect(send).toHaveBeenLastCalledWith('\t')
    expect(send).toHaveBeenCalledTimes(3)
    expect(controller.modifiers).toEqual({ ctrl: 'locked', alt: 'off' })
    controller.toggleModifier('ctrl')
    expect(controller.modifiers.ctrl).toBe('off')
    controller.destroy()
  })

  it('encodes Alt and Ctrl+Alt input and leaves non-ASCII commits unchanged', () => {
    const { controller, send } = makeController()
    controller.toggleModifier('alt')
    controller.submitText('b')
    expect(send).toHaveBeenLastCalledWith('\u001bb')

    controller.toggleModifier('ctrl')
    controller.toggleModifier('alt')
    controller.submitText('x')
    expect(send).toHaveBeenLastCalledWith('\u001b\u0018')
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })

    controller.toggleModifier('ctrl')
    controller.submitText('中文🙂')
    expect(send).toHaveBeenLastCalledWith('中文🙂')
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })

    controller.toggleModifier('alt')
    controller.submitText('\r')
    expect(send).toHaveBeenLastCalledWith('\u001b\r')
    expect(controller.modifiers.alt).toBe('off')
    controller.destroy()
  })

  it('uses application-cursor mode at send time and sends named sequences as one current input', () => {
    const { controller, send, applicationCursorKeysMode } = makeController()
    controller.pressKey('UP')
    expect(send).toHaveBeenLastCalledWith('\u001b[A')
    applicationCursorKeysMode.value = true
    controller.pressKey('UP')
    expect(send).toHaveBeenLastCalledWith('\u001bOA')

    const sequence: InputToken[] = [
      { type: 'key', key: 'ESC' },
      { type: 'text', text: 'x' },
      { type: 'key', key: 'F1' },
    ]
    controller.sendSequence(sequence)
    expect(send).toHaveBeenLastCalledWith('\u001bx\u001bOP')
    controller.destroy()
  })

  it('applies preset combinations as the next key and preserves non-key text sources', () => {
    const { controller, send } = makeController()
    controller.toggleModifier('alt')
    expect(controller.sendPreset(COMMON_SHORTCUTS[0]!)).toBe(true)
    expect(send).toHaveBeenLastCalledWith('\u001b\u0003')
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })

    controller.toggleModifier('ctrl')
    controller.submitText('ASCII 中文🙂\nsecond line', 'paste')
    expect(send).toHaveBeenLastCalledWith('ASCII 中文🙂\nsecond line')
    expect(controller.modifiers.ctrl).toBe('once')
    controller.submitText('text pane 中文🙂', 'text')
    expect(send).toHaveBeenLastCalledWith('text pane 中文🙂')
    expect(controller.modifiers.ctrl).toBe('once')
    controller.submitText('d')
    expect(send).toHaveBeenLastCalledWith('\u0004')
    controller.destroy()
  })

  it('does not read terminal mode after disposal', () => {
    const mode = vi.fn(() => false)
    const controller = new TerminalInputController({
      sendInput: vi.fn(() => true),
      getApplicationCursorKeysMode: mode,
    })
    controller.destroy()
    expect(controller.pressKey('UP')).toBe(false)
    expect(mode).not.toHaveBeenCalled()
  })

  it('rejects stale submissions and drops input without a connection instead of replaying it', () => {
    const send = vi.fn(() => false)
    const { controller } = makeController({ send })
    const oldGeneration = controller.generation
    controller.toggleModifier('alt')
    expect(controller.submitText('x')).toBe(false)
    expect(send).toHaveBeenCalledWith('\u001bx')
    controller.reset()
    expect(controller.submitText('stale', 'virtual', oldGeneration)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })
    controller.destroy()
  })

  it('rejects a delayed composition token from a replaced session controller', () => {
    const first = makeController()
    const staleGeneration = first.controller.generation
    first.controller.toggleModifier('ctrl')
    first.controller.destroy()

    const second = makeController()
    expect(second.controller.submitText('c', 'virtual', staleGeneration)).toBe(false)
    expect(second.send).not.toHaveBeenCalled()
    second.controller.destroy()
  })

  it('clears modifier and composition generations when the page becomes hidden', () => {
    let visibilityListener: (() => void) | undefined
    const target = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: vi.fn((_type: string, listener: () => void) => { visibilityListener = listener }),
      removeEventListener: vi.fn(),
    }
    const controller = new TerminalInputController({
      sendInput: vi.fn(() => true),
      getApplicationCursorKeysMode: () => false,
      visibilityTarget: target,
    })
    const generation = controller.generation
    controller.lockModifier('alt')
    target.visibilityState = 'hidden'
    visibilityListener?.()
    expect(controller.modifiers).toEqual({ ctrl: 'off', alt: 'off' })
    expect(controller.generation).toBeGreaterThan(generation)
    expect(target.removeEventListener).not.toHaveBeenCalled()
    controller.destroy()
    expect(target.removeEventListener).toHaveBeenCalledOnce()
  })
})
