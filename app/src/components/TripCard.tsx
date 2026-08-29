import { phaseNext, tripLabel, type TripState } from '@foerier/shared'
import { Link } from 'wouter'

import { useDepot } from '../depot/store'
import { tripChip, tripDateRange, tripParticipants } from '../depot/trips'
import styles from './TripCard.module.css'

/**
 * **A Trip, as the Trips list draws it** — `Screens B` §02's active card and
 * its dashed draft card, which are one component with two variants rather
 * than two components: the anatomy is identical (name · phase chip · dates ·
 * Participants · next step · a way in), and what differs is which of those
 * facts a Trip in that section happens to hold.
 *
 * It lives in `app/src/components/` and not in `ui/`. `GearRow` earned its
 * place there by having two callers in two screens (`Depot` and `Find`); this
 * has one. It moves when S7 or S9 gives it a second — the same rule, applied
 * the same way rather than pre-empted (spec §4.1).
 *
 * ## The CTA names the destination that exists
 *
 * The board's active card reads `Continue pack-out` and its draft card
 * `BUILD LIST ›`. **Neither destination exists at this slice**: the gear list
 * builder and the packing view are later. The repo's rule — *an affordance
 * that leads nowhere is worse than a missing one*, stated when the `ACCOUNT`
 * row was held back until the Account screen existed — decides it, and the
 * board's copy would be worse than a missing affordance rather than better: it
 * does not lead nowhere, it leads somewhere and lies about it. So both read
 * `OPEN ›` and go to `/trips/:id`, which is real, and each becomes the board's
 * copy on the slice that builds the board's destination (spec §6.1).
 *
 * ## The progress line falls through to the next step
 *
 * The board draws `● 48/61 PIECES · 13 LEFT` and a bar on the **active** card.
 * There are no Entries and no Pieces yet, so the line has nothing to count and
 * a `0/0` bar would state a fact about a list nobody has built. In its place
 * that card draws `phaseNext`, which is what this slice actually owes: *the
 * phase control, moving both directions, with the next thing to do stated*. It
 * is a fact of the phase table, so it stays correct as later slices build the
 * things it names, and the progress line returns **above** it rather than
 * replacing it (spec §6.2).
 *
 * The dashed card draws no such line. It never had a progress line to replace,
 * spec §4.1 enumerates its three, and the board keeps it slight on purpose —
 * `NEXT — BUILD THE GEAR LIST` beneath `DRAFT · 0 GEAR LISTED` says the same
 * thing twice.
 *
 * ## `@container`, never a media query
 *
 * The card establishes its own inline-size container and folds against the
 * width it is handed — [frontend-design §3.2](../../../docs/frontend-design.md),
 * and the board says it in as many words: *"Same components as 393 —
 * `@container` picks the layout, not the viewport."* The same card is the
 * full-width one on a phone and one of two columns at Roomy, where it is
 * **narrower** than on the phone; nothing about its contents changes, so
 * nothing here is a media query.
 */
export interface TripCardProps {
  trip: TripState
  /**
   * Which section drew it — `tripSections`' own partition, never re-derived
   * here. `active` carries the `▸` glyph and the day count; `planned` is the
   * dashed outline and carries `0 GEAR LISTED`.
   */
  variant: 'active' | 'planned'
  /**
   * The chip asks; the screen mounts the SET PHASE sheet. `ui/`'s primitives
   * have no `open` prop — mounted is open — so the caller writes
   * `{open && <PhaseSheet …/>}` and mount is what resets the sheet's own
   * state. A card that owned the sheet would put five of them in a list of
   * five Trips.
   */
  onOpenPhase: () => void
}

export function TripCard({ trip, variant, onOpenPhase }: TripCardProps) {
  const state = useDepot((depot) => depot.state)

  const label = tripLabel(trip)
  const participants = tripParticipants(state, trip)
  const dates = tripDateRange(trip)

  // Composed by `tripChip` rather than here, because the trip screen draws the
  // same control and the string has to read identically on both. The wall
  // clock is read at render — as often as anything on this card can change.
  const chip = tripChip(trip, Date.now())

  // **The active card only.** Spec §4.1 enumerates the planned card's three
  // lines — name, `DRAFT · 0 GEAR LISTED`, `OPEN ›` — and the board keeps the
  // dashed card deliberately slight; `NEXT — BUILD THE GEAR LIST` would
  // restate `0 GEAR LISTED` as a fourth line on the one card meant to carry
  // fewest. §8.3's "the next thing to do stated" is satisfied on the active
  // card here and on the trip screen, which draws it for every phase.
  const next = variant === 'active' ? phaseNext(trip) : null

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
      <div className={styles['body']}>
        <div className={styles['head']}>
          <span className={styles['name']} data-testid="trip-name">
            {/* `▸` is the trip world against `⌂ HOME`'s (Foundations,
                principle 3), and it belongs to a Trip that is actually
                arranging gear. A Draft is not on one. */}
            {variant === 'active' ? '▸ ' : ''}
            {label}
          </span>

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
              // The board's `DRAFT · 0 GEAR LISTED`, split so the chip's
              // accessible name is the phase and nothing else: the count is a
              // fact about the gear list, not about the control that moves a
              // Trip. The `0` is true today and stays true until S7 gives it
              // something to count.
              <span className={styles['listed']}> · 0 GEAR LISTED</span>
            )}
          </span>
        </div>

        {(dates !== null || participants.length > 0) && (
          <div className={styles['meta']} data-testid="trip-meta">
            {dates !== null && (
              <span className={styles['dates']} data-testid="trip-dates">
                {dates}
              </span>
            )}
            {participants.length > 0 && (
              // One `role="img"` over the whole cluster rather than a label on
              // each circle: the initials are a single piece of information —
              // who is on this Trip — and read out one letter at a time they
              // are as easily a stray alphabet as a roster. The circles
              // themselves stay `aria-hidden`, which is the People screen's
              // treatment and `AccountAvatar`'s before it.
              <span
                className={styles['circles']}
                role="img"
                aria-label={`Participants: ${participants
                  .map((person) => person.label)
                  .join(', ')}`}
              >
                {participants.map((person) => (
                  <span
                    key={person.id}
                    className={styles['circle']}
                    aria-hidden="true"
                  >
                    {/* A Person with no folded name draws an **empty** circle
                        rather than a placeholder letter — inventing one would
                        be a fact the app does not have. */}
                    {person.label === '—'
                      ? ''
                      : person.label.charAt(0).toUpperCase()}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {next !== null && (
          // `null` three ways over, all drawing the same: the dashed card
          // states no next step at all, a closed Trip has nothing next, and a
          // phase this build has never heard of states none because there is
          // no row to state one. The chip above still draws the raw value;
          // only this line goes away.
          <p className={styles['next']} data-testid="trip-next">
            {next}
          </p>
        )}
      </div>

      <Link
        href={`/trips/${trip.id}`}
        className={`${styles['cta']} ${
          variant === 'active' ? styles['ctaActive'] : styles['ctaPlanned']
        }`}
        // A list of cards whose links are all named `OPEN` is unnavigable by
        // link list, and the Trip's name is the only thing that tells them
        // apart. The visible copy stays the board's register — terse, mono,
        // with the chevron.
        aria-label={`Open ${label}`}
      >
        OPEN ›
      </Link>
    </article>
  )
}
