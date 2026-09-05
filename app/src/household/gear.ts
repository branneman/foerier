import type { KindValue } from '@foerier/shared'
import type { SegmentedOption } from '@foerier/ui'

/**
 * The two vocabularies a gear-authoring screen offers, spelled once —
 * `people.ts`'s and `trips.ts`'s shelf, for the same reason (`patterns.md`
 * §1.8): app-side display data, composed from `shared/`'s types, kept out of
 * the screens that draw it.
 *
 * Both were copied. `KIND_OPTIONS` stood identically in `AddGear` and
 * `GearDetail`, and the trait pair in `AddGear` and `TripOnlySheet` — four
 * literals for two vocabularies, and every one of them a place a fifth Kind
 * could fail to appear.
 */

/**
 * The Kind selector's own words (`docs/domain-model.md` §2). **Exhaustive
 * over {@link KindValue} by construction**, and pinned as such: a Kind added
 * to `shared/` that never reaches a picker is unauthorable, and nothing else
 * in the app would say so.
 *
 * Sentence case, uppercased by CSS where a caller draws it dense — CAPS is a
 * transform, never a string (`patterns.md` §6.2).
 */
export const KIND_OPTIONS: readonly SegmentedOption<KindValue>[] = [
  { value: 'single', label: 'Single' },
  { value: 'per_person', label: 'Per-person' },
  { value: 'counted', label: 'Counted' },
]

/**
 * The **containment trait**, as the two words the meta line uses
 * (`docs/design/README.md` §4) — not the Kind, and never a checkbox: a
 * checkbox reads as a setting, and the trait is fixed at recording.
 *
 * A string pair rather than the boolean the register holds, because
 * `ui/SegmentedControl` speaks values and the caller owns what one *means*
 * (`patterns.md` §5.3). Each caller maps back at its own `onChange`.
 */
export type TraitValue = 'item' | 'container'

export const TRAIT_OPTIONS: readonly SegmentedOption<TraitValue>[] = [
  { value: 'item', label: 'Item' },
  { value: 'container', label: 'Container' },
]
