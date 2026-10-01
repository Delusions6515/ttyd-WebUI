import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY, createPreferencesStore } from './preferences'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('preferences store', () => {
  it('loads defaults, persists validated preferences, and restores them on a fresh store', () => {
    const storage = new MemoryStorage()
    const first = createPreferencesStore(storage)
    expect(first.state).toEqual(DEFAULT_PREFERENCES)

    const changed = {
      ...DEFAULT_PREFERENCES,
      fontSize: 18,
      showExtraKeys: false,
      keyRows: [
        [{ label: '<b>x</b>', ariaLabel: '<b>x</b>', action: { type: 'text', text: '/' } }],
        [{ label: 'F12', ariaLabel: 'F12', action: { type: 'key', key: 'F12' } }],
      ],
    }
    expect(first.save(changed)).toBe(true)
    const persisted = JSON.parse(storage.values.get(PREFERENCES_STORAGE_KEY)!) as Record<string, unknown>
    expect(persisted.version).toBe(1)
    expect(Object.keys(persisted).sort()).toEqual(['fontSize', 'keyRows', 'showExtraKeys', 'version'])

    const restored = createPreferencesStore(storage)
    expect(restored.state).toEqual(changed)
    expect(restored.state.keyRows[0]?.[0]?.label).toBe('<b>x</b>')
  })

  it('falls back to safe defaults for corrupt, stale, or invalid data', () => {
    for (const value of ['{bad json', '{"version":0}', JSON.stringify({
      version: 1,
      fontSize: 0,
      showExtraKeys: true,
      keyRows: DEFAULT_PREFERENCES.keyRows,
    }), JSON.stringify({
      version: 1,
      fontSize: 13,
      showExtraKeys: true,
      keyRows: [[{ label: 'bad', ariaLabel: 'bad', action: { type: 'key', key: 'shell' } }], []],
    })]) {
      const storage = new MemoryStorage()
      storage.values.set(PREFERENCES_STORAGE_KEY, value)
      expect(createPreferencesStore(storage).state).toEqual(DEFAULT_PREFERENCES)
    }
  })

  it('keeps temporary edits usable when browser storage cannot be read or written', () => {
    const blockedStorage = {
      getItem(): string { throw new Error('storage blocked') },
      setItem(): void { throw new Error('storage blocked') },
    }
    const store = createPreferencesStore(blockedStorage)
    expect(store.save({ ...DEFAULT_PREFERENCES, fontSize: 20 })).toBe(true)
    expect(store.state.fontSize).toBe(20)
    store.reset()
    expect(store.state).toEqual(DEFAULT_PREFERENCES)
  })

  it('resets the complete saved configuration to defaults', () => {
    const storage = new MemoryStorage()
    const store = createPreferencesStore(storage)
    store.save({ ...DEFAULT_PREFERENCES, fontSize: 19, showExtraKeys: false })
    store.reset()
    expect(createPreferencesStore(storage).state).toEqual(DEFAULT_PREFERENCES)
  })
})
