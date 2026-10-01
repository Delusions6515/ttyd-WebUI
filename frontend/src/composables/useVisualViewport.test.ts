// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVisualViewport } from './useVisualViewport'

class FakeVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
}

const viewports: FakeVisualViewport[] = []
let frames: Array<(time: number) => void> = []

afterEach(() => {
  frames = []
  vi.restoreAllMocks()
  for (const viewport of viewports.splice(0)) {
    if (window.visualViewport === viewport) {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    }
  }
})

describe('useVisualViewport', () => {
  it('measures keyboard shrink, viewport offset and rotation, then removes listeners on unmount', async () => {
    const viewport = new FakeVisualViewport()
    viewports.push(viewport)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const TestComponent = defineComponent({
      setup() {
        const dimensions = useVisualViewport()
        return { height: dimensions.height, offsetTop: dimensions.offsetTop }
      },
      template: '<div />',
    })
    const wrapper = mount(TestComponent)
    expect(wrapper.vm.height).toBe(800)
    expect(wrapper.vm.offsetTop).toBe(0)

    viewport.height = 430
    viewport.offsetTop = 24
    viewport.dispatchEvent(new Event('resize'))
    const keyboardFrame = frames.shift()
    expect(keyboardFrame).toBeDefined()
    keyboardFrame?.(0)
    await nextTick()
    expect(wrapper.vm.height).toBe(430)
    expect(wrapper.vm.offsetTop).toBe(24)

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 430 })
    window.dispatchEvent(new Event('orientationchange'))
    const rotationFrame = frames.shift()
    rotationFrame?.(16)
    await nextTick()
    expect(wrapper.vm.height).toBe(430)

    const scheduleCount = frames.length
    wrapper.unmount()
    viewport.height = 700
    viewport.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(scheduleCount)
  })
})
