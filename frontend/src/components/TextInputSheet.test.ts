// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Component } from 'vue'

let TextInputSheet: Component
beforeAll(async () => {
  TextInputSheet = (await vi.importActual<{ default: Component }>('./TextInputSheet.vue')).default
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TextInputSheet', () => {
  it('does not send while an IME composition is active', async () => {
    const wrapper = mount(TextInputSheet, {
      attachTo: document.body,
      props: { open: true, connected: true },
    })
    await nextTick()
    const textarea = wrapper.get('textarea[aria-label="要发送的文本"]')
    await textarea.setValue('候选内容')
    await textarea.trigger('compositionstart')
    expect(wrapper.get('button').text()).toBe('关闭')
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.findAll('button').filter((button) => button.text() === '发送文本')[0]!.element.disabled).toBe(true)
    expect(wrapper.findAll('button').filter((button) => button.text() === '发送并回车')[0]!.element.disabled).toBe(true)
    expect(wrapper.emitted('send')).toBeUndefined()
    wrapper.unmount()
  })

  it('sends exact multiline text without an implicit Enter and offers one explicit Enter action', async () => {
    const wrapper = mount(TextInputSheet, {
      attachTo: document.body,
      props: { open: true, connected: true },
    })
    const field = wrapper.get('textarea')
    await field.setValue('第一行\n第二行🙂')
    await wrapper.findAll('button').find((button) => button.text() === '发送文本')!.trigger('click')
    expect(wrapper.emitted('send')).toEqual([['第一行\n第二行🙂', false]])
    expect(wrapper.emitted('close')).toHaveLength(1)

    await field.setValue('command')
    await wrapper.findAll('button').find((button) => button.text() === '发送并回车')!.trigger('click')
    expect(wrapper.emitted('send')).toEqual([['第一行\n第二行🙂', false], ['command', true]])
    wrapper.unmount()
  })

  it('clears text and releases focus when closed', async () => {
    const wrapper = mount(TextInputSheet, {
      attachTo: document.body,
      props: { open: true, connected: true },
    })
    await nextTick()
    const field = wrapper.get('textarea').element as HTMLTextAreaElement
    await wrapper.get('textarea').setValue('not persisted')
    field.focus()
    expect(document.activeElement).toBe(field)
    await wrapper.find('button[aria-label="关闭文本输入"]').trigger('click')
    expect(field.value).toBe('')
    expect(document.activeElement).not.toBe(field)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not expose sending controls while disconnected', () => {
    const wrapper = mount(TextInputSheet, {
      props: { open: true, connected: false },
    })
    expect(wrapper.find('textarea').element.disabled).toBe(true)
    expect(wrapper.findAll('button').filter((button) => button.text() !== '关闭').every((button) => button.element.disabled)).toBe(true)
    wrapper.unmount()
  })
})
