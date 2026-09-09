import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import { useHouseholdStore, type HouseholdStoreState } from '../household/store'
import styles from './SignedInAs.module.css'

/**
 * `Els · Veldkamp` — the join success frame's identity line
 * (`docs/design/README.md` §9).
 *
 * **The board tagged it `API FIELD` and it needed no API field.** All three of
 * §9's name lines were recorded as blocked on the join endpoints returning a
 * person name; that is true of the *confirm* frame's `YOU JOIN AS` and
 * `INVITED BY`, which are drawn before this Device has a session — and §5n
 * K30 has since **withdrawn** those two rather than unblocking them, the tag
 * having been the wrong description of the blocker. It was never true here. By the time this frame renders, the Device has signed in and
 * is folding the household's own log — where the name lives. The Person is
 * `person_id` on the Invite, and resolving a `person_id` against the fold is
 * exactly what [auth-design §2.1](../../../docs/auth-design.md) says the
 * **client** does: the server stores that UUID with no meaning attached, and
 * there is no `person` table for it to join against.
 *
 * **Omitted, never faked**, which §9 states in as many words. Three ways the
 * name is legitimately absent, and all three draw nothing rather than a bare
 * `· Veldkamp`:
 *
 * - the fold has not reached this Person's `person.recorded` yet — the
 *   first-sync card beside this line *is* that fold, in progress,
 * - the Device has no depot at all, the window between signing in and the
 *   store being built, which is why this reads through
 *   {@link useHouseholdStore} rather than `useHousehold`,
 * - a joiner naming themselves has not flushed their own `person.recorded`.
 *
 * `personNameOrUnnamed`'s sentinel is deliberately **not** used: `— ·
 * Veldkamp` states a Person whose name nobody knows, and the board asks for
 * silence instead. The sentinel is right in a column and wrong in a sentence
 * (`patterns.md` §1.5), and this is the sentence case.
 */
export interface SignedInAsProps {
  /** The Person this Invite names — `person_id` from the preview. */
  readonly personId: string
  /** The household's own name, which the preview already carries. */
  readonly householdName: string
}

export function SignedInAs({ personId, householdName }: SignedInAsProps) {
  const store = useHouseholdStore()
  // The store-less window is a render, not an error — `FirstSync` beside this
  // line tolerates it the same way. Split in two so the hook below is never
  // called conditionally.
  if (store === null) return null

  return (
    <ResolvedLine
      store={store}
      personId={personId}
      householdName={householdName}
    />
  )
}

function ResolvedLine({
  store,
  personId,
  householdName,
}: SignedInAsProps & { readonly store: StoreApi<HouseholdStoreState> }) {
  // Subscribed rather than read once: the fold arrives page by page, and the
  // line appears the moment this Person's own op does.
  const name = useStore(
    store,
    (depot) => depot.state.people[personId]?.name?.value ?? '',
  )

  if (name === '') return null

  return (
    <p className={styles['line']}>
      {name} · {householdName}
    </p>
  )
}
