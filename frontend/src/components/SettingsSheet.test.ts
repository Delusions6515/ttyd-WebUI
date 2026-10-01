// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../stores/preferences'
import type { PreferencesSnapshot } from '../stores/preferences'
import SettingsSheet from './SettingsSheet.vue'

function copyDefaults(): PreferencesSnapshot {
  return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)) as PreferencesSnapshot
}

describe('SettingsSheet', () => {
  it('edits keys, labels, shortcut sequences, font size and visibility only when saved', async () => {
    const wrapper = mount(SettingsSheet, {
      props: { open: true, preferences: copyDefaults() },
    })

    await wrapper.get('input[aria-label="键位标签，第 1 行第 1 个"]').setValue('<b>x</b>')
    await wrapper.get('select[aria-label="键位动作，第 1 行第 1 个"]').setValue('shortcut')
    await wrapper.get('input[aria-label="组合修饰键 Ctrl，第 1 行第 1 个"]').setValue(true)
    await wrapper.get('select[aria-label="快捷序列按键，第 1 行第 1 个，第 1 步"]').setValue('F12')
    await wrapper.get('button[aria-label="添加组合步骤，第 1 行第 1 个"]').trigger('click')
    await wrapper.get('select[aria-label="快捷序列类型，第 1 行第 1 个，第 2 步"]').setValue('text')
    await wrapper.get('input[aria-label="快捷序列字符，第 1 行第 1 个，第 2 步"]').setValue('x')
    await wrapper.get('input[aria-label="终端字号"]').setValue('18')
    await wrapper.get('input[aria-label="显示快捷键栏"]').setValue(false)

    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.find('img, script, svg').exists()).toBe(false)
    expect(wrapper.emitted('save')).toBeUndefined()
    await wrapper.get('form').trigger('submit')

    const saved = wrapper.emitted('save')?.[0]?.[0] as PreferencesSnapshot | undefined
    expect(saved?.keyRows[0]?.[0]).toMatchObject({
      label: '<b>x</b>',
      action: { type: 'shortcut', modifiers: ['ctrl'], sequence: [{ type: 'key', key: 'F12' }, { type: 'text', text: 'x' }] },
    })
    expect(saved?.fontSize).toBe(18)
    expect(saved?.showExtraKeys).toBe(false)
    wrapper.unmount()
  })

  it('does not persist cancelled edits and can restore defaults explicitly', async () => {
    const wrapper = mount(SettingsSheet, {
      props: { open: true, preferences: copyDefaults() },
    })
    await wrapper.get('input[aria-label="终端字号"]').setValue('21')
    await wrapper.get('button[aria-label="取消设置"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((wrapper.get('input[aria-label="终端字号"]').element as HTMLInputElement).value)
      .toBe(String(DEFAULT_PREFERENCES.fontSize))

    await wrapper.get('button[aria-label="恢复默认设置"]').trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
    wrapper.unmount()
  })
})
