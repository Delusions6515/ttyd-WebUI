// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TerminalView from './TerminalView.vue'

const terminalHarness = vi.hoisted(() => {
  const terminals: Array<{
    focusCalls: number
    input: HTMLTextAreaElement | undefined
    modes: { applicationCursorKeysMode: boolean }
    focus(): void
  }> = []
  const controllers: Array<{ sentInputs: string[]; setState(state: string): void }> = []

  class PublicTerminalMock {
    cols = 80
    rows = 24
    modes = { applicationCursorKeysMode: false }
    options: { disableStdin?: boolean }
    focusCalls = 0
    input: HTMLTextAreaElement | undefined = undefined

    constructor(options: unknown) {
      this.options = options as { disableStdin?: boolean }
      terminals.push(this)
    }

    loadAddon(): void {}
    open(parent: HTMLElement): void {
      this.input = document.createElement('textarea')
      this.input.setAttribute('aria-label', 'xterm mock input')
      parent.append(this.input)
    }
    focus(): void {
      this.focusCalls++
      this.input?.focus()
    }
    blur(): void { this.input?.blur() }
    reset(): void {}
    write(_data: Uint8Array, callback?: () => void): void { callback?.() }
    dispose(): void { this.input?.remove() }
    onData(): { dispose(): void } { return { dispose() {} } }
    onBinary(): { dispose(): void } { return { dispose() {} } }
    onResize(): { dispose(): void } { return { dispose() {} } }
    onTitleChange(): { dispose(): void } { return { dispose() {} } }
  }

  class PublicTerminalControllerMock {
    sentInputs: string[] = []
    private readonly terminal: PublicTerminalMock
    private readonly onState: (state: string, error?: string) => void

    constructor(options: { terminal: PublicTerminalMock; onState: (state: string, error?: string) => void }) {
      this.terminal = options.terminal
      this.onState = options.onState
      controllers.push(this)
      this.onState('connected')
    }

    setState(state: string): void { this.onState(state) }
    get applicationCursorKeysMode(): boolean { return this.terminal.modes.applicationCursorKeysMode }
    sendVirtualInput(data: string): boolean { this.sentInputs.push(data); return true }
    destroy(): void {}
  }

  return { terminals, controllers, PublicTerminalMock, PublicTerminalControllerMock }
})

vi.mock('@xterm/xterm', () => ({ Terminal: terminalHarness.PublicTerminalMock }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../terminal/terminal-controller', () => ({
  TerminalController: terminalHarness.PublicTerminalControllerMock,
  sessionAvailabilityFromSnapshot: () => ({ state: 'unknown' }),
}))

beforeEach(() => {
  terminalHarness.terminals.length = 0
  terminalHarness.controllers.length = 0
})

describe('TerminalView virtual input seam', () => {
  it('routes hardware keys exactly once from the modifier field without applying or consuming virtual modifiers', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'hardware_shell', enabled: true },
    })
    await nextTick()
    const controller = terminalHarness.controllers[0]!
    terminalHarness.terminals[0]!.modes.applicationCursorKeysMode = true
    await wrapper.find('button[aria-label="ALT"]').trigger('click')
    const field = wrapper.get('input[aria-label="虚拟 Ctrl/Alt 组合输入"]')
    for (const init of [
      { key: 'c', ctrlKey: true }, { key: 'ArrowUp' }, { key: 'F1' }, { key: 'Tab' }, { key: 'Escape' },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      field.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(controller.sentInputs).toEqual(['\u0003', '\u001bOA', '\u001bOP', '\t', '\u001b'])
    expect(wrapper.find('button[aria-label="ALT"]').attributes('data-mode')).toBe('once')
    controller.setState('stopped')
    await nextTick()
    field.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(controller.sentInputs).toHaveLength(5)
    wrapper.unmount()
  })

  it('sends only committed IME text and leaves its one-shot modifier untouched until commit', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'ime_shell', enabled: true },
    })
    await nextTick()
    const controller = terminalHarness.controllers[0]!
    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')

    const field = wrapper.find('input[aria-label="虚拟 Ctrl/Alt 组合输入"]')
    const element = field.element as HTMLInputElement
    element.value = '中文🙂'
    await field.trigger('compositionstart')
    const enterDuringComposition = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, isComposing: false,
    })
    element.dispatchEvent(enterDuringComposition)
    expect(enterDuringComposition.defaultPrevented).toBe(false)
    expect(controller.sentInputs).toEqual([])
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')

    await field.trigger('compositionend', { data: '中文🙂' })
    expect(controller.sentInputs).toEqual(['中文🙂'])
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('off')
    wrapper.unmount()
  })

  it('preserves current terminal focus for ordinary toolbar actions and focuses the owned input only on modifier activation', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'dev_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!
    terminal.focus()
    terminal.focusCalls = 0

    const up = wrapper.find('button[aria-label="↑"]')
    await up.trigger('pointerdown')
    await up.trigger('click')
    expect(terminal.focusCalls).toBe(0)
    expect(document.activeElement).toBe(terminal.input)
    expect(controller.sentInputs).toEqual(['\u001b[A'])

    await wrapper.find('button[aria-label="/"]').trigger('pointerdown')
    await wrapper.find('button[aria-label="/"]').trigger('click')
    expect(terminal.focusCalls).toBe(0)
    expect(document.activeElement).toBe(terminal.input)
    expect(controller.sentInputs).toEqual(['\u001b[A', '/'])

    await wrapper.find('button.extra-key-more').trigger('pointerdown')
    await wrapper.find('button.extra-key-more').trigger('click')
    await wrapper.find('button[aria-label="Ctrl+C"]').trigger('pointerdown')
    await wrapper.find('button[aria-label="Ctrl+C"]').trigger('click')
    expect(controller.sentInputs).toEqual(['\u001b[A', '/', '\u0003'])
    expect(terminal.focusCalls).toBe(0)
    expect(document.activeElement).toBe(terminal.input)

    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(document.activeElement).toBe(wrapper.find('input[aria-label="虚拟 Ctrl/Alt 组合输入"]').element)
    expect(terminal.focusCalls).toBe(0)
    wrapper.unmount()
  })
})
