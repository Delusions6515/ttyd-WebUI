export const ttydCommand = {
  output: 0x30,
  title: 0x31,
  preferences: 0x32,
  input: 0x30,
  resize: 0x31,
  pause: 0x32,
  resume: 0x33,
} as const

export function ttydFrame(command: number, payload: Uint8Array | string = ''): Uint8Array {
  const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  const frame = new Uint8Array(body.length + 1)
  frame[0] = command
  frame.set(body, 1)
  return frame
}
