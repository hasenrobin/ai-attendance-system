import { useRef, useState, useLayoutEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const DRAFT_PREFIX = 'draft:'

type DraftEnvelope<T> = {
  value: T
  savedAt: number
}

function readDraft<T>(key: string): { found: true; value: T } | { found: false } {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw === null) return { found: false }
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('savedAt' in parsed) || !('value' in parsed) ||
      typeof (parsed as { savedAt: unknown }).savedAt !== 'number'
    ) {
      sessionStorage.removeItem(key)
      return { found: false }
    }
    const envelope = parsed as DraftEnvelope<T>
    if (Date.now() - envelope.savedAt > SEVEN_DAYS_MS) {
      sessionStorage.removeItem(key)
      return { found: false }
    }
    return { found: true, value: envelope.value }
  } catch {
    return { found: false }
  }
}

function writeDraft<T>(key: string, value: T): void {
  try {
    const envelope: DraftEnvelope<T> = { value, savedAt: Date.now() }
    sessionStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // sessionStorage unavailable or full — draft persistence is best-effort
  }
}

/** Returns true if a non-stale draft exists for the given key. */
export function hasDraft(key: string | null): boolean {
  if (!key) return false
  return readDraft<unknown>(key).found
}

/**
 * useState-like hook backed by sessionStorage. Restores a saved draft on mount
 * (or when `key` changes to one with an existing draft), and persists the value
 * under `key` whenever it changes. Drafts older than 7 days are discarded.
 *
 * Pass `key = null` to disable persistence (behaves like plain useState).
 */
export function usePersistentState<T>(
  key: string | null,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const initialValueRef = useRef(initialValue)
  const [value, setValue] = useState<T>(() => {
    if (key) {
      const draft = readDraft<T>(key)
      if (draft.found) return draft.value
    }
    return initialValue
  })
  const lastKeyRef = useRef<string | null>(key)

  useLayoutEffect(() => {
    if (lastKeyRef.current === key) {
      if (key && value !== initialValueRef.current) {
        writeDraft(key, value)
      }
      return
    }
    lastKeyRef.current = key
    if (key) {
      const draft = readDraft<T>(key)
      if (draft.found) setValue(draft.value)
    } else {
      setValue(initialValueRef.current)
    }
  }, [key, value])

  function clearDraft() {
    if (key) {
      try {
        sessionStorage.removeItem(key)
      } catch {
        // ignore
      }
    }
  }

  return [value, setValue, clearDraft]
}

/** Removes all draft:* entries from sessionStorage. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch {
    // ignore
  }
}
