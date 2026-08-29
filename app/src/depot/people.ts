import { personLabel, type DepotState } from '@foerier/shared'

/** A Person, and the label every surface draws them by. */
export interface PersonRow {
  id: string
  /** `personLabel` — the recorded name, or `—` when there is none. */
  label: string
}

/**
 * Every recorded Person, alphabetically.
 *
 * **By the label a row actually draws**, not by the stored name: a Person
 * whose name is absent or cleared draws `—`, and sorting by the raw name
 * would file them by an empty string while the reader sees a dash. The id
 * breaks the tie so the order is **total** — two devices with identical
 * state must draw the same list, the same rule `dimensionValues` and the
 * group headers already follow.
 *
 * Lives here rather than in either caller because the People screen and the
 * owner picker are two views of one list; if they sorted differently, picking
 * "the third one down" would mean two different People.
 */
export function sortedPeople(state: DepotState): readonly PersonRow[] {
  return Object.values(state.people)
    .map((person) => ({ id: person.id, label: personLabel(state, person.id) }))
    .sort((a, b) => {
      const al = a.label.toLowerCase()
      const bl = b.label.toLowerCase()
      if (al !== bl) return al < bl ? -1 : 1
      if (a.id === b.id) return 0
      return a.id < b.id ? -1 : 1
    })
}
