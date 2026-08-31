import styles from './PersonCircle.module.css'

/**
 * The person circle — one primitive folded from six hand-rolled copies
 * (`TripCard`, `Trip`'s header cluster, `GearListBuilder`'s desk header,
 * `NewTrip`'s Participants row, `ParticipantPicker`, `People`), the same
 * move `GearRow` made at S3. The task that built this counted five —
 * `NewTrip` had drifted from `TripCard` unnoticed — and the sixth folded in
 * for the same reason the other five did.
 *
 * **The prop is a `tone`, not a semantic `state`.** Three slices want this
 * one border to mean three different things — S5's login ring ("holds a
 * login"), S8's inclusion, S9's packing fills — and a semantic prop would
 * become the union of every slice's vocabulary, re-shaped each time one of
 * them lands. A `ui/` primitive renders a **tone** and the **caller** owns
 * the meaning, exactly as `Chip` does: `Chip` knows nothing about tags, and
 * this knows nothing about logins. `none` is a **transparent** border that
 * still holds the layout — S5's *withdrawal*, and it is load-bearing, not a
 * styling detail: the ring *is* the claim "login state is known", so when it
 * cannot be known the ring goes rather than turning a third colour
 * (`docs/design/README.md` §13 — a third colour was tried first and
 * collapsed in the parchment theme, where every `--color-rule*` resolved to
 * one value).
 *
 * **Named `label`, not `initial`.** An initial is the caller's own
 * `label.charAt(0).toUpperCase()`, computed before it ever reaches this
 * component — this renders whatever string it is given, verbatim. That is
 * what makes ruling E's overflow slot (`+3`) the same circle rather than a
 * variant of it: a prop named `initial` would have nowhere honest to put a
 * count. `undefined` draws an **empty** circle, never a placeholder letter —
 * a Person with no folded name is a fact the app does not have, and
 * inventing one would be worse than blank.
 *
 * **Sizes are the numbers 22 · 24 · 30, not a `sm|md|lg` scale.** Two
 * diameters exist today; S8 adds 24 and S9 adds 28 and 34 — a t-shirt scale
 * would already be out of names by S9 and need renaming across every
 * caller.
 *
 * **A circle is sized by the density of the band it sits in, never by the
 * screen** — `design/README.md` §5d K, which named the scale rather than
 * answering the one number S8 asked about, so S9 adds its two against a
 * system instead of picking per screen:
 *
 * | px | Band |
 * | --- | --- |
 * | 22 | chrome clusters — participant clusters riding card/header meta |
 * | 24 | dense display rows — clusters at TABLE-44 read density |
 * | 28 | group headers (S9) |
 * | 30 | roster rows — 48px picker and People rows, circle leads the row |
 * | 34 | working rows (S9) — where the circle carries status at glance speed |
 *
 * That is why the picker rows draw 30 and the gear-list row's cluster draws
 * 24 while both sit on the same screen: the row's own density decides, not
 * the surface that opened it. S9's 28 and 34 join the union above; no
 * caller renames.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5): this
 * takes a label, not a Person id, and a caller's own `aria-hidden` / one
 * cluster-level `role="img"` stays with the caller — moving accessibility in
 * here would give every circle its own announced letter, which is exactly
 * the ambiguity `TripCard`'s cluster comment argues against.
 */
export interface PersonCircleProps {
  /** Verbatim content; see the `label`-not-`initial` note above. */
  label?: string | undefined
  /** 22 · 24 · 30 — see the sizes note above. */
  size: 22 | 24 | 30
  /**
   * Defaults to `control`, the display-only border every non-login caller
   * draws. See the tone-not-state note above for what each value means —
   * this component does not know.
   */
  tone?: 'control' | 'accent' | 'dashed' | 'none'
}

export function PersonCircle({
  label,
  size,
  tone = 'control',
}: PersonCircleProps) {
  return (
    <span
      className={`${styles['circle']} ${styles[`size${size}`]}`}
      data-testid="person-circle"
      data-tone={tone}
    >
      {label ?? ''}
    </span>
  )
}
