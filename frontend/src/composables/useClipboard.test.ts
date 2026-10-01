// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canReadClipboardText, readClipboardText, writeClipboardText } from './useClipboard'

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value })
}

function setClipboard(value: Clipboard | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}

afterEach(() => {
  vi.restoreAllMocks()
  setClipboard(undefined)
  setSecureContext(false)
})

describe('useClipboard', () => {
  it('uses a native text-box fallback when the API is missing or the context is insecure', () => {
    setSecureContext(true)
    setClipboard(undefined)
    expect(canReadClipboardText()).toBe(false)

    setClipboard({ readText: vi.fn(), writeText: vi.fn() } as unknown as Clipboard)
    setSecureContext(false)
    expect(canReadClipboardText()).toBe(false)
  })

  it('returns text only after a successful permissioned read and falls back on rejection', async () => {
    const readText = vi.fn<() => Promise<string>>().mockResolvedValue('中文🙂\nnext')
    setSecureContext(true)
    setClipboard({ readText, writeText: vi.fn() } as unknown as Clipboard)
    expect(canReadClipboardText()).toBe(true)
    await expect(readClipboardText()).resolves.toBe('中文🙂\nnext')

    readText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await expect(readClipboardText()).resolves.toBeNull()
    expect(readText).toHaveBeenCalledTimes(2)
  })

  it('reports clipboard write failure so callers can show a selectable text view', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    setSecureContext(true)
    setClipboard({ readText: vi.fn(), writeText } as unknown as Clipboard)
    await expect(writeClipboardText('plain text')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('plain text')
    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await expect(writeClipboardText('plain text')).resolves.toBe(false)
  })
})
