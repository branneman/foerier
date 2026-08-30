import type { DepotState, GearState, Owner } from '../state.ts'

/**
 * **Ownership on the way out** — the one module that decides what an ownership
 * register *reads* as, so no screen decides it twice.
 *
 * The register is `{type:'shared'} | {type:'person', personId}`
 * (`sync-protocol.md` §4.3) and is **optional**: gear recorded before S4, or
 * recorded by a screen that does not ask, carries no `owner` at all.
 *
 * ## An absent register reads SHARED
 *
 * No board draws an unowned state. Every Depot table row the boards draw reads
 * `SHARED` in the OWNER column — including `Tent, 2p (old)`, whose HOME column
 * reads `—`. So the boards plainly *can* draw "not recorded" for a field, and
 * choose not to for this one.
 *
 * It matters more than a rendering convenience, which is why it lives here and
 * not at a call site: the Ownership dimension derives its values from this
 * function (`slice.ts`), so a filter disagreeing with a readout would be a bug
 * a Quartermaster can see — narrow to `OWNERSHIP: SHARED` and watch a row
 * labelled `SHARED` vanish.
 *
 * The **fold** conflates nothing. `reduce.ts` writes only what arrived and an
 * absent register stays absent, because the two are different facts about the
 * op log even where they are the same fact about the gear. The equivalence is
 * stated once, here, on the way out.
 */

const SHARED: Owner = { type: 'shared' }

/** The gear's owner, with an absent register read as shared. */
export function ownerOf(gear: GearState): Owner {
  return gear.owner?.value ?? SHARED
}

/**
 * `SHARED` or `PERSONAL E` — the Depot row's meta slot, the Depot table's
 * OWNER column and gear detail's meta line, which must agree.
 *
 * **The initial, not the name**, matching the person circle's own convention
 * everywhere else in the app. The boards spell it two ways — `PERSONAL E` on
 * Depot rows and `PERSONAL · E` on Packing rows — and this resolves to the
 * Depot's, because the Depot is what S4 ships and Packing's `·` is that
 * screen's separator between owner and count (`PERSONAL · E · ×2`), not a
 * different vocabulary. S9 inherits this function rather than re-deciding.
 *
 * A Person with no folded name yields **`PERSONAL`** alone: there is no
 * initial to draw, and inventing one would be a fact the app does not have.
 * That is `AppShell`'s `AccountAvatar` rule — "`null` draws an empty circle
 * rather than a placeholder letter" — applied to text.
 */
export function ownerLabel(state: DepotState, gear: GearState): string {
  const owner = ownerOf(gear)
  if (owner.type === 'shared') return 'SHARED'
  const initial = initialOf(state, owner.personId)
  return initial === '' ? 'PERSONAL' : `PERSONAL ${initial}`
}

/** The one place `.trim().charAt(0).toUpperCase()` is computed for a Person's
 * name — `ownerLabel` and {@link ownerInitial} both call it rather than
 * carrying their own copy. `App.tsx` and `NewTrip.tsx` each hand-roll the
 * identical expression for a circle's own initial (a different question —
 * a Person's, not an owner register's), which is exactly the drift this
 * module's own header warns a second copy invites; a third one inside this
 * file would be the same mistake one line closer to home. */
function initialOf(state: DepotState, personId: string): string {
  return (state.people[personId]?.name?.value ?? '')
    .trim()
    .charAt(0)
    .toUpperCase()
}

/**
 * The bare letter a **Personal** owner draws — `E`, with no `PERSONAL`
 * beside it — for a meta slot that isn't the Depot's own OWNER column.
 * `DepotPicker.tsx`'s row is the first caller: its Kind-vs-Ownership ruling
 * (S7 review F1) only ever needs the initial alone, once Kind has first
 * claim on the suffix.
 *
 * `undefined` for **Shared** gear — there is no letter to draw at all, which
 * is a different fact from `ownerLabel`'s `'PERSONAL'` fallback text (that
 * function always has *something* to say; this one sometimes has nothing) —
 * and `undefined` for a Personal owner with no folded name, the same "no
 * letter to invent" rule `ownerLabel` and `AccountAvatar` both already keep.
 * Either way the caller decides what "nothing to draw" means for its own
 * layout, which is why this returns `undefined` rather than `''`.
 */
export function ownerInitial(
  state: DepotState,
  gear: GearState,
): string | undefined {
  const owner = ownerOf(gear)
  if (owner.type === 'shared') return undefined
  const initial = initialOf(state, owner.personId)
  return initial === '' ? undefined : initial
}

/**
 * What {@link personLabel} returns for a Person with no folded name, and the
 * one place the glyph is spelled.
 *
 * Every surface that draws a Person as a **circle** has to ask whether there
 * is an initial to draw — the trip card, the trip screen, the People screen,
 * the new-trip row, the participant picker — and each asked by comparing
 * against a literal `'—'` of its own. Five copies of a sentinel is five
 * chances to drift from the one function that produces it, and the drift is
 * silent: a circle would draw the em dash as somebody's initial. So the
 * sentinel lives beside the label it is a value of, and every reader imports
 * it.
 */
export const UNNAMED_PERSON = '—'

/**
 * A Person's name for a chip, a picker row or a group header — sentence case,
 * as recorded, never upper-cased here (CAPS is a CSS transform where a surface
 * wants it, matching how the rest of this codebase renders label text).
 *
 * An unnamed or unknown Person reads {@link UNNAMED_PERSON}, the same glyph
 * the ungrouped bucket uses. Both are reachable: a `person.recorded` carrying
 * an explicit `null`, and — more often — a gear op naming a Person whose own
 * op is still queued on someone else's phone. A chip with an empty label would
 * look broken and a raw UUID would look worse; `—` is selectable, countable,
 * and honest.
 */
export function personLabel(state: DepotState, personId: string): string {
  const name = state.people[personId]?.name?.value ?? ''
  return name.trim() === '' ? UNNAMED_PERSON : name
}
