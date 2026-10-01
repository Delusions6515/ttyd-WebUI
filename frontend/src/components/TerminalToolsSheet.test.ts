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
      localScrollMode: false,
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

  it('uses only local scroll actions and restores the bottom without key or paste actions', async () => {
    const wrapper = mountTools()
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '开始本地滚屏')!.trigger('click')
    expect(wrapper.emitted('toggleLocalScroll')).toHaveLength(1)
    await wrapper.setProps({ localScrollMode: true })
    await wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '向下滚动')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '返回底部')!.trigger('click')
    expect(wrapper.emitted('scrollLocal')).toEqual([[-10], [10]])
    expect(wrapper.emitted('scrollToBottom')).toHaveLength(1)
    expect(wrapper.emitted('key')).toBeUndefined()
    expect(wrapper.emitted('pasteClipboard')).toBeUndefined()
    wrapper.unmount()
  })

  it('disables paste and scroll actions while disconnected', async () => {
    const wrapper = mountTools({ connected: false, localScrollMode: true })
    await wrapper.get('button[aria-label="终端工具"]').trigger('click')
    expect(wrapper.findAll('button').find((button) => button.text() === '粘贴')!.element.disabled).toBe(true)
    expect(wrapper.findAll('button').find((button) => button.text() === '向上滚动')!.element.disabled).toBe(true)
    wrapper.unmount()
  })
})
