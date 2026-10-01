// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExtraKeysBar from './ExtraKeysBar.vue'
import ModifierInput from './ModifierInput.vue'
import type { ToolbarKey } from '../terminal/key-definitions'
type ModifierStates = { ctrl: 'off' | 'once' | 'locked'; alt: 'off' | 'once' | 'locked' }

const off: ModifierStates = { ctrl: 'off', alt: 'off' }

function mountBar() {
  return mount(ExtraKeysBar, {
    props: { connected: true, modifierState: off, inputEpoch: 3 },
  })
}

afterEach(() => vi.useRealTimers())

describe('ExtraKeysBar', () => {
  it('renders the default Termux rows and sends a virtual key action', async () => {
    const wrapper = mountBar()
    const rows = wrapper.findAll('.extra-key-row')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.findAll('button').map((button) => button.text()))).toEqual([
      ['ESC', '/', '-', 'HOME', '↑', 'END', 'PGUP'],
      ['TAB', 'CTRL', 'ALT', '←', '↓', '→', 'PGDN'],
    ])
    await wrapper.find('button[aria-label="↑"]').trigger('click')
    expect(wrapper.emitted('key')).toEqual([['UP']])
    await wrapper.find('button.extra-key-more').trigger('click')
    expect(wrapper.findAll('.extra-key-function-row button')).toHaveLength(12)
    await wrapper.find('button[aria-label="F12"]').trigger('click')
    expect(wrapper.emitted('key')).toEqual([['UP'], ['F12']])
    await wrapper.find('button[aria-label="Ctrl+C"]').trigger('click')
    expect(wrapper.emitted('shortcut')).toHaveLength(1)
    wrapper.unmount()
  })

  it('renders configured key rows and routes plain shortcut data as terminal input', async () => {
    const keyRows: readonly (readonly ToolbarKey[])[] = [[
      {
        label: 'Ctrl+F12',
        ariaLabel: 'Custom terminal shortcut',
        action: {
          type: 'shortcut',
          modifiers: ['ctrl'],
          sequence: [{ type: 'text', text: 'x' }, { type: 'key', key: 'F12' }],
        },
      },
    ], [{ label: 'slash', ariaLabel: 'slash', action: { type: 'text', text: '/' } }]]
    const wrapper = mount(ExtraKeysBar, {
      props: { connected: true, modifierState: off, inputEpoch: 3, keyRows },
    })

    expect(wrapper.findAll('.extra-key-row').map((row) => row.text())).toEqual(['Ctrl+F12', 'slash'])
    await wrapper.find('button[aria-label="Custom terminal shortcut"]').trigger('click')
    expect(wrapper.emitted('shortcut')).toEqual([[
      { label: 'Ctrl+F12', modifiers: ['ctrl'], sequence: [{ type: 'text', text: 'x' }, { type: 'key', key: 'F12' }] },
    ]])
    wrapper.unmount()
  })

  it('renders markup-looking configuration as inert text and emits only its input data', async () => {
    const label = '<b>input</b>'
    const keyRows: readonly (readonly ToolbarKey[])[] = [
      [{ label, ariaLabel: 'Plain text action', action: { type: 'text', text: 'alert(1)' } }],
      [{ label: 'F12', ariaLabel: 'F12', action: { type: 'key', key: 'F12' } }],
    ]
    const wrapper = mount(ExtraKeysBar, {
      props: { connected: true, modifierState: off, inputEpoch: 5, keyRows },
    })
    const button = wrapper.get('button[aria-label="Plain text action"]')
    expect(button.text()).toBe(label)
    expect(wrapper.find('b').exists()).toBe(false)
    await button.trigger('click')
    expect(wrapper.emitted('text')).toEqual([['alert(1)', 5]])
    expect(wrapper.emitted('shortcut')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows one-shot and locked modifier state accessibly', () => {
    const wrapper = mount(ExtraKeysBar, {
      attachTo: document.body,
      props: { connected: true, modifierState: { ctrl: 'once', alt: 'locked' }, inputEpoch: 0 },
    })
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')
    expect(wrapper.find('button[aria-label="ALT"]').attributes('data-mode')).toBe('locked')
    expect(wrapper.find('.modifier-entry').classes()).toContain('is-active')
    const exposed = wrapper.vm as unknown as { focusModifierInput(): void }
    exposed.focusModifierInput()
    expect(document.activeElement).toBe(wrapper.find('input').element)
    wrapper.unmount()
  })

  it('locks on long press without a second click and treats pointer cancellation as no action', async () => {
    vi.useFakeTimers()
    const wrapper = mountBar()
    const ctrl = wrapper.find('button[aria-label="CTRL"]')
    await ctrl.trigger('pointerdown', { pointerId: 1 })
    await vi.advanceTimersByTimeAsync(600)
    expect(wrapper.emitted('lockModifier')).toEqual([['ctrl']])
    await ctrl.trigger('pointerup', { pointerId: 1 })
    await ctrl.trigger('click')
    expect(wrapper.emitted('modifier')).toBeUndefined()
    expect(wrapper.emitted('focusModifierInput')).toHaveLength(1)

    const alt = wrapper.find('button[aria-label="ALT"]')
    await alt.trigger('pointerdown', { pointerId: 2 })
    await alt.trigger('pointercancel', { pointerId: 2 })
    expect(wrapper.emitted('lockModifier')).toHaveLength(1)
    const focusEvents = wrapper.emitted('focusModifierInput')?.length ?? 0
    await vi.advanceTimersByTimeAsync(600)
    expect(wrapper.emitted('focusModifierInput')).toHaveLength(focusEvents)
    expect(wrapper.emitted('modifier')).toBeUndefined()
    expect(wrapper.emitted('key')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels a pending long press when the page is hidden', async () => {
    vi.useFakeTimers()
    const wrapper = mountBar()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const ctrl = wrapper.find('button[aria-label="CTRL"]')
    await ctrl.trigger('pointerdown', { pointerId: 7 })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(600)
    expect(wrapper.emitted('lockModifier')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the input generation captured on focus when a connection is replaced', async () => {
    const wrapper = mountBar()
    const field = wrapper.find('input')
    await field.trigger('focus')
    await wrapper.setProps({ inputEpoch: 4 })
    const element = field.element as HTMLInputElement
    element.value = 'late'
    await field.trigger('input', { inputType: 'insertText', data: 'late' })
    expect(wrapper.emitted('text')).toEqual([['late', 3]])
    wrapper.unmount()
  })

  it('does not send Enter while composing and sends committed IME text once before later Enter', async () => {
    const wrapper = mountBar()
    const field = wrapper.getComponent(ModifierInput).find('input')
    const element = field.element as HTMLInputElement
    await field.trigger('focus')
    await field.trigger('compositionstart')
    element.value = '中文🙂'

    const enterDuringComposition = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, isComposing: false,
    })
    element.dispatchEvent(enterDuringComposition)
    expect(enterDuringComposition.defaultPrevented).toBe(false)
    expect(wrapper.emitted('text')).toBeUndefined()

    await field.trigger('compositionend', { data: '中文🙂' })
    expect(wrapper.emitted('text')).toEqual([['中文🙂', 3]])
    element.value = '中文🙂'
    await field.trigger('input', { data: '中文🙂', inputType: 'insertText', isComposing: false })
    expect(wrapper.emitted('text')).toHaveLength(1)

    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, isComposing: true,
    })
    element.dispatchEvent(composingEnter)
    expect(composingEnter.defaultPrevented).toBe(false)
    expect(wrapper.emitted('text')).toHaveLength(1)

    const normalEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    element.dispatchEvent(normalEnter)
    expect(normalEnter.defaultPrevented).toBe(true)
    expect(wrapper.emitted('text')).toEqual([['中文🙂', 3], ['\r', 3]])
    wrapper.unmount()
  })

  it('sends committed IME text once and routes paste without modifier rewriting', async () => {
    const wrapper = mountBar()
    const input = wrapper.getComponent(ModifierInput)
    const fieldWrapper = input.find('input')
    const field = fieldWrapper.element as HTMLInputElement
    field.value = '中文🙂'
    await fieldWrapper.trigger('compositionstart')
    await fieldWrapper.trigger('input', { isComposing: true, inputType: 'insertCompositionText' })
    expect(wrapper.emitted('text')).toBeUndefined()
    await fieldWrapper.trigger('compositionend', { data: '中文🙂' })
    expect(wrapper.emitted('text')).toEqual([['中文🙂', 3]])

    field.value = '中文🙂'
    await fieldWrapper.trigger('input', { inputType: 'insertText', data: '中文🙂' })
    expect(wrapper.emitted('text')).toHaveLength(1)

    await fieldWrapper.trigger('paste', {
      clipboardData: { getData: () => 'pasted 中文\n' },
    })
    expect(wrapper.emitted('paste')).toEqual([['pasted 中文\n', 3]])
    wrapper.unmount()
  })

  it('does not allow input or virtual key actions while disconnected', async () => {
    const wrapper = mount(ExtraKeysBar, {
      props: { connected: false, modifierState: off, inputEpoch: 0 },
    })
    const key = wrapper.find('button[aria-label="↑"]')
    expect((key.element as HTMLButtonElement).disabled).toBe(true)
    await key.trigger('click')
    expect(wrapper.emitted('key')).toBeUndefined()
    await wrapper.find('button.extra-key-more').trigger('click')
    await wrapper.find('button[aria-label="Ctrl+C"]').trigger('click')
    expect(wrapper.emitted('shortcut')).toBeUndefined()
    wrapper.unmount()
  })
})
