// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Component } from 'vue'
import type { ToolbarKey } from '../terminal/key-definitions'

let TerminalView: Component
beforeAll(async () => {
  TerminalView = (await vi.importActual<{ default: Component }>('./TerminalView.vue')).default
})

const terminalHarness = vi.hoisted(() => {
  const terminals: Array<{
    focusCalls: number
    textarea: HTMLTextAreaElement | undefined
    modes: { applicationCursorKeysMode: boolean }
    pasteCalls: string[]
    inputCalls: Array<{ data: string; wasUserInput?: boolean }>
    scrollCalls: number[]
    bottomCalls: number
    selection: string
    bufferLines: Array<{ text: string; isWrapped: boolean }>
    wheelHandler: ((event: WheelEvent) => boolean) | undefined
    options: { disableStdin?: boolean; fontFamily?: string; fontSize?: number }
    focus(): void
  }> = []
  const controllers: Array<{ sentInputs: string[]; fontSizes: number[]; setState(state: string): void }> = []

  class PublicTerminalMock {
    cols = 80
    rows = 24
    modes = { applicationCursorKeysMode: false }
    options: { disableStdin?: boolean; fontFamily?: string; fontSize?: number }
    focusCalls = 0
    textarea: HTMLTextAreaElement | undefined = undefined
    pasteCalls: string[] = []
    inputCalls: Array<{ data: string; wasUserInput?: boolean }> = []
    scrollCalls: number[] = []
    bottomCalls = 0
    selection = ''
    bufferLines = [{ text: 'snapshot', isWrapped: false }]
    wheelHandler: ((event: WheelEvent) => boolean) | undefined
    get buffer() {
      const lines = this.bufferLines
      return {
        active: {
          length: lines.length,
          getLine: (index: number) => {
            const value = lines[index]
            return value && {
              isWrapped: value.isWrapped,
              translateToString: () => value.text,
            }
          },
        },
      }
    }

    constructor(options: unknown) {
      this.options = options as { disableStdin?: boolean; fontFamily?: string; fontSize?: number }
      terminals.push(this)
    }

    loadAddon(): void {}
    attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void { this.wheelHandler = handler }
    scrollLines(amount: number): void { this.scrollCalls.push(amount) }
    scrollToBottom(): void { this.bottomCalls++ }
    hasSelection(): boolean { return Boolean(this.selection) }
    getSelection(): string { return this.selection }
    paste(data: string): void { this.pasteCalls.push(data) }
    input(data: string, wasUserInput?: boolean): void { this.inputCalls.push({ data, wasUserInput }) }
    open(parent: HTMLElement): void {
      this.textarea = document.createElement('textarea')
      this.textarea.setAttribute('aria-label', 'xterm mock input')
      parent.append(this.textarea)
    }
    focus(): void {
      this.focusCalls++
      this.textarea?.focus()
    }
    blur(): void { this.textarea?.blur() }
    reset(): void {}
    write(_data: Uint8Array, callback?: () => void): void { callback?.() }
    dispose(): void { this.textarea?.remove() }
    onData(): { dispose(): void } { return { dispose() {} } }
    onBinary(): { dispose(): void } { return { dispose() {} } }
    onResize(): { dispose(): void } { return { dispose() {} } }
    onTitleChange(): { dispose(): void } { return { dispose() {} } }
  }

  class PublicTerminalControllerMock {
    sentInputs: string[] = []
    fontSizes: number[] = []
    private readonly terminal: PublicTerminalMock
    private readonly onState: (state: string, error?: string) => void

    constructor(options: { terminal: PublicTerminalMock; onState: (state: string, error?: string) => void }) {
      this.terminal = options.terminal
      this.onState = options.onState
      controllers.push(this)
      this.onState('connected')
    }

    setState(state: string): void { this.onState(state) }
    setFontSize(fontSize: number): void { this.fontSizes.push(fontSize) }
    get applicationCursorKeysMode(): boolean { return this.terminal.modes.applicationCursorKeysMode }
    sendVirtualInput(data: string): boolean { this.sentInputs.push(data); return true }
    destroy(): void {}
  }

  return { terminals, controllers, PublicTerminalMock, PublicTerminalControllerMock }
})

const sessionApiMock = vi.hoisted(() => ({ scrollSession: vi.fn() }))

vi.mock('@xterm/xterm', () => ({ Terminal: terminalHarness.PublicTerminalMock }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../api/sessions', () => ({ sessionApi: sessionApiMock }))
vi.mock('../terminal/terminal-controller', () => ({
  TerminalController: terminalHarness.PublicTerminalControllerMock,
  sessionAvailabilityFromSnapshot: () => ({ state: 'unknown' }),
}))

beforeEach(() => {
  terminalHarness.terminals.length = 0
  terminalHarness.controllers.length = 0
  sessionApiMock.scrollSession.mockReset()
  sessionApiMock.scrollSession.mockResolvedValue({ name: 'stub', shell: 'bash', status: 'running', port: 1, pid: null, createdAt: '2026-10-01T00:00:00.000Z' })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

function setClipboard(
  readText: () => Promise<string>,
  writeText: (text: string) => Promise<void> = vi.fn().mockResolvedValue(undefined),
): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText, writeText } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface TestTouch {
  identifier: number
  clientY: number
}

function touchEvent(type: string, touches: TestTouch[], changedTouches = touches): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    touches: { configurable: true, value: touches },
    changedTouches: { configurable: true, value: changedTouches },
  })
  return event as unknown as TouchEvent
}

describe('TerminalView virtual input seam', () => {
  it('uses bundled Nerd Font settings and updates terminal size and configured rows without a page zoom', async () => {
    const customRows: readonly (readonly ToolbarKey[])[] = [[
      { label: 'RUN', ariaLabel: 'Run shortcut', action: { type: 'text', text: 'x' } },
    ], [{ label: 'F12', ariaLabel: 'F12', action: { type: 'key', key: 'F12' } }]]
    const wrapper = mount(TerminalView, {
      props: { sessionName: 'preferences_shell', enabled: true, fontSize: 17, keyRows: customRows, showExtraKeys: false },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!

    expect(terminal.options.fontSize).toBe(17)
    expect(terminal.options.fontFamily).toContain('JetBrainsMono Nerd Font Mono')
    expect(terminal.options.fontFamily).toContain('monospace')
    expect(wrapper.find('.extra-keys-bar').exists()).toBe(false)

    await wrapper.setProps({ fontSize: 19, showExtraKeys: true })
    await nextTick()
    expect(controller.fontSizes).toEqual([19])
    expect(wrapper.findAll('.extra-key-row').map((row) => row.text())).toEqual(['RUN', 'F12'])
    expect(wrapper.find('.extra-key-more').exists()).toBe(false)
    expect(wrapper.find('.extra-key-expanded').exists()).toBe(false)
    wrapper.unmount()
  })
  it('exposes the terminal tools entry point for touch copy, paste and local scrolling', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'tools_shell', enabled: true },
    })
    await nextTick()
    expect(wrapper.find('button[aria-label="终端工具"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('clears active virtual modifiers when the configurable key bar is hidden', async () => {
    const wrapper = mount(TerminalView, {
      props: { sessionName: 'hidden_keybar_shell', enabled: true },
    })
    await nextTick()
    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')

    await wrapper.setProps({ showExtraKeys: false })
    expect(wrapper.find('.extra-keys-bar').exists()).toBe(false)
    await wrapper.setProps({ showExtraKeys: true })
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('off')
    wrapper.unmount()
  })

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
    expect(document.activeElement).toBe(terminal.textarea)
    expect(controller.sentInputs).toEqual(['\u001b[A'])

    await wrapper.find('button[aria-label="/"]').trigger('pointerdown')
    await wrapper.find('button[aria-label="/"]').trigger('click')
    expect(terminal.focusCalls).toBe(0)
    expect(document.activeElement).toBe(terminal.textarea)
    expect(controller.sentInputs).toEqual(['\u001b[A', '/'])

    await wrapper.find('button[aria-label="终端工具"]').trigger('pointerdown')
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'Ctrl+C')!.trigger('pointerdown')
    await wrapper.findAll('button').find((button) => button.text() === 'Ctrl+C')!.trigger('click')
    expect(controller.sentInputs).toEqual(['\u001b[A', '/', '\u0003'])
    expect(terminal.focusCalls).toBe(0)
    expect(document.activeElement).toBe(terminal.textarea)

    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(document.activeElement).toBe(wrapper.find('input[aria-label="虚拟 Ctrl/Alt 组合输入"]').element)
    expect(terminal.focusCalls).toBe(0)
    wrapper.unmount()
  })

  it('routes clipboard and text-panel content through xterm paste, with only explicit Enter added', async () => {
    setClipboard(async () => 'first\n中文🙂')
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'paste_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!

    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    await vi.waitFor(() => expect(terminal.pasteCalls).toEqual(['first\n中文🙂']))
    expect(controller.sentInputs).toEqual([])
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')

    await wrapper.findAll('button').find((button) => button.text() === '输入长文本')!.trigger('click')
    const textField = wrapper.get('textarea[aria-label="要发送的文本"]')
    await textField.setValue('command\nargument')
    await wrapper.findAll('button').find((button) => button.text() === '发送文本')!.trigger('click')
    expect(terminal.pasteCalls).toEqual(['first\n中文🙂', 'command\nargument'])
    expect(terminal.inputCalls).toEqual([])

    await wrapper.findAll('button').find((button) => button.text() === '输入长文本')!.trigger('click')
    await wrapper.get('textarea[aria-label="要发送的文本"]').setValue('run it')
    await wrapper.findAll('button').find((button) => button.text() === '发送并回车')!.trigger('click')
    expect(terminal.pasteCalls).toEqual(['first\n中文🙂', 'command\nargument', 'run it'])
    expect(terminal.inputCalls).toEqual([{ data: '\r', wasUserInput: true }])
    expect(wrapper.find('button[aria-label="CTRL"]').attributes('data-mode')).toBe('once')
    expect(controller.sentInputs).toEqual([])
    wrapper.unmount()
  })

  it('opens the system-paste text box when clipboard access is missing or denied', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'fallback_shell', enabled: true },
    })
    await nextTick()
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    expect(wrapper.find('textarea[aria-label="要发送的文本"]').exists()).toBe(true)
    wrapper.unmount()

    setClipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
    const denied = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'denied_clipboard', enabled: true },
    })
    await nextTick()
    await denied.find('button[aria-label="终端工具"]').trigger('click')
    await denied.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    await vi.waitFor(() => expect(denied.find('textarea[aria-label="要发送的文本"]').exists()).toBe(true))
    denied.unmount()
  })

  it('does not send clipboard text after its session target changes while the read is pending', async () => {
    const clipboard = deferred<string>()
    setClipboard(() => clipboard.promise)
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'session_a', enabled: true },
    })
    await nextTick()
    const originalTerminal = terminalHarness.terminals[0]!
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')

    await wrapper.setProps({ sessionName: 'session_b' })
    await vi.waitFor(() => expect(terminalHarness.terminals).toHaveLength(2))
    clipboard.resolve('must not reach session B')
    await vi.waitFor(() => expect(originalTerminal.pasteCalls).toEqual([]))
    expect(terminalHarness.terminals[1]!.pasteCalls).toEqual([])
    expect(wrapper.find('textarea[aria-label="要发送的文本"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('drops a pending clipboard result after disconnect and clears text input on close', async () => {
    const clipboard = deferred<string>()
    setClipboard(() => clipboard.promise)
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'disconnect_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    terminalHarness.controllers[0]!.setState('disconnected')
    clipboard.resolve('late paste')
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.pasteCalls).toEqual([])
    expect(wrapper.find('textarea[aria-label="要发送的文本"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('copies selected text when allowed and exposes a selectable fallback without sending a key', async () => {
    setClipboard(async () => '', async () => { throw new DOMException('denied', 'NotAllowedError') })
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'copy_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '复制所选文本')!.trigger('click')
    expect(wrapper.text()).toContain('请先在终端中选择文本')
    expect(controller.sentInputs).toEqual([])

    terminal.selection = 'selected text'
    await wrapper.findAll('button').find((button) => button.text() === '复制所选文本')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('textarea[aria-label="终端文本快照"]').exists()).toBe(true))
    expect((wrapper.get('textarea[aria-label="终端文本快照"]').element as HTMLTextAreaElement).value).toBe('selected text')
    expect(controller.sentInputs).toEqual([])
    wrapper.unmount()
  })

  it('does not give the terminal focus when a modifier clears, so tapping a key cannot raise the keyboard', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'modifier_focus_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!
    // Nothing is focused yet: the reader has not touched the terminal.
    expect(document.activeElement).not.toBe(terminal.textarea)

    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(document.activeElement).toBe(wrapper.find('input[aria-label="虚拟 Ctrl/Alt 组合输入"]').element)
    terminal.focusCalls = 0

    // Releasing the modifier must not hand focus to the terminal on a touch device.
    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(document.activeElement).not.toBe(terminal.textarea)
    expect(terminal.focusCalls).toBe(0)

    // A tap on the terminal itself still keeps focus when the modifier clears.
    terminal.focus()
    terminal.focusCalls = 0
    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    await wrapper.find('button[aria-label="CTRL"]').trigger('click')
    expect(terminal.focusCalls).toBe(1)
    expect(document.activeElement).toBe(terminal.textarea)
    expect(controller.sentInputs).toEqual([])
    wrapper.unmount()
  })

  it('drives tmux scroll through the API without synthesizing terminal input', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'tmux_scroll_shell', enabled: true },
    })
    await nextTick()
    const controller = terminalHarness.controllers[0]!
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向下滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '返回底部')!.trigger('click')
    expect(sessionApiMock.scrollSession.mock.calls).toEqual([
      ['tmux_scroll_shell', 'up', 20],
      ['tmux_scroll_shell', 'down', 20],
      ['tmux_scroll_shell', 'bottom', undefined],
    ])
    expect(controller.sentInputs).toEqual([])
    expect(terminalHarness.terminals[0]!.wheelHandler).toBeUndefined()
    wrapper.unmount()
  })

  it('fences tmux scroll replies across session and generation changes and surfaces failures', async () => {
    const pending = deferred<void>()
    sessionApiMock.scrollSession.mockReturnValueOnce(pending.promise)
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'scroll_owner', enabled: true },
    })
    await nextTick()
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.trigger('click')
    expect(sessionApiMock.scrollSession).toHaveBeenCalledWith('scroll_owner', 'up', 20)

    await wrapper.setProps({ sessionName: 'scroll_other' })
    await vi.waitFor(() => expect(terminalHarness.terminals).toHaveLength(2))
    pending.resolve(undefined)
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('会话连接已变化')

    sessionApiMock.scrollSession.mockRejectedValueOnce(new Error('Scroll direction must be one of up, down or bottom'))
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '返回底部')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Scroll direction must be one of up, down or bottom'))
    wrapper.unmount()
  })

  it.each(['switch', 'reconnect', 'unmount'])('drops queued tmux scrolls after %s instead of replaying stale gestures', async (change) => {
    const pending = deferred<void>()
    sessionApiMock.scrollSession.mockReturnValueOnce(pending.promise)
    const wrapper = mount(TerminalView, {
      props: { sessionName: 'scroll_old', enabled: true },
    })
    await nextTick()
    const surface = wrapper.get('.terminal-container').element
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -54, bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(sessionApiMock.scrollSession).toHaveBeenCalledTimes(1))
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -54, bubbles: true, cancelable: true }))
    if (change === 'switch') await wrapper.setProps({ sessionName: 'scroll_new' })
    else if (change === 'reconnect') {
      terminalHarness.controllers[0]!.setState('disconnected')
      terminalHarness.controllers[0]!.setState('connected')
    } else wrapper.unmount()
    pending.resolve(undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sessionApiMock.scrollSession).toHaveBeenCalledTimes(1)
    if (change !== 'unmount') wrapper.unmount()
  })

  it('drops a failed tmux scroll reply after the session disconnects', async () => {
    const pending = deferred<never>()
    sessionApiMock.scrollSession.mockReturnValueOnce(pending.promise)
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'scroll_disconnect', enabled: true },
    })
    await nextTick()
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向下滚动')!.trigger('click')
    terminalHarness.controllers[0]!.setState('disconnected')
    pending.reject(new Error('late tmux failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('late tmux failure')
    wrapper.unmount()
  })

  it('keeps copy snapshots frozen while wheel and swipe drive tmux history', async () => {
    const wrapper = mount(TerminalView, {
      attachTo: document.body,
      props: { sessionName: 'snapshot_shell', enabled: true },
    })
    await nextTick()
    const terminal = terminalHarness.terminals[0]!
    const controller = terminalHarness.controllers[0]!
    await wrapper.find('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '打开复制视图')!.trigger('click')
    const snapshot = wrapper.get('textarea[aria-label="终端文本快照"]')
    expect((snapshot.element as HTMLTextAreaElement).value).toBe('snapshot')
    terminal.bufferLines[0]!.text = 'new output'
    expect((snapshot.element as HTMLTextAreaElement).value).toBe('snapshot')
    await wrapper.find('button[aria-label="关闭复制视图"]').trigger('click')

    expect(wrapper.find('.terminal-container').classes()).not.toContain('is-local-scroll')

    // Capture on the container even when a nested xterm listener swallows wheel events.
    const surface = wrapper.get('.terminal-container').element
    const nestedHandler = vi.fn((event: Event) => event.stopPropagation())
    terminal.textarea!.addEventListener('wheel', nestedHandler)
    const wheel = new WheelEvent('wheel', { deltaY: -54, bubbles: true, cancelable: true })
    terminal.textarea!.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(nestedHandler).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(sessionApiMock.scrollSession).toHaveBeenCalledWith('snapshot_shell', 'up', 3))
    // Dragging the finger downward asks for older history, matching tmux copy-mode up.
    surface.dispatchEvent(touchEvent('touchstart', [{ identifier: 4, clientY: 364 }]))
    surface.dispatchEvent(touchEvent('touchmove', [{ identifier: 4, clientY: 400 }]))
    await vi.waitFor(() => expect(sessionApiMock.scrollSession).toHaveBeenCalledWith('snapshot_shell', 'up', 2))
    surface.dispatchEvent(touchEvent('touchend', [], [{ identifier: 4, clientY: 400 }]))

    expect(controller.sentInputs).toEqual([])
    expect(terminal.pasteCalls).toEqual([])
    wrapper.unmount()
  })
})
