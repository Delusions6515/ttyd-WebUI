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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const viewport of viewports.splice(0)) {
    if (window.visualViewport === viewport) {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    }
  }
})

describe('useVisualViewport', () => {
  it('uses the timer when an animation frame stalls and can schedule the next resize', async () => {
    vi.useFakeTimers()
    const viewport = new FakeVisualViewport()
    viewports.push(viewport)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const wrapper = mount(defineComponent({
      setup: useVisualViewport,
      template: '<div />',
    }))
    viewport.height = 500
    viewport.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(120)
    expect(wrapper.vm.height).toBe(500)
    expect(wrapper.vm.keyboardOpen).toBe(true)
    expect(cancelFrame).toHaveBeenCalledWith(42)
    viewport.height = 800
    viewport.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(120)
    expect(wrapper.vm.height).toBe(800)
    expect(wrapper.vm.keyboardOpen).toBe(false)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not leave a timer or restore CSS after unmount without requestAnimationFrame', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const wrapper = mount(defineComponent({ setup: useVisualViewport, template: '<div />' }))
    window.dispatchEvent(new Event('resize'))
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('')
  })

  it('detects a keyboard that resizes the layout viewport, as on Android Chrome', async () => {
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
        return { height: dimensions.height, keyboardOpen: dimensions.keyboardOpen }
      },
      template: '<div />',
    })
    const wrapper = mount(TestComponent)
    expect(wrapper.vm.keyboardOpen).toBe(false)

    // Android Chrome shrinks both the layout and the visual viewport without any offset.
    viewport.height = 520
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 520 })
    viewport.dispatchEvent(new Event('resize'))
    frames.shift()?.(0)
    await nextTick()
    expect(wrapper.vm.keyboardOpen).toBe(true)

    // Closing the keyboard restores the baseline so the bottom inset applies again.
    viewport.height = 900
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    viewport.dispatchEvent(new Event('resize'))
    frames.shift()?.(0)
    await nextTick()
    expect(wrapper.vm.keyboardOpen).toBe(false)
    wrapper.unmount()
  })

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
        return { height: dimensions.height, offsetTop: dimensions.offsetTop, keyboardOpen: dimensions.keyboardOpen }
      },
      template: '<div />',
    })
    const wrapper = mount(TestComponent)
    expect(wrapper.vm.height).toBe(800)
    expect(wrapper.vm.offsetTop).toBe(0)
    expect(wrapper.vm.keyboardOpen).toBe(false)

    // A small shrink is browser chrome, not a keyboard, so the bottom inset must survive.
    viewport.height = 830
    viewport.dispatchEvent(new Event('resize'))
    frames.shift()?.(0)
    await nextTick()
    expect(wrapper.vm.keyboardOpen).toBe(false)

    viewport.height = 430
    viewport.offsetTop = 24
    viewport.dispatchEvent(new Event('resize'))
    const keyboardFrame = frames.shift()
    expect(keyboardFrame).toBeDefined()
    keyboardFrame?.(0)
    await nextTick()
    expect(wrapper.vm.height).toBe(430)
    expect(wrapper.vm.offsetTop).toBe(24)
    expect(wrapper.vm.keyboardOpen).toBe(true)

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
