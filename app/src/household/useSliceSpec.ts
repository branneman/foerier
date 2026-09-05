import { EMPTY_SLICE, type SliceSpec } from '@foerier/shared'
import { useCallback, useState } from 'react'

import { readSlicePrefs, writeSlicePrefs } from './slicePrefs'

/**
 * The Depot's narrowing, held for the screen and persisted where the design
 * says to persist it.
 *
 * > Sort and group persist per device. Filter chips and search reset on a
 * > fresh start, but survive navigation.
 * > — `docs/design/README.md` §3
 *
 * Both halves fall out of where the state lives rather than from any logic
 * here: sort and group are written through to `localStorage` on every change,
 * and filters and search are ordinary React state, so "reset on a fresh
 * start" is what happens by construction.
 *
 * The initial read happens **once**, in `useState`'s initialiser, rather than
 * in an effect — so the first paint is already the reader's own sort instead
 * of the default flipping to it.
 */
export function useSliceSpec(): [SliceSpec, (next: SliceSpec) => void] {
  const [spec, setSpec] = useState<SliceSpec>(() => ({
    ...EMPTY_SLICE,
    ...readSlicePrefs(),
  }))

  const update = useCallback((next: SliceSpec) => {
    setSpec((current) => {
      // Written only when it actually changed: a keystroke in the search
      // field must not touch storage.
      if (next.sort !== current.sort || next.group !== current.group) {
        writeSlicePrefs({ sort: next.sort, group: next.group })
      }
      return next
    })
  }, [])

  return [spec, update]
}
