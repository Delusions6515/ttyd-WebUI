function clipboardApi(): Clipboard | undefined {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || !window.isSecureContext) return undefined
  return navigator.clipboard
}

export function canReadClipboardText(): boolean {
  return typeof clipboardApi()?.readText === 'function'
}

export async function readClipboardText(): Promise<string | null> {
  const clipboard = clipboardApi()
  if (!clipboard || typeof clipboard.readText !== 'function') return null
  try {
    return await clipboard.readText()
  } catch {
    return null
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  const clipboard = clipboardApi()
  if (!clipboard || typeof clipboard.writeText !== 'function') return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
