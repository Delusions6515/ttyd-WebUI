import { describe, expect, it } from 'vitest'
import { getBufferText } from './buffer-text'

function line(text: string, isWrapped = false) {
  return {
    isWrapped,
    translateToString: () => text,
  }
}

function buffer(lines: ReturnType<typeof line>[]) {
  return {
    length: lines.length,
    getLine: (index: number) => lines[index],
  }
}

describe('getBufferText', () => {
  it('joins wrapped wide-character lines and separates terminal hard breaks', () => {
    const source = buffer([
      line('first '),
      line('界🙂 second', true),
      line('<img src=x>&'),
      line('tail', true),
    ])
    expect(getBufferText(source)).toBe('first 界🙂 second\n<img src=x>&tail')
  })

  it('reads the supplied active buffer, including alternate-screen content', () => {
    const normal = buffer([line('normal history')])
    const alternate = buffer([line('alternate'), line('screen', true)])
    const active = alternate
    expect(getBufferText(active)).toBe('alternatescreen')
    expect(getBufferText(normal)).toBe('normal history')
  })

  it('keeps text data literal instead of interpreting markup', () => {
    const literal = '<script>alert("x")</script>'
    expect(getBufferText(buffer([line(literal)]))).toBe(literal)
  })
})
