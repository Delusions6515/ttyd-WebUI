// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'

let TerminalToolsSheet: Component
beforeAll(async () => {
  TerminalToolsSheet = (await vi.importActual<{ default: Component }>('./TerminalToolsSheet.vue')).default
})

function mountTools(props: Record<string, unknown> = {}) {
  return mount(TerminalToolsSheet, {
    props: {
      connected: true,
      copyText: '',
      copyViewOpen: false,
      textInputOpen: false,
      message: '',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('TerminalToolsSheet', () => {
  it('requests selection copy without synthesizing a key action', async () => {
    const wrapper = mountTools()
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '复制所选文本')!.trigger('click')
    expect(wrapper.emitted('copySelection')).toHaveLength(1)
    expect(wrapper.emitted('key')).toBeUndefined()
    wrapper.unmount()
  })

  it('requests clipboard paste, selection copy, a frozen copy view and explicit text input', async () => {
    const wrapper = mountTools()
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '复制所选文本')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '打开复制视图')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '输入长文本')!.trigger('click')
    expect(wrapper.emitted('pasteClipboard')).toHaveLength(1)
    expect(wrapper.emitted('copySelection')).toHaveLength(1)
    expect(wrapper.emitted('openCopyView')).toHaveLength(1)
    expect(wrapper.emitted('openTextInput')).toHaveLength(1)
    wrapper.unmount()
  })

  it('renders buffer output as literal selectable text rather than HTML', () => {
    const snapshot = '<script>not markup</script> 中文🙂'
    const wrapper = mountTools({ copyViewOpen: true, copyText: snapshot })
    expect((wrapper.find('textarea[aria-label="终端文本快照"]').element as HTMLTextAreaElement).value).toBe(snapshot)
    expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses only tmux scroll actions and restores the bottom without key or paste actions', async () => {
    const wrapper = mountTools()
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向下滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '返回底部')!.trigger('click')
    expect(wrapper.emitted('scrollTmux')).toEqual([['up', 20], ['down', 20], ['bottom']])
    expect(wrapper.emitted('toggleLocalScroll')).toBeUndefined()
    expect(wrapper.emitted('scrollLocal')).toBeUndefined()
    expect(wrapper.emitted('scrollToBottom')).toBeUndefined()
    expect(wrapper.emitted('key')).toBeUndefined()
    expect(wrapper.emitted('pasteClipboard')).toBeUndefined()
    expect(wrapper.findAll('button').find((button) => button.text() === '开始本地滚屏')).toBeUndefined()
    wrapper.unmount()
  })

  it('hosts the F1–F12 keys and common shortcuts that left the key bar', async () => {
    const wrapper = mountTools()
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    expect(wrapper.findAll('button[aria-label^="F"]').map((button) => button.text())).toEqual(
      ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
    )
    await wrapper.find('button[aria-label="F12"]').trigger('click')
    expect(wrapper.emitted('key')).toEqual([['F12']])
    await wrapper.find('button[aria-label="Ctrl+C"]').trigger('click')
    expect(wrapper.emitted('shortcut')).toHaveLength(1)
    expect(wrapper.emitted('shortcut')?.[0]?.[0]).toMatchObject({ label: 'Ctrl+C', modifiers: ['ctrl'] })
    wrapper.unmount()
  })

  it('disables paste, tmux scroll and extended keys while disconnected', async () => {
    const wrapper = mountTools({ connected: false })
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    expect(wrapper.findAll('button').find((button) => button.text() === '粘贴')!.element.disabled).toBe(true)
    expect(wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.element.disabled).toBe(true)
    expect((wrapper.find('button[aria-label="F12"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.find('button[aria-label="Ctrl+C"]').element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })
})
