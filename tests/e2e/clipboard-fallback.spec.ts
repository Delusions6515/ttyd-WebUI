import { expect, test } from '@playwright/test'

async function selectSession(page: import('@playwright/test').Page, name: string): Promise<void> {
  const sessions = page.getByRole('button', { name: 'Open sessions' })
  if (await sessions.getAttribute('aria-expanded') !== 'true') await sessions.click()
  await page.getByTestId(`session-${name}`).click()
  await expect(page.locator('.header-status')).toContainText('已连接', { timeout: 30_000 })
}

async function sendShellLine(page: import('@playwright/test').Page, line: string): Promise<void> {
  const tools = page.getByRole('button', { name: '终端工具', exact: true })
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
  await page.getByRole('button', { name: '输入长文本' }).click()
  await page.getByLabel('要发送的文本').fill(line)
  await page.getByRole('button', { name: '发送并回车' }).click()
}

function uniqueName(project: string): string {
  return `clipboard-${project.replaceAll('-', '_')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

test('clipboard permission denial opens the editable paste fallback for the connected session', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => Promise.reject(new DOMException('Clipboard read denied', 'NotAllowedError')),
        writeText: () => Promise.reject(new DOMException('Clipboard write denied', 'NotAllowedError')),
      },
    })
  })
  await page.goto('/')
  await page.setViewportSize({ width: 390, height: 844 })
  const name = uniqueName(testInfo.project.name)
  const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
  expect(created.status()).toBe(201)
  try {
    await page.getByRole('button', { name: 'Open sessions' }).click()
    await expect(page.getByTestId(`session-${name}`)).toBeVisible()
    await page.getByTestId(`session-${name}`).click()
    await expect(page.locator('.header-status')).toContainText('已连接', { timeout: 30_000 })

    await page.getByRole('button', { name: '终端工具' }).click()
    await page.getByRole('button', { name: '粘贴', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '输入文本' })).toBeVisible()
    const nonce = Date.now()
    const marker = `PASTE_FALLBACK_${nonce}`
    await page.getByLabel('要发送的文本').fill(`printf '\\n%s_%s_%s\\n' PASTE FALLBACK ${nonce}`)
    await page.getByRole('button', { name: '发送并回车' }).click()
    await expect(page.locator('.xterm-rows')).toContainText(marker, { timeout: 12_000 })
  } finally {
    const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
    if (!deleted.ok()) console.error(`test-session cleanup failed: ${deleted.status()} ${await deleted.text()}`)
  }
})

test('late clipboard reads cannot paste into another session or a disconnected session', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const traceWindow = window as typeof window & {
      __u8ClipboardReads: number
      __u8ClipboardResolvers: Array<(value: string) => void>
      __u8ClipboardInputs: string[]
    }
    traceWindow.__u8ClipboardReads = 0
    traceWindow.__u8ClipboardResolvers = []
    traceWindow.__u8ClipboardInputs = []
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => {
          traceWindow.__u8ClipboardReads++
          return new Promise<string>((resolve) => traceWindow.__u8ClipboardResolvers.push(resolve))
        },
      },
    })
    const originalSend = WebSocket.prototype.send
    Object.defineProperty(WebSocket.prototype, 'send', {
      configurable: true,
      value: function (this: WebSocket, data: string | ArrayBuffer | ArrayBufferView | Blob) {
        if (this.url.includes('/terminal/') && typeof data !== 'string' && !(data instanceof Blob)) {
          const bytes = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : undefined
          if (bytes?.[0] === 0x30) traceWindow.__u8ClipboardInputs.push(new TextDecoder().decode(bytes.subarray(1)))
        }
        return Reflect.apply(originalSend, this, [data])
      },
    })
  })
  await page.goto('/')
  const prefix = testInfo.project.name.replaceAll('-', '_')
  const first = uniqueName(`clipboard-race-a-${prefix}`)
  const second = uniqueName(`clipboard-race-b-${prefix}`)
  for (const name of [first, second]) {
    const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
    expect(created.status()).toBe(201)
  }

  try {
    await selectSession(page, first)
    await page.getByRole('button', { name: '终端工具' }).click()
    await page.getByRole('button', { name: '粘贴', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __u8ClipboardReads: number }).__u8ClipboardReads)).toBe(1)

    await selectSession(page, second)
    await sendShellLine(page, "read -r clipboard_value; printf 'U8_SWITCH_CAPTURED:%s\\n' \"$clipboard_value\"")
    const switchedMarker = `U8_LATE_SWITCH_${Date.now()}`
    await page.evaluate((text) => {
      const trace = window as typeof window & { __u8ClipboardResolvers: Array<(value: string) => void> }
      trace.__u8ClipboardResolvers[0]!(text)
    }, switchedMarker)
    await page.waitForTimeout(400)
    await expect(page.locator('.xterm-rows')).not.toContainText(switchedMarker)
    const afterSwitchInput = await page.evaluate(() => (window as typeof window & { __u8ClipboardInputs: string[] }).__u8ClipboardInputs.join(''))
    expect(afterSwitchInput).not.toContain(switchedMarker)

    await selectSession(page, first)
    await page.getByRole('button', { name: '终端工具' }).click()
    await page.getByRole('button', { name: '粘贴', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __u8ClipboardReads: number }).__u8ClipboardReads)).toBe(2)
    const sessions = page.getByRole('button', { name: 'Open sessions' })
    if (await sessions.getAttribute('aria-expanded') !== 'true') await sessions.click()
    await page.getByRole('button', { name: `Stop ${first}` }).click()
    await expect(page.getByTestId(`session-${first}`)).toContainText('Stopped')
    await expect(page.locator('.header-status')).toContainText('会话已停止')
    const disconnectedMarker = `U8_LATE_DISCONNECT_${Date.now()}`
    await page.evaluate((text) => {
      const trace = window as typeof window & { __u8ClipboardResolvers: Array<(value: string) => void> }
      trace.__u8ClipboardResolvers[1]!(text)
    }, disconnectedMarker)
    await page.waitForTimeout(400)
    const afterDisconnectInput = await page.evaluate(() => (window as typeof window & { __u8ClipboardInputs: string[] }).__u8ClipboardInputs.join(''))
    expect(afterDisconnectInput).not.toContain(disconnectedMarker)
  } finally {
    for (const name of [first, second]) {
      const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
      if (!deleted.ok()) console.error(`test-session cleanup failed: ${deleted.status()} ${await deleted.text()}`)
    }
  }
})
