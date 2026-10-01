export interface BufferTextLine {
  readonly isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export interface BufferTextSource {
  readonly length: number
  getLine(index: number): BufferTextLine | undefined
}

export function getBufferText(buffer: BufferTextSource): string {
  const text: string[] = []
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index)
    if (!line) continue
    if (text.length > 0 && !line.isWrapped) text.push('\n')
    text.push(line.translateToString(true))
  }
  return text.join('')
}
