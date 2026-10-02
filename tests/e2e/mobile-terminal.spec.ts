import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const viewports = [
  { width: 360, height: 800, label: 'compact portrait' },
  { width: 390, height: 844, label: 'standard portrait' },
  { width: 844, height: 390, label: 'landscape' },
  { width: 1280, height: 900, label: 'desktop' },
] as const

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function selectSession(page: Page, name: string): Promise<void> {
  const sessions = page.getByRole('button', { name: 'Open sessions' })
  if (await sessions.getAttribute('aria-expanded') !== 'true') await sessions.click()
  await page.getByTestId(`session-${name}`).click()
  await expect(page.locator('.header-status')).toContainText('已连接', { timeout: 30_000 })
}

async function sendShellLine(page: Page, line: string): Promise<void> {
  const tools = page.getByRole('button', { name: '终端工具', exact: true })
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
  await page.getByRole('button', { name: '输入长文本' }).click()
  await page.getByLabel('要发送的文本').fill(line)
  await page.getByRole('button', { name: '发送并回车' }).click()
}

async function installTtydTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const traceWindow = window as typeof window & {
      __u8TtydTrace: { input: string[]; resize: Array<{ columns: number; rows: number }>; flow: number[] }
    }
    traceWindow.__u8TtydTrace = { input: [], resize: [], flow: [] }
    const originalSend = WebSocket.prototype.send
    Object.defineProperty(WebSocket.prototype, 'send', {
      configurable: true,
      value: function (this: WebSocket, data: string | ArrayBuffer | ArrayBufferView | Blob) {
        if (this.url.includes('/terminal/')) {
          if (typeof data === 'string') {
            try {
              const handshake = JSON.parse(data)
              if (Number.isInteger(handshake.columns) && Number.isInteger(handshake.rows)) {
                traceWindow.__u8TtydTrace.resize.push({ columns: handshake.columns, rows: handshake.rows })
              }
            } catch { /* Ignore non-handshake messages. */ }
          } else if (!(data instanceof Blob)) {
            const bytes = data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : undefined
            // ttyd 1.7.7 protocol.c defines ASCII 0x30 input, 0x31 resize, 0x32 pause, 0x33 resume.
            if (bytes?.[0] === 0x30) traceWindow.__u8TtydTrace.input.push(new TextDecoder().decode(bytes.subarray(1)))
            if (bytes?.[0] === 0x31) {
              try {
                traceWindow.__u8TtydTrace.resize.push(JSON.parse(new TextDecoder().decode(bytes.subarray(1))))
              } catch { /* Ignore non-resize payloads. */ }
            }
            if (bytes?.[0] === 0x32 || bytes?.[0] === 0x33) traceWindow.__u8TtydTrace.flow.push(bytes[0])
          }
        }
        return Reflect.apply(originalSend, this, [data])
      },
    })
  })
}

async function expectEmbeddingBlocked(context: BrowserContext, parentOrigin: string, target: string): Promise<void> {
  const page = await context.newPage()
  const violation = page.waitForEvent('console', {
    predicate: (message) => /frame-ancestors|Framing .* violates/i.test(message.text()),
    timeout: 10_000,
  })
  await page.route(`${parentOrigin}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>untrusted embedding site</title>',
  }))
  await page.goto(`${parentOrigin}/`)
  await page.evaluate((url) => {
    const frame = document.createElement('iframe')
    frame.src = url
    document.body.append(frame)
  }, target)
  const message = await violation
  expect(message.text()).toMatch(/Refused to load .* frame-ancestors|Framing .* violates/i)
  await page.close()
}

test('viewport requests content resizing for the on-screen keyboard', async ({ page }) => {
  await page.goto('/')
  // This checks the requested browser policy, not actual Android keyboard geometry.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content', /(?:^|,\s*)interactive-widget=resizes-content(?:\s*,|\s*$)/,
  )
})

test('mobile and desktop layouts fit their measured viewport without hiding the shortcut rows', async ({ page }) => {
  await page.goto('/')
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await expect.poll(() => page.evaluate(() => {
      const shell = document.querySelector('.app-shell')?.getBoundingClientRect()
      return shell !== undefined && Math.abs(shell.height - innerHeight) < 1
    }), { message: `${viewport.label}: app follows the resized viewport` }).toBe(true)
    const bounds = await page.evaluate(() => {
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      const workspace = document.querySelector('.app-workspace')?.getBoundingClientRect()
      const terminal = document.querySelector('.terminal-main')?.getBoundingClientRect()
      const keys = document.querySelector('.extra-keys-bar')?.getBoundingClientRect()
      return { header, workspace, terminal, keys, width: innerWidth, height: innerHeight }
    })
    expect(bounds.header, `${viewport.label}: header is rendered`).toBeTruthy()
    expect(bounds.workspace, `${viewport.label}: workspace is rendered`).toBeTruthy()
    expect(bounds.terminal, `${viewport.label}: terminal is rendered`).toBeTruthy()
    expect(bounds.keys, `${viewport.label}: shortcut rows are rendered`).toBeTruthy()
    expect(bounds.header!.bottom).toBeLessThanOrEqual(bounds.height)
    expect(bounds.terminal!.right).toBeLessThanOrEqual(bounds.width + 1)
    expect(bounds.keys!.bottom).toBeLessThanOrEqual(bounds.height)
    expect(bounds.keys!.width).toBeGreaterThan(0)
  }
})

for (const keyboardGeometry of ['visual-only', 'layout-and-visual'] as const) {
  test(`keyboard geometry ${keyboardGeometry} keeps the shortcut bar flush with the visible viewport`, async ({ page }) => {
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      Object.assign(viewport, { height: 844, offsetTop: 0 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    })
    await page.goto('/')
    await expect.poll(() => page.locator('.app-shell').evaluate((element) => element.getBoundingClientRect().height)).toBe(844)
    await page.evaluate((geometry) => {
      Object.assign(window.visualViewport!, { height: 520 })
      if (geometry === 'layout-and-visual') Object.defineProperty(window, 'innerHeight', { configurable: true, value: 520 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
    }, keyboardGeometry)
    await expect.poll(() => page.locator('.extra-keys-bar').evaluate((element) => element.getBoundingClientRect().bottom)).toBe(520)
    await expect.poll(() => page.locator('.app-shell').evaluate((element) => (element as HTMLElement).style.getPropertyValue('--safe-area-bottom').trim())).toBe('0px')
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 844 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect.poll(() => page.locator('.extra-keys-bar').evaluate((element) => element.getBoundingClientRect().bottom)).toBe(844)
    await expect.poll(() => page.locator('.app-shell').evaluate((element) => (element as HTMLElement).style.getPropertyValue('--safe-area-bottom').trim())).toBe('env(safe-area-inset-bottom, 0px)')
  })
}

test('wheel and swipe display older tmux output without typing or pulling shortcut focus into the terminal', async ({ page }, testInfo) => {
  await installTtydTrace(page)
  await page.goto('/')
  const name = uniqueName(`history-${testInfo.project.name}`)
  const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
  expect(created.status()).toBe(201)
  try {
    await selectSession(page, name)
    const nonce = Date.now().toString()
    await sendShellLine(page, `for i in $(seq 1 300); do printf 'HIST_%s_%03d\\n' ${nonce} "$i"; done; printf 'READY_%s\\n' ${nonce}`)
    await expect(page.locator('.xterm-rows')).toContainText(`READY_${nonce}`)
    const firstVisibleLine = () => page.locator('.xterm-rows').evaluate((element, label) => {
      const matches = [...(element.textContent ?? '').matchAll(new RegExp(`HIST_${label}_(\\d+)`, 'g'))]
      return matches.length ? Math.min(...matches.map((match) => Number(match[1]))) : 0
    }, nonce)
    const beforeWheel = await firstVisibleLine()
    expect(beforeWheel).toBeGreaterThan(0)
    const tools = page.getByRole('button', { name: '终端工具', exact: true })
    await page.getByRole('button', { name: '关闭终端工具', exact: true }).click()
    await page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { input: string[] } }).__u8TtydTrace
      trace.input.length = 0
    })
    const surface = page.locator('.terminal-container')
    const bounds = await surface.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    const wheelResponse = page.waitForResponse((response) => response.url().endsWith(`/api/sessions/${name}/scroll`), { timeout: 5_000 })
    await page.mouse.wheel(0, -120)
    expect((await wheelResponse).ok()).toBe(true)
    await expect.poll(firstVisibleLine).toBeLessThan(beforeWheel)
    const afterWheel = await firstVisibleLine()
    expect(afterWheel).toBeGreaterThan(0)
    await surface.evaluate((element) => {
      const dispatch = (type: string, y: number, ended = false) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        const touch = { identifier: 7, clientX: 100, clientY: y }
        Object.defineProperties(event, {
          touches: { value: ended ? [] : [touch] },
          changedTouches: { value: [touch] },
        })
        element.dispatchEvent(event)
      }
      dispatch('touchstart', 200)
      dispatch('touchmove', 272)
      dispatch('touchend', 272, true)
    })
    await expect.poll(firstVisibleLine).toBeLessThan(afterWheel)
    expect(await firstVisibleLine()).toBeGreaterThan(0)
    expect(await page.evaluate(() => (window as typeof window & { __u8TtydTrace: { input: string[] } }).__u8TtydTrace.input)).toEqual([])

    await tools.click()
    await page.getByRole('button', { name: '返回底部', exact: true }).click()
    await expect(page.locator('.xterm-rows')).toContainText(`READY_${nonce}`)
    await page.getByRole('button', { name: '关闭终端工具', exact: true }).click()
    await page.locator('.xterm-helper-textarea').evaluate((element) => (element as HTMLTextAreaElement).blur())
    await page.getByRole('button', { name: '↑', exact: true }).click()
    expect(await page.evaluate(() => document.activeElement?.closest('.terminal-container') !== null)).toBe(false)
    await page.getByRole('button', { name: 'CTRL', exact: true }).click()
    await expect(page.getByLabel('虚拟 Ctrl/Alt 组合输入')).toBeFocused()
    await page.getByRole('button', { name: '←', exact: true }).click()
    await expect(page.getByRole('button', { name: 'CTRL', exact: true })).toHaveAttribute('data-mode', 'off')
    expect(await page.evaluate(() => document.activeElement?.closest('.terminal-container') !== null)).toBe(false)
    // The arrow-key checks recall/edit shell history. Cancel that line before the liveness probe.
    await tools.click()
    await page.getByRole('button', { name: 'Ctrl+C', exact: true }).click()
    await sendShellLine(page, `printf '\\nHISTORY_%s_OK\\n' ${nonce}`)
    await expect(page.locator('.xterm-rows')).toContainText(`HISTORY_${nonce}_OK`)
  } finally {
    const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
    expect(deleted.ok()).toBe(true)
  }
})

test('top-level app, Vite/production HTML, terminal proxy HTML and fonts are served without framing permission', async ({ page, context, baseURL }, testInfo) => {
  const application = await page.request.get('/')
  expect(application.ok()).toBeTruthy()
  expect(application.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'Terminal workspace' })).toBeVisible()

  for (const font of ['JetBrainsMonoNerdFontMono-Regular.ttf', 'JetBrainsMonoNerdFontMono-Bold.ttf']) {
    const response = await page.request.get(`/fonts/${font}`)
    expect(response.status(), font).toBe(200)
  }

  const name = uniqueName(`csp-${testInfo.project.name.replaceAll('-', '_')}`)
  const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
  expect(created.status()).toBe(201)
  try {
    const terminalPage = await page.request.get(`/terminal/${name}/`)
    expect(terminalPage.ok()).toBeTruthy()
    expect(terminalPage.headers()['content-type']).toContain('text/html')
    expect(terminalPage.headers()['content-security-policy']).toContain("frame-ancestors 'none'")

    const hostileOrigin = testInfo.project.name.startsWith('webkit-')
      ? 'http://untrusted.example'
      : 'https://untrusted.example'
    // Let Chromium's local-network gate reach the response so this assertion isolates CSP enforcement.
    if (testInfo.project.name.startsWith('chromium-')) {
      await context.grantPermissions(['local-network-access'], { origin: hostileOrigin })
    }
    await expectEmbeddingBlocked(context, hostileOrigin, baseURL!)
    await expectEmbeddingBlocked(context, hostileOrigin, new URL(`/terminal/${name}/`, baseURL!).toString())
  } finally {
    const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
    if (!deleted.ok()) console.error(`test-session cleanup failed: ${deleted.status()} ${await deleted.text()}`)
  }
})

test('a delayed bundled font remeasures and fits the live terminal without a container resize', async ({ page }, testInfo) => {
  const releaseFonts = deferred<void>()
  const requestedFonts = deferred<void>()
  const fontPaths = new Set<string>()
  const fontResponseStatuses = new Map<string, number>()
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    if (pathname.startsWith('/fonts/JetBrainsMonoNerdFontMono-') && pathname.endsWith('.ttf')) {
      fontResponseStatuses.set(pathname, response.status())
    }
  })
  await page.route('**/fonts/JetBrainsMonoNerdFontMono-*.ttf', async (route) => {
    fontPaths.add(new URL(route.request().url()).pathname)
    if (fontPaths.size === 2) requestedFonts.resolve(undefined)
    await releaseFonts.promise
    await route.continue()
  })
  await installTtydTrace(page)
  await page.goto('/')
  await page.addStyleTag({
    content: '@font-face { font-family: "JetBrains Mono"; src: local("Arial"); font-style: normal; font-weight: 400; }',
  })

  const name = uniqueName(`font-${testInfo.project.name.replaceAll('-', '_')}`)
  const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
  expect(created.status()).toBe(201)
  try {
    await selectSession(page, name)
    await requestedFonts.promise
    const beforeFont = await page.evaluate(async () => {
      await document.fonts.load('13px "JetBrains Mono"', 'W').catch(() => undefined)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!
      context.font = '13px "JetBrainsMono Nerd Font Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace'
      return { fallbackWidth: context.measureText('W').width }
    })

    const terminal = page.locator('.terminal-container')
    await expect.poll(() => page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { resize: Array<{ columns: number; rows: number }> } }).__u8TtydTrace
      return trace.resize.at(-1)?.columns ?? 0
    })).toBeGreaterThan(0)
    const beforeSize = await page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { resize: Array<{ columns: number; rows: number }> } }).__u8TtydTrace
      return trace.resize.at(-1)!
    })
    const beforeBounds = await terminal.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height, viewportWidth: innerWidth, viewportHeight: innerHeight }
    })

    await sendShellLine(page, "printf '\\nU8_FONT_BEFORE '; stty size; printf ' U8_FONT_BEFORE_END\\n'")
    const readTerminalSize = async (marker: string) => page.locator('.xterm-rows').evaluate((element, label) => {
      const match = element.textContent?.match(new RegExp(`${label}\\s+(\\d+)\\s+(\\d+)\\s+${label}_END`))
      return match ? { rows: Number(match[1]), columns: Number(match[2]) } : null
    }, marker)
    await expect.poll(() => readTerminalSize('U8_FONT_BEFORE')).not.toBeNull()
    const terminalSizeBefore = await readTerminalSize('U8_FONT_BEFORE')
    expect(terminalSizeBefore?.columns).toBe(beforeSize.columns)

    releaseFonts.resolve(undefined)
    await expect.poll(() => fontResponseStatuses.size).toBe(2)
    expect([...fontResponseStatuses.values()]).toEqual([200, 200])
    await expect.poll(() => page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { resize: Array<{ columns: number; rows: number }> } }).__u8TtydTrace
      return trace.resize.at(-1)?.columns ?? 0
    })).not.toBe(beforeSize.columns)
    const afterFont = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!
      context.font = '13px "JetBrainsMono Nerd Font Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace'
      return { cellWidth: context.measureText('W').width }
    })
    expect(Math.abs(afterFont.cellWidth - beforeFont.fallbackWidth)).toBeGreaterThan(0.05)

    const afterBounds = await terminal.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height, viewportWidth: innerWidth, viewportHeight: innerHeight }
    })
    expect(afterBounds).toEqual(beforeBounds)
    await sendShellLine(page, "printf '\\nU8_FONT_AFTER '; stty size; printf ' U8_FONT_AFTER_END\\n'")
    const readAfterSize = () => page.locator('.xterm-rows').evaluate((element) => {
      const match = element.textContent?.match(/U8_FONT_AFTER\s+(\d+)\s+(\d+)\s+U8_FONT_AFTER_END/)
      return match ? { rows: Number(match[1]), columns: Number(match[2]) } : null
    })
    await expect.poll(readAfterSize).not.toBeNull()
    const terminalSizeAfter = await readAfterSize()
    expect(terminalSizeAfter?.columns).toBeGreaterThan(0)
    expect(terminalSizeAfter?.columns).not.toBe(terminalSizeBefore?.columns)
  } finally {
    releaseFonts.resolve(undefined)
    const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
    if (!deleted.ok()) console.error(`test-session cleanup failed: ${deleted.status()} ${await deleted.text()}`)
  }
})

test('a large live shell output pauses and resumes ttyd flow control before accepting more input', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-development', 'Run the flow-pressure check once with Chromium CDP CPU throttling')
  await installTtydTrace(page)
  await page.goto('/')
  const name = uniqueName(`flow-${testInfo.project.name.replaceAll('-', '_')}`)
  const created = await page.request.post('/api/sessions', { data: { name, shell: 'bash' } })
  expect(created.status()).toBe(201)
  let chromiumSession: Awaited<ReturnType<ReturnType<typeof page.context>['newCDPSession']>> | undefined
  try {
    await selectSession(page, name)
    chromiumSession = await page.context().newCDPSession(page)
    await chromiumSession.send('Emulation.setCPUThrottlingRate', { rate: 10 })
    await sendShellLine(page, String.raw`sleep 0.2; yes $'\033[38;5;196m界🙂\033[0m' | head -c 10000000; printf '\nU8_%s_%s_DONE\n' HIGH OUTPUT`)
    await expect(page.locator('.xterm-rows')).toContainText('U8_HIGH_OUTPUT_DONE', { timeout: 45_000 })
    await expect.poll(() => page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { flow: number[] } }).__u8TtydTrace
      return trace.flow.includes(0x32)
    }), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      const trace = (window as typeof window & { __u8TtydTrace: { flow: number[] } }).__u8TtydTrace
      return trace.flow.includes(0x33)
    }), { timeout: 30_000 }).toBe(true)

    const inputNonce = Date.now()
    const inputMarker = `U8_FLOW_INPUT_ACCEPTED_${inputNonce}`
    await sendShellLine(page, `printf '\\nU8_FLOW_%s_%s_%s\\n' INPUT ACCEPTED ${inputNonce}`)
    await expect(page.locator('.xterm-rows')).toContainText(inputMarker, { timeout: 15_000 })
  } finally {
    await chromiumSession?.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {})
    await chromiumSession?.detach()
    const deleted = await page.request.delete(`/api/sessions/${encodeURIComponent(name)}`)
    if (!deleted.ok()) console.error(`test-session cleanup failed: ${deleted.status()} ${await deleted.text()}`)
  }
})
