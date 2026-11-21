import { useEffect, useState } from 'react'

const snapshots = new Map<string, unknown>()

/** Retain tool drafts in memory when the desktop main panel unmounts. */
export function useRetainedToolState<T>(key: string | undefined, initial: T) {
  const state = useState<T>(() => key && snapshots.has(key) ? snapshots.get(key) as T : initial)
  useEffect(() => { if (key) snapshots.set(key, state[0]) }, [key, state[0]])
  return state
}
