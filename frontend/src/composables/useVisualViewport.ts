import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'

// Below this many pixels of shrink we treat the change as browser chrome (a collapsing
// URL bar) rather than an on-screen keyboard. Coarser than a real keyboard either way.
const KEYBOARD_MIN_INSET = 120

export function useVisualViewport() {
  const height = ref(0)
  const offsetTop = ref(0)
  const keyboardOpen = ref(false)
  let frame = 0
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = false
  // Largest layout height seen without visible occlusion. Engines differ: iOS Safari keeps
  // window.innerHeight and shrinks the visual viewport, while Android Chrome shrinks both.
  // Remembering the tallest layout height detects either, because the keyboard can only
  // ever make the visible area smaller than the keyboard-closed baseline.
  let layoutBaseline = 0
  let resetBaselinePending = false

  function measure(resetBaseline = false): void {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    height.value = Math.max(0, viewport?.height ?? window.innerHeight)
    offsetTop.value = viewport?.offsetTop ?? 0
    const layoutHeight = window.innerHeight || height.value
    if (resetBaseline || layoutHeight > layoutBaseline) layoutBaseline = layoutHeight
    const layoutShrink = Math.max(0, layoutBaseline - layoutHeight)
    const occlusion = Math.max(0, layoutHeight - (height.value + offsetTop.value))
    keyboardOpen.value = offsetTop.value > 0
      || occlusion > KEYBOARD_MIN_INSET
      || layoutShrink > KEYBOARD_MIN_INSET
    document.documentElement.style.setProperty('--visual-viewport-height', `${height.value}px`)
    document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offsetTop.value}px`)
  }

  function measureAfterRotation(): void {
    // A rotation legitimately changes the layout height, so it must not read as a keyboard.
    resetBaselinePending = true
    scheduleMeasure()
  }

  function flushMeasure(): void {
    if (frame) window.cancelAnimationFrame(frame)
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
    frame = 0
    fallbackTimer = undefined
    if (!mounted) return
    const reset = resetBaselinePending
    resetBaselinePending = false
    measure(reset)
  }

  function scheduleMeasure(): void {
    if (!mounted || frame || fallbackTimer !== undefined) return
    const hasAnimationFrame = typeof window.requestAnimationFrame === 'function'
    if (hasAnimationFrame) frame = window.requestAnimationFrame(flushMeasure)
    // A throttled page may defer animation frames indefinitely. The first callback
    // measures and cancels the other; without rAF there is only one immediate timer.
    fallbackTimer = setTimeout(flushMeasure, hasAnimationFrame ? 120 : 0)
  }

  onMounted(() => {
    mounted = true
    measure()
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('orientationchange', measureAfterRotation)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
  })

  onBeforeUnmount(() => {
    mounted = false
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('orientationchange', measureAfterRotation)
    window.visualViewport?.removeEventListener('resize', scheduleMeasure)
    window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
    if (frame) window.cancelAnimationFrame(frame)
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
    frame = 0
    fallbackTimer = undefined
    document.documentElement.style.removeProperty('--visual-viewport-height')
    document.documentElement.style.removeProperty('--visual-viewport-offset-top')
  })

  return { height: readonly(height), offsetTop: readonly(offsetTop), keyboardOpen: readonly(keyboardOpen) }
}
