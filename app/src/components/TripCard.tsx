import {
  phaseNext,
  phaseOf,
  tripLabel,
  tripNameOrUnnamed,
  UNNAMED_PERSON_GLYPH,
  type PackingCount,
  type TripState,
} from '@foerier/shared'
import { PersonCluster } from '@foerier/ui'
import { Link } from 'wouter'

import { useHousehold } from '../household/store'
import {
  leftLabel,
  packedLabel,
  packedPercent,
  tripChip,
  tripDateRange,
  tripParticipants,
} from '../household/trips'
import { entryCountLabel } from './GearListSection'
import styles from './TripCard.module.css'

/**
 * **A Trip, as the Trips list draws it** — `Screens B` §02A's `Trips — S6 ship
 * state`: the active card and its dashed draft card, which are one component
 * with two variants rather than two components, because the anatomy is
 * identical (name · phase chip · dates · Participants · next step · a way in)
 * and what differs is which of those facts a Trip in that section happens to
 * hold.
 *
 * It lives in `app/src/components/` and not in `ui/`. `GearRow` earned its
 * place there by having two callers in two screens (`Depot` and `Find`); this
 * has one. It moves when S7 or S9 gives it a second — the same rule, applied
 * the same way rather than pre-empted (spec §4.1).
 *
 * ## No button, no verb link — except where the destination now exists
 *
 * `OPEN ›` is retired. The board's reason, verbatim: it *"spent the system's
 * strongest element on its flattest verb and taught the accent button to mean
 * nothing"*. A board's CTA copy lands on the slice that builds its
 * destination — `BUILD LIST ›` with the builder, `Continue pack-out` with the
 * packing view — and until then the interim affordance is the closed row's own
 * `›` with the whole card tappable.
 *
 * S7 builds the first of those two destinations, so the accent mono link
 * returns on **every `planned` card** (`docs/design/README.md` §5: `BUILD
 * LIST ›` beats Components §06's bordered `Build gear list`) — and **retires
 * the bare `›` there with it**. Fix round F10: that is not "the Draft card
 * alone" — `tripSections`' own docstring (`shared/src/selectors/trip.ts`)
 * files `draft` **and anything this build's phase table does not
 * recognise** into `planned`, and that decision asks no phase at all, only
 * `variant`, so a Trip in an unrecognised phase draws `BUILD LIST ›`
 * exactly as a Draft does. (S9a's CTA below *does* ask the phase — for the
 * one question `variant` cannot answer, which phase the Trip is active in —
 * and the two questions stay separate rather than one being derived from the
 * other.) Harmless and inherited — the boards draw only
 * Draft in this section, so it is what every drawn planned card happens to
 * be — but the component's own contract is wider than that. `.chevron` now
 * renders on the active card only: no drawn Draft card carries both a bare
 * `›` and `BUILD LIST ›` (`Screens B:207-212`, `:483-487`; `Screens
 * A:626-630`, `:656-660` — each frame draws exactly one), and below Split
 * the two would be separate tap targets landing on the same route anyway.
 *
 * The link is a second control, raised beside `.surface` exactly as the
 * phase chip is — never nested inside the stretched link, for the same
 * invalid-HTML-and-live-bug reason below. **Its `href` is `Trips.tsx`'s to
 * decide, not this component's**: below Split the trip screen *is* the
 * editor, so it leads to `/trips/:id`; from Split up the builder is, so it
 * leads to `/trips/:id/list?from=trips` — the query `GearListBuilder.tsx`
 * reads to draw `‹ TRIPS` rather than the Trip's own name. That is *not* the
 * same mechanism as the trip screen's own `EDIT LIST ›` (`Trip.tsx`, spec
 * §4.4), even though both switch on `SPLIT`: that link is **withheld** below
 * Split (`useScreenHeader`'s gate — the `GEAR LIST` band's trailing link
 * never appears there, because the screen itself is the editor), while this
 * one is always drawn and **retargeted**. Two callers of the same breakpoint
 * reaching opposite answers, correctly, because the questions differ: "is
 * the destination already on the page" against "which page is the
 * destination." `Trips.tsx` already asks `useMediaQuery(SPLIT)` for its own
 * `+ NEW` slot, so the computed route arrives here as a plain prop — the
 * component asks no media query of its own, and `@container, never a media
 * query` below stays true with no exception carved out for this link.
 *
 * ## `Continue pack-out`, and only that one
 *
 * S9a builds the second destination, so the card's fifth element lands: a
 * full-width 48px accent CTA on the active card **at Pack-out and nowhere
 * else** (`docs/design/README.md` §5's S9a paragraph, ruling A11).
 *
 * **At On trip the slot stays empty**, which is a ruling and not an
 * oversight. The CTA names the *current phase's verb*, and the control for
 * that verb is the phase chip this card already carries; `Continue unpack`
 * would name F5, a screen that does not exist, so it would be the retired
 * `OPEN ›` failure one worse — an accent button that lies about where it
 * goes. Unpack's CTA is S10's to draw. Draft keeps `BUILD LIST ›`, and
 * `ClosedRow` (`Trips.tsx`) keeps its own row.
 *
 * It is gated on **`phaseOf` alone**, with no `variant === 'active'` beside
 * it: `isActive` is the only definition of active-ness in the codebase and
 * `pack_out` is one of the phases it names, so `tripSections` has already
 * filed every Trip this fires on into `active`. A second condition would be
 * a second definition of the same fact — the thing `CLAUDE.md` names as the
 * S6 failure mode — not a safety net.
 *
 * **`/trips/:id/packing` is built inline and is not a prop**, unlike
 * `buildListHref`. See that prop's own note for why the two differ.
 *
 * ## The progress line sits **below** the NEXT line
 *
 * `● 48/61 PIECES` · `13 LEFT` and the 6px bar, in §5's order: the permanent
 * obligation above the arithmetic, the arithmetic above the action. This is
 * the one thing about this card that has been got backwards before —
 * `architecture-design.md` §12.11 said "above" until the S6 design round, and
 * the board now says `NEXT LINE SITS ABOVE THE PROGRESS LINE.` in as many
 * words.
 *
 * It draws on **Active cards only** — a Draft's `● 0/59 PIECES` would state
 * progress against an arrangement invariant 17 makes inert, and the dashed
 * card's own `DRAFT · 14 ENTRIES` is the count that matters there. Stated at
 * both ends, as the entry count's mirror-image rule already is: the caller
 * reads `packingTotals` for the `active` section alone, and this draws it
 * for the `active` variant alone. The words and the
 * width both come from `depot/trips.ts`, shared with the packing view this
 * card's CTA opens, so the two can never draw one Trip differently.
 *
 * **`aria-label={`Build list for ${spokenName}`}`, not the link's bare text
 * as its accessible name.** `.card` is an `<article>` with no accessible
 * name, and the `<li>` `Trips.tsx` wraps it in carries none either — an
 * unnamed ancestor gives a descendant's name nothing to borrow, so a list of
 * Draft cards would otherwise announce `BUILD LIST ›`, `BUILD LIST ›`,
 * `BUILD LIST ›` indistinguishably, exactly the ambiguity `Open {name}` and
 * `Reopen {name}` already exist to avoid on this same card and `ClosedRow`.
 * The
 * label keeps `BUILD LIST` as a substring — WCAG 2.5.3 Label in Name, so
 * voice control saying "click build list" still finds it — and it doubles as
 * the fix for the `›` glyph: read as plain text content the accessible name
 * would include it too, spoken as "greater-than sign", where every other
 * chevron on this screen sits in an `aria-hidden` span instead. `aria-label`
 * overrides content wholesale, so one attribute does both jobs and the
 * visible text stays the board's own uniform `BUILD LIST ›` mono span.
 *
 * ## The link and the chip are siblings, never nested
 *
 * The phase chip is a `<button>`, and a button inside an anchor is invalid
 * HTML *and* a live interaction bug: one tap would open SET PHASE and navigate
 * away from the screen it opened on. `ClosedRow` already answers this — its
 * `REOPEN` sits *beside* the row's link rather than inside it — and the answer
 * is the same here, with the link stretched over the card so that "beside, in
 * the DOM" still reads as "the whole card" under a thumb. Neither element
 * contains the other, so nothing bubbles from one to the other.
 *
 * ## The NEXT line belongs to every non-closed card
 *
 * `phaseNext` is *"a permanent obligation, not a stand-in: it survives the
 * progress line and sits above it"* — which is exactly what S9a's line above
 * now demonstrates rather than promises: the two are drawn together, in that
 * order, on every active card. It shipped
 * active-only, on the argument that `NEXT — BUILD THE GEAR LIST` restates
 * `DRAFT · 0 ENTRIES`; the board reverses that, because the redundancy is
 * an accident of the count being zero and *"dies at `DRAFT · 14 ENTRIES`"*
 * (`docs/design/README.md` §5, restated in the noun S7 gives the count).
 *
 * So the line is asked for unconditionally, and `phaseNext`'s two nulls answer
 * for themselves: a **closed** Trip has nothing next, and an **unrecognised**
 * phase states nothing because the next step is a fact of the phase table and
 * there is no row. Both come out of `shared/`, not out of a variant test here.
 *
 * ## `@container`, never a media query
 *
 * The card folds against the width it is handed —
 * [frontend-design §3.2](../../../docs/frontend-design.md), and the board says
 * it in as many words: *"CONTAINER QUERY: SAME COMPONENTS, THE PANE PICKS THE
 * FOLD — NOT THE VIEWPORT."* The same card is the full-width one on a phone
 * and one of two columns at Roomy, where it is **narrower** than on the phone;
 * nothing about its contents changes, so nothing here is a media query.
 */
export interface TripCardProps {
  trip: TripState
  /**
   * Which section drew it — `tripSections`' own partition, never re-derived
   * here. `active` carries the `▸` glyph and the day count; `planned` is the
   * dashed outline and carries the entry count, plus `BUILD LIST ›`.
   */
  variant: 'active' | 'planned'
  /**
   * `listTotals(trip, state).entries` — the caller's own read, not this
   * component's. `Trips.tsx` already reads the store for `tripSections`;
   * this card reads it too, for `participants` (spec §4.1's own debt,
   * `technical-debt.md`). Adding a second store read here for the count
   * would deepen that debt rather than merely carry it, so the number
   * arrives as a plain prop instead.
   */
  entryCount: number
  /**
   * `Trips.tsx`'s own `useMediaQuery(SPLIT)`, already resolved into a route:
   * `/trips/{id}` below Split, `/trips/{id}/list?from=trips` from Split up.
   * Handed down rather than asked for here, so that `@container, never a
   * media query` above stays true of this component with no exception
   * carved out for `BUILD LIST ›`. Unused on the active card, which draws no
   * such link — see `entryCount` above for why the caller computes it
   * unconditionally anyway.
   *
   * **There is deliberately no `packingHref` beside it.** This prop is a
   * prop *because it is width-dependent*; `/trips/:id/packing` is the same
   * route at every width — its own route, never a pane — so the CTA builds
   * it inline and `@container, never a media query` keeps **one exception
   * fewer** rather than gaining a second one. A second href prop would say
   * the two links are the same kind of thing, and they are not.
   */
  buildListHref: string
  /**
   * `packingTotals(trip, state)` — the caller's own read, not this
   * component's, exactly as `entryCount` above and for the reason stated
   * there: this card already owes one store read (`participants`, spec
   * §4.1's own debt), and a second one here would **deepen** that debt
   * rather than merely carry it.
   *
   * `Trips.tsx` computes it for the `active` section and hands nothing down
   * for the `planned` one, so the section that decides it is `tripSections`'
   * own partition — asked once, where it is already known. The mirror of
   * `entryCount`, which the caller computes for `planned` alone and passes
   * as an uncomputed `0` on the active card, and which the card *also* draws
   * for one variant only: ruling A11's "Active cards only" is stated at both
   * ends, exactly as the entry count's own rule is.
   *
   * `| undefined` spelled out beside the `?`, which
   * `exactOptionalPropertyTypes` requires of a prop a caller passes as
   * `undefined` rather than omits — `OverClaimBand`'s `settle` carries the
   * same pair for the same reason, and its absence means something there
   * too.
   */
  progress?: PackingCount | undefined
  /**
   * The chip asks; the screen mounts the SET PHASE sheet. `ui/`'s primitives
   * have no `open` prop — mounted is open — so the caller writes
   * `{open && <PhaseSheet …/>}` and mount is what resets the sheet's own
   * state. A card that owned the sheet would put five of them in a list of
   * five Trips.
   */
  onOpenPhase: () => void
}

export function TripCard({
  trip,
  variant,
  entryCount,
  buildListHref,
  progress,
  onOpenPhase,
}: TripCardProps) {
  const state = useHousehold((depot) => depot.state)

  const label = tripLabel(trip)
  // The prose half of the glyph/prose split (`docs/design/README.md` §5c):
  // `tripLabel`'s `—` is right where the name stands as a *mark* — this
  // card's own title line, a list column, a group header — and wrong the
  // moment it is read as a word. Every accessible name below is a sentence
  // spoken aloud, where `—` announces as "em dash" or as nothing at all, so
  // all three take `tripNameOrUnnamed` instead. `ReopenConfirm` and
  // `OverClaimBand` already say `Unnamed trip` in their own sentences; these
  // labels used to say `—` in theirs, which made one nameless Trip two
  // different things inside one flow.
  const spokenName = tripNameOrUnnamed(trip)
  const participants = tripParticipants(state, trip)
  const dates = tripDateRange(trip)

  // Composed by `tripChip` rather than here, because the trip screen draws the
  // same control and the string has to read identically on both. The wall
  // clock is read at render — as often as anything on this card can change.
  const chip = tripChip(trip, Date.now())

  const next = phaseNext(trip)

  return (
    <article
      className={`${styles['card']} ${
        variant === 'active' ? styles['active'] : styles['planned']
      }`}
      data-testid={`trip-card-${trip.id}`}
      // What the dashed outline selects on, and what a test reads: "drafts are
      // dashed outlines — lists in progress, not commitments" is the board's
      // own reason, and it is a fact about the section, not about the styling.
      data-variant={variant}
    >
      {/* The card's one control, stretched over the whole of it and named for
          the Trip: a link list reading `Open`, `Open`, `Open` tells nothing
          apart, and the name is the only thing that does. The `›` below is
          what a sighted reader sees of it. */}
      <Link
        href={`/trips/${trip.id}`}
        className={styles['surface']}
        aria-label={`Open ${spokenName}`}
      />

      <div className={styles['head']}>
        <span className={styles['name']} data-testid="trip-name">
          {/* `▸` is the trip world against `⌂ HOME`'s (Foundations,
              principle 3), and it belongs to a Trip that is actually
              arranging gear. A Draft is not on one. */}
          {variant === 'active' ? '▸ ' : ''}
          {label}
        </span>

        {/* Active-card only: the Draft card's own trailing `›` moved into
            `BUILD LIST ›` below, and no board draws both together — a bare
            chevron beside a `BUILD LIST ›` link would be a second, redundant
            tap target for the same route. */}
        {variant === 'active' && (
          <span
            className={styles['chevron']}
            data-testid="trip-chevron"
            aria-hidden="true"
          >
            ›
          </span>
        )}

        <span className={styles['phaseLine']} data-testid="phase-line">
          <button
            type="button"
            className={styles['chip']}
            data-testid="phase-chip"
            aria-haspopup="dialog"
            onClick={onOpenPhase}
          >
            {chip}
          </button>
          {variant === 'planned' && (
            // The board's `DRAFT · N ENTRIES`, split so the chip's
            // accessible name is the phase and nothing else: the count is a
            // fact about the gear list, not about the control that moves a
            // Trip. `entryCountLabel` is the one function this noun is
            // spelled in (`GearListSection.tsx`), shared with the trip
            // screen's own `GEAR LIST` band and the builder's footer.
            <span className={styles['listed']}>
              {' '}
              · {entryCountLabel(entryCount)}
            </span>
          )}
        </span>
      </div>

      {(dates !== null || participants.length > 0) && (
        <div className={styles['meta']} data-testid="trip-meta">
          {dates !== null && (
            <span className={styles['dates']} data-testid="trip-dates">
              {dates.range}
              {dates.span !== null && ` · ${dates.span}`}
              {dates.warning !== null && (
                <>
                  {' · '}
                  {/* The glyph in its own element: the range beside it is
                      muted meta and only the mark is the warning, so a single
                      text node would force the attention class onto the whole
                      line or onto none of it. The trip screen draws the same
                      pair the same way. */}
                  <span className={styles['attention']}>▲</span> {dates.warning}
                </>
              )}
            </span>
          )}
          {participants.length > 0 && (
            // `PersonCluster` owns the `role="img"` over the whole cluster —
            // the initials are a single piece of information (who is on this
            // Trip) and read out one letter at a time they are as easily a
            // stray alphabet as a roster — and caps painted circles at four,
            // `+N` beyond that (ruling E, `docs/design/README.md` §5d E).
            <PersonCluster
              people={participants.map((person) => ({
                key: person.id,
                label:
                  person.label === UNNAMED_PERSON_GLYPH
                    ? undefined
                    : person.label.charAt(0).toUpperCase(),
              }))}
              size={22}
              label={`Participants: ${participants
                .map((person) => person.label)
                .join(', ')}`}
            />
          )}
        </div>
      )}

      {next !== null && (
        <p className={styles['next']} data-testid="trip-next">
          {next}
        </p>
      )}

      {variant === 'active' && progress !== undefined && (
        // **Below the NEXT line above, never in its place** — the order is
        // the board's own sentence, and this component's docstring says why
        // it is the thing most likely to be got backwards.
        //
        // Both conditions, and `entryCount`'s own pair one element up is the
        // precedent: the caller computes for one section and the card draws
        // for one variant. Neither leans on the other, so a future caller
        // handing a Draft a count still gets the drawn card the board draws.
        <div className={styles['progress']} data-testid="trip-progress">
          <div className={styles['counts']}>
            <span className={styles['packed']}>{packedLabel(progress)}</span>
            <span className={styles['left']}>{leftLabel(progress)}</span>
          </div>
          {/* `aria-hidden`, exactly as the packing view's own bar is: the
              line immediately above states the identical fact in words, and a
              `role="progressbar"` here would announce one number twice. */}
          <div className={styles['bar']} aria-hidden="true">
            <div
              className={styles['fill']}
              style={{ inlineSize: `${packedPercent(progress)}%` }}
            />
          </div>
        </div>
      )}

      {phaseOf(trip) === 'pack_out' && (
        // The card's fifth element, and the only CTA S9a draws — see the
        // docstring for why On trip's slot stays empty and why this asks the
        // phase rather than the variant. Raised above `.surface` and a
        // sibling of it, as `.chip` and `.buildList` are: a control nested
        // inside the stretched anchor is invalid HTML and one tap following
        // two links.
        <Link
          href={`/trips/${trip.id}/packing`}
          className={styles['cta']}
          data-testid="packing-cta"
          // Named for the Trip, `BUILD LIST ›`'s own rule: two active cards
          // are a legitimate state (`Trips.tsx` — nothing constrains
          // `active` to one), and a control list reading `Continue pack-out`
          // twice tells them apart by nothing. `Continue pack-out` stays a
          // substring, so voice control still finds it (WCAG 2.5.3), and the
          // name is `spokenName`'s prose because this is a sentence.
          aria-label={`Continue pack-out for ${spokenName}`}
        >
          Continue pack-out
        </Link>
      )}

      {variant === 'planned' && (
        // The accent mono link the board names `BUILD LIST ›`
        // (`docs/design/README.md` §5) — raised above `.surface` exactly as
        // the phase chip is, so a tap here lands on this link and not on the
        // whole-card `Open {label}` one underneath it. Its own control,
        // never the phase chip's or the surface's: three siblings, never
        // nested, for the reason above.
        <Link
          href={buildListHref}
          className={styles['buildList']}
          data-testid="build-list-link"
          aria-label={`Build list for ${spokenName}`}
        >
          BUILD LIST ›
        </Link>
      )}
    </article>
  )
}
