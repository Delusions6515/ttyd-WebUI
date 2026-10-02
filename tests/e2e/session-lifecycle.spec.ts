import { expect, test, type Page } from '@playwright/test'

function uniqueSessionName(browserProject: string): string {
  return `e2e-${browserProject.replaceAll('-', '_')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function createSession(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open sessions' }).click()
  await page.getByTestId('create-session').click()
  await page.getByLabel('Session name (optional)').fill(name)
  await page.getByLabel('Shell').selectOption('bash')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(page.locator('.header-status')).toContainText('已连接', { timeout: 30_000 })
}

async function sendShellLine(page: Page, line: string): Promise<void> {
  const tools = page.getByRole('button', { name: '终端工具', exact: true })
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click()
  await page.getByRole('button', { name: '输入长文本' }).click()
  await page.getByLabel('要发送的文本').fill(line)
  await page.getByRole('button', { name: '发送并回车' }).click()
  await page.getByRole('textbox', { name: 'Terminal input' }).click()
}

test('the browser creates, connects, stops, resumes, and confirms deletion through the selected runtime', async ({ page }, testInfo) => {
  const name = uniqueSessionName(testInfo.project.name)
  await createSession(page, name)

  await sendShellLine(page, 'sleep 30')
  const control = page.getByRole('button', { name: 'CTRL', exact: true })
  await control.click()
  await page.getByRole('textbox', { name: '虚拟 Ctrl/Alt 组合输入' }).fill('c')
  await expect(control).toHaveAttribute('aria-pressed', 'false')
  const ctrlNonce = Date.now()
  const ctrlMarker = `VIRTUAL_CTRL_C_OK_${ctrlNonce}`
  await sendShellLine(page, `printf '\\n%s_%s_%s_%s_%s\\n' VIRTUAL CTRL C OK ${ctrlNonce}`)
  await expect(page.locator('.xterm-rows')).toContainText(ctrlMarker, { timeout: 12_000 })

  await sendShellLine(page, "read -e answer; printf 'ARROW:%s\\n' \"$answer\"")
  await page.keyboard.type('abcdef')
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('button', { name: '←', exact: true }).click()
  await page.keyboard.type('X')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows')).toContainText('ARROW:abcdXef', { timeout: 12_000 })

  await sendShellLine(page, "read -e answer; printf 'ALT:%s\\n' \"$answer\"")
  await page.keyboard.type('one two')
  await page.keyboard.press('Alt+b')
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows')).toContainText('ALT:one xtwo', { timeout: 12_000 })

  await sendShellLine(page, "read -e answer; printf 'TAB:%s\\n' \"$answer\"")
  await page.keyboard.type('./README')
  await page.getByRole('button', { name: 'TAB', exact: true }).click()
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows')).toContainText('TAB:./README.md', { timeout: 12_000 })

  const f1Nonce = Date.now()
  const f1Result = `F1_RESULT_${f1Nonce}`
  const f1Ready = `F1_BIND_READY_${f1Nonce}`
  await sendShellLine(page, String.raw`bind -x '"\eOP":printf "F1_RESULT_%s\n" ${f1Nonce}'; printf '\nF1_BIND_READY_%s\n' ${f1Nonce}`)
  const terminalRows = page.locator('.xterm-rows')
  await expect(terminalRows).toContainText(f1Ready, { timeout: 12_000 })
  await expect(terminalRows).not.toContainText(f1Result)
  await page.getByRole('button', { name: '更多按键' }).click()
  const f1Button = page.getByRole('button', { name: 'F1', exact: true })
  await expect(f1Button).toBeVisible()
  await f1Button.click()
  await expect(terminalRows).toContainText(f1Result, { timeout: 12_000 })

  await page.getByRole('button', { name: 'Open sessions' }).click()
  await page.getByRole('button', { name: `Stop ${name}` }).click()
  await expect(page.getByTestId(`session-${name}`)).toContainText('Stopped')
  await expect(page.locator('.header-status')).toContainText('会话已停止')

  await page.getByRole('button', { name: `Resume ${name}` }).click()
  await expect(page.getByTestId(`session-${name}`)).toContainText('Running')
  await expect(page.locator('.header-status')).toContainText('已连接', { timeout: 30_000 })

  await page.getByTestId(`delete-${name}`).click()
  await page.getByTestId('cancel-delete').click()
  await expect(page.getByTestId(`session-${name}`)).toBeVisible()

  await page.getByTestId(`delete-${name}`).click()
  await page.getByTestId('confirm-delete').click()
  await expect(page.getByTestId(`session-${name}`)).toHaveCount(0)
  await expect.poll(async () => (await (await page.request.get('/api/sessions')).json()).sessions).toEqual([])
})
