import { encodeKey, encodeSequence, encodeText } from './key-encoder'
import type { InputToken, TerminalKey, TerminalModifier } from './key-encoder'
import type { ModifierMode, ModifierStates, ShortcutPreset } from './key-definitions'

export interface VisibilityTarget {
  visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface TerminalInputControllerOptions {
  sendInput: (data: string) => boolean
  getApplicationCursorKeysMode: () => boolean
  onModifiersChange?: (modifiers: ModifierStates) => void
  visibilityTarget?: VisibilityTarget
}

const initialModifiers = (): ModifierStates => ({ ctrl: 'off', alt: 'off' })
let nextInputGeneration = 1

function activeModifiers(state: ModifierStates): TerminalModifier[] {
  return (['ctrl', 'alt'] as const).filter((modifier) => state[modifier] !== 'off')
}

export class TerminalInputController {
  private readonly options: TerminalInputControllerOptions
  private readonly visibilityTarget?: VisibilityTarget
  private readonly visibilityListener: () => void
  private state: ModifierStates = initialModifiers()
  private epoch = 0
  private disposed = false

  constructor(options: TerminalInputControllerOptions) {
    this.options = options
    this.epoch = nextInputGeneration++
    this.visibilityTarget = options.visibilityTarget ?? (typeof document === 'undefined' ? undefined : document)
    this.visibilityListener = () => {
      if (this.visibilityTarget?.visibilityState === 'hidden') this.reset()
    }
    this.visibilityTarget?.addEventListener('visibilitychange', this.visibilityListener)
    this.publishState()
  }

  get modifiers(): ModifierStates {
    return { ...this.state }
  }

  get generation(): number {
    return this.epoch
  }

  get hasActiveModifiers(): boolean {
    return this.state.ctrl !== 'off' || this.state.alt !== 'off'
  }

  toggleModifier(modifier: TerminalModifier): void {
    if (this.disposed) return
    const current = this.state[modifier]
    this.state[modifier] = current === 'off' ? 'once' : 'off'
    this.publishState()
  }

  lockModifier(modifier: TerminalModifier): void {
    if (this.disposed) return
    this.state[modifier] = 'locked'
    this.publishState()
  }

  pressKey(key: TerminalKey): boolean {
    if (this.disposed) return false
    return this.sendEncoded(encodeKey(key, {
      applicationCursorKeysMode: this.options.getApplicationCursorKeysMode(),
      modifiers: activeModifiers(this.state),
    }), this.epoch, true)
  }

  submitText(text: string, source: 'virtual' | 'paste' | 'text' = 'virtual', generation = this.epoch): boolean {
    if (!text || this.disposed || generation !== this.epoch) return false
    if (source !== 'virtual') return this.sendEncoded(text, generation, false)
    return this.sendEncoded(encodeText(text, activeModifiers(this.state)), generation, true)
  }

  sendSequence(
    sequence: readonly InputToken[],
    options: { modifiers?: readonly TerminalModifier[]; generation?: number; consumeOneShot?: boolean } = {},
  ): boolean {
    if (this.disposed) return false
    const generation = options.generation ?? this.epoch
    if (generation !== this.epoch || sequence.length === 0) return false
    const modifiers = options.modifiers ?? activeModifiers(this.state)
    const data = encodeSequence(sequence, {
      applicationCursorKeysMode: this.options.getApplicationCursorKeysMode(),
      modifiers,
    })
    const consumeOneShot = options.consumeOneShot ?? options.modifiers === undefined
    return this.sendEncoded(data, generation, consumeOneShot)
  }

  sendPreset(preset: ShortcutPreset): boolean {
    const modifiers = [...new Set([...activeModifiers(this.state), ...preset.modifiers])]
    return this.sendSequence(preset.sequence, { modifiers, consumeOneShot: true })
  }

  reset(): void {
    if (this.disposed) return
    this.epoch = nextInputGeneration++
    this.state = initialModifiers()
    this.publishState()
  }

  destroy(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.visibilityTarget?.removeEventListener('visibilitychange', this.visibilityListener)
  }

  private sendEncoded(data: string, generation: number, consumeOneShot: boolean): boolean {
    if (!data || this.disposed || generation !== this.epoch) return false
    const sent = this.options.sendInput(data)
    if (!sent) {
      this.reset()
      return false
    }
    if (consumeOneShot) this.consumeOneShotModifiers()
    return true
  }

  private consumeOneShotModifiers(): void {
    let changed = false
    for (const modifier of ['ctrl', 'alt'] as const) {
      if (this.state[modifier] === 'once') {
        this.state[modifier] = 'off'
        changed = true
      }
    }
    if (changed) this.publishState()
  }

  private publishState(): void {
    this.options.onModifiersChange?.(this.modifiers)
  }
}

export type { ModifierMode, ModifierStates }
