import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'

export function useVisualViewport() {
  const height = ref(0)
  const offsetTop = ref(0)
  let frame = 0
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = false

  function measure(): void {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    height.value = Math.max(0, viewport?.height ?? window.innerHeight)
    offsetTop.value = viewport?.offsetTop ?? 0
    document.documentElement.style.setProperty('--visual-viewport-height', `${height.value}px`)
    document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offsetTop.value}px`)
  }

  function scheduleMeasure(): void {
    if (!mounted || frame || fallbackTimer) return
    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    } else {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = undefined
        measure()
      }, 0)
    }
  }

  onMounted(() => {
    mounted = true
    measure()
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('orientationchange', scheduleMeasure)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
  })

  onBeforeUnmount(() => {
    mounted = false
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('orientationchange', scheduleMeasure)
    window.visualViewport?.removeEventListener('resize', scheduleMeasure)
    window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
    if (frame) window.cancelAnimationFrame(frame)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    frame = 0
    fallbackTimer = undefined
    document.documentElement.style.removeProperty('--visual-viewport-height')
    document.documentElement.style.removeProperty('--visual-viewport-offset-top')
  })

  return { height: readonly(height), offsetTop: readonly(offsetTop) }
}
