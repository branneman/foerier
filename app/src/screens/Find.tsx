import {
  containmentView,
  findGear,
  kindOf,
  ownedCountOf,
  rowWhereabouts,
  statusLabel,
  whereabouts,
  whereaboutsByPerson,
  whereaboutsText,
  type ContainmentView,
  type HouseholdState,
  type Match,
  type PathSegment,
  type PersonWhereabouts,
  type Unaccounted,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { GearRow, Logo, PersonCircle } from '@foerier/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'

import {
  personInitial,
  sortedPeople,
  type PersonRow,
} from '../household/people'
import { useHousehold } from '../household/store'
import { DESKTOP, useMediaQuery } from '../shell/useMediaQuery'
import styles from './Find.module.css'

/**
 * Find — story 3, "I find things fast instead of searching through bags"
 * (`docs/design/README.md` §6). **Answer-first**: a result's whereabouts is
 * the payload, not a reason to tap through. Search runs entirely over
 * `findGear`/`whereabouts` (`@foerier/shared`), both pure folds of local
 * state — there is nothing here for the network to be in the way of, which
 * is why nothing on this screen reads the sync status.
 *
 * **S9b makes every row state the trip world** (`docs/design/README.md`
 * §5f D6/D7/D9, spec §4.3). `PlainRow`'s whereabouts slot now reads
 * {@link rowWhereabouts} — the same call `Depot.tsx`'s row makes, so the two
 * cannot drift — while its meta keeps the home path, unchanged whether the
 * gear is out or not (D9). `CountedCard`'s rows already mapped over every
 * `whereabouts` slice; they draw real trip slices now instead of the sole
 * `home` one S2b shipped. `PerPersonCard` is new — the work S8 held back
 * (`docs/design/README.md` §5d I) — and draws one row per **Participant of
 * the claiming Trip(s)** (D6), a removed Piece reading home with no mention
 * of the removal (B5), mounted only while at least one Piece is actually
 * out. Each row's trailing slot states that Piece's own packing status
 * (`PACKED`/`STAGED`/`NOT PACKED`, via `shared`'s `pieceStatusOf`/
 * `statusLabel` — S9a's own facts, not S10's) or `⌂ HOME`. A Piece two Trips
 * both claim takes the unaccounted row's own anatomy instead, `▲ CLAIMED BY
 * N TRIPS` + `RESOLVE` — and unlike gear detail's `PIECES` chip, which is a
 * span, this **is** a link (D7), routing to the first claiming Trip by name
 * A→Z.
 *
 * **S10 (F16(2)) adds the unaccounted standing's own row read.** A
 * Participant whose own Piece is named in the Gear's {@link Unaccounted}
 * standing (`whereabouts.ts`'s `unaccountedOf`) reads `▲ LAST SEEN: <trip>`
 * with its own `RESOLVE`, routing to **gear detail** rather than the Trip —
 * a closed Trip settles nothing, and the settle route lives on the card's
 * footer (F16(1)). It sits between the contested arm and the packing-status
 * arm, and — R33's fix — **yields to a live claim of the Person's own**:
 * `unaccountedOf` walks every visible Trip, closed included, independently
 * of the active-Trips-only claim walk `whereaboutsByPerson` reads, so the
 * same Person can be named by a closed Trip's standing *and* hold an open
 * Piece on a different, active Trip at the same time — re-adding a Gear
 * that was once lost is an ordinary workflow, not an edge case. Domain §4's
 * order is universal (active Entry · unaccounted · home), and `rowWhereabouts`
 * — imported into this very file — already checks for a live trip slice
 * before the standing; this arm now checks the identical thing
 * (`answer.slice.kind !== 'trip'`) before it, rather than only checking
 * `contested === null`, which answers a *different* question (two
 * simultaneous claims, not any claim at all).
 */

const RECENT_LIMIT = 5

/** `4 MATCHES · ON-DEVICE INDEX` / `1 MATCH · ON-DEVICE INDEX` — the count
 * line search works to a query with. Present only while one is typed; there
 * is no "N GEAR" resting state here, unlike the Depot list search shares its
 * pattern with — Find has nothing to say before it is asked something. */
function matchLine(count: number): string {
  const noun = count === 1 ? 'MATCH' : 'MATCHES'
  return `${count} ${noun} · ON-DEVICE INDEX`
}

function pathText(path: readonly PathSegment[]): string {
  return path.map((segment) => segment.name).join(' ▸ ')
}

/** `⌂ LOOSE` for a slice with no containing path, else `⌂ <path>` — the
 * whereabouts line, mono 11, muted for home (`docs/design/README.md` §6).
 * `LOOSE` is the ubiquitous-language term for gear with no residence
 * (`docs/ubiquitous-language.md`) and matches `WhereaboutsCard.pathText` and
 * `GearDetail.chipLocation`'s fallback for the identical condition. */
function sliceText(slice: WhereaboutsSlice): string {
  return whereaboutsText(slice, 'full')
}

/** `home` or `trip` — the two-worlds colour a slice's own text carries
 * (`docs/design/README.md` §6: amber for trip, muted for home). The glyph
 * already names the world; this only reinforces it, same as
 * `ui/GearRow.module.css`'s identical two classes. */
function sliceTone(slice: WhereaboutsSlice): 'home' | 'trip' {
  return slice.kind === 'home' ? 'home' : 'trip'
}

/**
 * The answer-first card for counted gear: a header naming the gear and its
 * owned count, then one row per {@link whereabouts} slice. S2b's
 * `whereabouts` always answers with exactly one `home` slice, so this card
 * shows one row today — the shape is what carries forward once story 11's
 * quantity split gives counted gear a second slice to add here.
 *
 * `view` is hoisted once for the whole screen (the way `Depot.tsx` hoists
 * its own) and handed in, rather than left to `whereabouts`' default
 * parameter — which would build a fresh `containmentView`, an O(n log n)
 * sort over the whole depot, once per counted match, on every keystroke.
 */
function CountedCard({
  state,
  match,
  view,
}: {
  state: HouseholdState
  match: Match
  view: ContainmentView
}) {
  const name = match.gear.name?.value ?? ''
  const result = whereabouts(state, match.gear.id, view)
  // The header states the owned count, not the sum of the slices: D8 floors
  // the home slice at zero while a trip slice keeps its honest count, so an
  // over-claimed gear's slices sum to more than `owned` the moment `out >
  // owned` (`whereabouts`'s own docstring). `ownedCountOf` is the one
  // function that answers this for Counted gear — the review's blocker 1
  // caught the sum standing in for it here.
  const count = ownedCountOf(match.gear) ?? 0
  const metaId = `find-card-meta-${match.gear.id}`
  const sliceIds = result.slices.map(
    (slice) =>
      `find-card-slice-${match.gear.id}-${slice.kind}${
        slice.kind === 'trip' ? `-${slice.tripId}` : ''
      }`,
  )

  return (
    <Link
      href={`/gear/${match.gear.id}`}
      className={styles['card']}
      aria-label={name}
      aria-describedby={[metaId, ...sliceIds].join(' ')}
    >
      <span className={styles['cardHeader']}>
        <span className={styles['name']}>{name}</span>
        <span id={metaId} className={styles['cardMeta']}>
          COUNTED · ×{count}
        </span>
      </span>
      <span className={styles['sliceList']}>
        {result.slices.map((slice, index) => (
          <span key={sliceIds[index]} className={styles['sliceRow']}>
            <span
              id={sliceIds[index]}
              className={`${styles['sliceWhereabouts']} ${styles[sliceTone(slice)]}`}
            >
              {sliceText(slice)}
            </span>
          </span>
        ))}
      </span>
    </Link>
  )
}

/**
 * The standard 2-line row for a plain match — **the same `GearRow` the Depot
 * list uses**, with the meta slot swapped to the `⌂` path.
 *
 * "Answer-first is a meta-slot choice, not a new component" (Components §03).
 * Until S3 this screen carried its own copy of the Depot's row JSX, and
 * `Find.module.css` and `Depot.module.css` shared nine byte-identical blocks
 * — the duplication [architecture §12.4](../../../docs/architecture-design.md)
 * named as the reason to extract at this slice.
 *
 * **D9: the whereabouts slot takes `rowWhereabouts`**, the same call
 * `Depot.tsx`'s row makes, so the two rows cannot drift; the meta slot keeps
 * `match.path` — the **home** path `findGear` already resolved, unchanged
 * whether the gear is out or not.
 */
function PlainRow({
  state,
  match,
  view,
}: {
  state: HouseholdState
  match: Match
  view: ContainmentView
}) {
  const text = pathText(match.path)
  const { text: whereaboutsLabel, tone } = rowWhereabouts(
    whereabouts(state, match.gear.id, view),
  )
  return (
    <Link href={`/gear/${match.gear.id}`} asChild>
      <GearRow
        name={match.gear.name?.value ?? ''}
        href={`/gear/${match.gear.id}`}
        whereabouts={whereaboutsLabel}
        tone={tone}
        {...(text === '' ? {} : { path: `⌂ ${text}` })}
      />
    </Link>
  )
}

/**
 * One Participant's own row inside {@link PerPersonCard} (D6): a 28px
 * circle, that Person's whereabouts at full density, and a trailing slot
 * that is — in order — `RESOLVE` for a contested Piece (D7), `RESOLVE` for
 * the unaccounted standing (S10, F16(2)), that Piece's own packing status,
 * or `⌂ HOME`.
 *
 * **The trailing slot never re-derives anything `whereaboutsByPerson`
 * already resolved.** `status` came off the identical per-Piece walk that
 * built `slice`'s own residence (`shared/src/selectors/whereabouts.ts`'s own
 * risk statement: two surfaces disagreeing, applied to two *slots on one
 * row* this time) — it is `null` exactly when `slice` is the home answer, so
 * `status !== null` is what decides `PACKED`/`STAGED`/`NOT PACKED` versus
 * `⌂ HOME`, never a second look at `slice.kind`. A Piece two Trips both
 * claim takes the unaccounted row's own anatomy instead, `▲ CLAIMED BY N
 * TRIPS` plus a `RESOLVE` link (D7), which wins over the status slot.
 * **Unlike gear detail's `PIECES` chip, which is a span** because "a chip is
 * not a door", this row's `RESOLVE` really is one: the row *is* the surface
 * naming the conflict here, not chrome riding a card that already links
 * elsewhere.
 *
 * `contested` reads `answer.slice` for its destination rather than looking
 * it up a second way: `whereaboutsByPerson`'s own contract is that the
 * first claiming Trip by name A→Z is both the slice a contested Participant
 * reads *and* `contestedTripIds[0]` — one fact, not two to keep in sync.
 *
 * **S10: the middle arm reads the Gear's own {@link Unaccounted} standing,
 * never a per-Piece re-derivation of it.** `unaccountedOf` (`unpack.ts`) is
 * a whole-Gear fold — one Trip name and one accumulated `personIds` set per
 * Gear, gathered by `whereabouts.ts`'s `TRIP_SLICES` memo alongside
 * `overClaims` — so this row asks *"is this Person named in it, and do they
 * hold no live claim of their own"* (`unaccounted.personIds.includes(
 * person.id)` **and** `answer.slice.kind !== 'trip'`) rather than walking
 * the Trip's Entries a second time.
 *
 * **R33: the second half of that test is load-bearing, not defensive.**
 * `unaccountedOf` walks every *visible* Trip, closed included; the claim
 * `whereaboutsByPerson`'s own residence walk reads is *active*-Trips-only —
 * two independent walks over two different sets of Trips, so a Person can be
 * named by a closed Trip's standing while holding an open, unresolved Piece
 * on a *different* active Trip at the same moment (the ordinary workflow of
 * re-adding a once-lost Gear to a new Trip). Domain §4's precedence is
 * universal — active Entry · unaccounted · home — and `rowWhereabouts`
 * (imported into this very file for `PlainRow`) already checks for a live
 * trip slice before the standing; this arm now does the identical check
 * (`answer.slice.kind !== 'trip'`) rather than only `contested === null`,
 * which answers a narrower question (two *simultaneous* claims) and stays
 * true even while a single live claim is masking the standing.
 *
 * **`RESOLVE` here routes to gear detail (`/gear/<id>`), never the Trip**
 * (F16(1)/(2)): the Trip that lost a Piece is typically closed, where
 * nothing can be settled, while gear detail's card footer opens the Home
 * picker that actually clears the standing. Two `▲`s, two doors, two
 * settlers — the identical shape D7's contested arm already draws, to a
 * different destination for a different reason.
 */
function contestedInfo(
  answer: PersonWhereabouts,
): { tripId: string; tripName: string; count: number } | null {
  if (answer.contestedTripIds.length < 2 || answer.slice.kind !== 'trip') {
    return null
  }
  return {
    tripId: answer.slice.tripId,
    tripName: answer.slice.tripName,
    count: answer.contestedTripIds.length,
  }
}

function PersonPieceRow({
  person,
  answer,
  gearId,
  unaccounted,
}: {
  person: PersonRow
  answer: PersonWhereabouts
  gearId: string
  unaccounted: Unaccounted | null
}) {
  const contested = contestedInfo(answer)
  // R33: a live claim of the Person's own wins, even when it is on a
  // *different* Trip than the one the standing names — `unaccountedOf`'s
  // closed-Trips-included walk and this row's active-Trips-only claim are
  // independent, so `contested === null` alone (only two claims at once)
  // is not enough; `answer.slice.kind !== 'trip'` is `rowWhereabouts`'s own
  // "no live trip slice" check, restated for one Person's row.
  const lost =
    contested === null &&
    answer.slice.kind !== 'trip' &&
    unaccounted !== null &&
    unaccounted.personIds.includes(person.id)
      ? unaccounted
      : null
  return (
    <div className={styles['personRow']} data-testid="find-person-row">
      <span className={styles['personMain']}>
        <PersonCircle label={personInitial(person.label)} size={28} />
        <span
          className={`${styles['sliceWhereabouts']} ${
            contested || lost
              ? styles['attention']
              : styles[sliceTone(answer.slice)]
          }`}
        >
          {contested
            ? `▲ CLAIMED BY ${contested.count} TRIPS`
            : lost
              ? `▲ LAST SEEN: ${lost.tripName}`
              : whereaboutsText(answer.slice, 'full')}
        </span>
      </span>
      {contested ? (
        <Link
          href={`/trips/${contested.tripId}`}
          className={styles['resolve']}
          aria-label={`Resolve on ${contested.tripName}`}
        >
          RESOLVE
        </Link>
      ) : lost ? (
        <Link
          href={`/gear/${gearId}`}
          className={styles['resolve']}
          aria-label={`Resolve ${person.label}`}
        >
          RESOLVE
        </Link>
      ) : (
        <span className={styles['statusChip']} data-testid="find-person-status">
          {answer.status !== null ? statusLabel(answer.status) : '⌂ HOME'}
        </span>
      )}
    </div>
  )
}

/** `whereaboutsByPerson`'s answer, this screen's People-screen-ordered
 * roster, and its own gate — "at least one Piece is actually on an active
 * Trip" — gathered once so the caller can choose {@link PerPersonCard} or
 * {@link PlainRow} **before** rendering either, rather than mounting a card
 * component that might render nothing.
 *
 * `anyOut` is *not* `people.length > 0`: `whereaboutsByPerson`'s map is
 * keyed by Participants whether or not their own Piece is included (B5), so
 * an Entry whose every Piece has been removed still populates it, every
 * answer reading home — the identical-circles fault §4/D6/B3 exist to
 * prevent, drawn once more on this surface.
 *
 * **S10: `unaccounted` is read here too, once, off {@link whereabouts} —
 * the same whole-Gear standing `PlainRow` and `CountedCard` already read for
 * this exact Gear — rather than left for each {@link PersonPieceRow} to look
 * up on its own.** `whereabouts` and `whereaboutsByPerson` both read
 * `whereabouts.ts`'s `TRIP_SLICES` memo, so this is a map lookup on an
 * already-folded pass, never a second scan.
 */
function piecePeopleFor(
  state: HouseholdState,
  gearId: string,
  view: ContainmentView,
): {
  people: readonly PersonRow[]
  answers: ReadonlyMap<string, PersonWhereabouts>
  anyOut: boolean
  unaccounted: Unaccounted | null
} {
  const answers = whereaboutsByPerson(state, gearId, view)
  const people = sortedPeople(state).filter((person) => answers.has(person.id))
  const anyOut = [...answers.values()].some(
    (answer) => answer.slice.kind === 'trip',
  )
  const unaccounted = whereabouts(state, gearId, view).unaccounted
  return { people, answers, anyOut, unaccounted }
}

/**
 * The answer-first card for per-person gear — the work S8 held back
 * (`docs/design/README.md` §5d I): a header naming the gear and the size of
 * its per-person breakdown, then one {@link PersonPieceRow} per
 * **Participant of the claiming Trip(s)** (D6), People-screen order.
 *
 * The caller mounts this only once {@link piecePeopleFor}'s own `anyOut`
 * gate has passed; per-person gear with nothing out keeps falling through
 * to {@link PlainRow} instead.
 */
function PerPersonCard({
  gearId,
  name,
  people,
  answers,
  unaccounted,
}: {
  gearId: string
  name: string
  people: readonly PersonRow[]
  answers: ReadonlyMap<string, PersonWhereabouts>
  unaccounted: Unaccounted | null
}) {
  return (
    <div className={styles['card']} data-testid="find-per-person-card">
      <Link
        href={`/gear/${gearId}`}
        className={styles['cardHeader']}
        aria-label={name}
      >
        <span className={styles['name']}>{name}</span>
        <span className={styles['cardMeta']}>
          PER-PERSON · ×{people.length}
        </span>
      </Link>
      <div className={styles['sliceList']}>
        {people.map((person) => {
          const answer = answers.get(person.id)
          if (answer === undefined) return null
          return (
            <PersonPieceRow
              key={person.id}
              person={person}
              answer={answer}
              gearId={gearId}
              unaccounted={unaccounted}
            />
          )
        })}
      </div>
    </div>
  )
}

export function Find() {
  const state = useHousehold((depot) => depot.state)
  const isDesktop = useMediaQuery(DESKTOP)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const previousQuery = useRef('')

  const trimmed = query.trim()
  const matches = useMemo(() => findGear(state, trimmed), [state, trimmed])
  const view = useMemo(() => containmentView(state), [state])

  // Recent searches are a per-viewer convenience, not a fact about the
  // household — nothing here is an op, so nothing here is folded, synced, or
  // even durable: it is React state, gone on reload, same as any other
  // scratch UI field. A query joins the list the moment it is cleared, which
  // reads as "the search that was just finished" without needing a submit
  // button this live-filtering field never had.
  useEffect(() => {
    if (trimmed === '' && previousQuery.current !== '') {
      const finished = previousQuery.current
      setRecent((current) =>
        [
          finished,
          ...current.filter(
            (entry) => entry.toLowerCase() !== finished.toLowerCase(),
          ),
        ].slice(0, RECENT_LIMIT),
      )
    }
    previousQuery.current = trimmed
  }, [trimmed])

  return (
    <div className={styles['screen']}>
      {/* The phone shell's logo header, withheld at Desktop exactly as Depot
          withholds it: the sidebar there already carries the logo. */}
      {!isDesktop && (
        <header className={styles['header']}>
          <Logo size={28} title="foerier" />
        </header>
      )}

      <h1 className={styles['title']}>Find</h1>

      <input
        type="search"
        className={styles['search']}
        aria-label="Search gear"
        placeholder="Search gear"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {trimmed !== '' && (
        <p className={styles['countLine']}>{matchLine(matches.length)}</p>
      )}

      {trimmed !== '' && matches.length === 0 && (
        <p className={styles['empty']}>No matches.</p>
      )}

      {trimmed !== '' && matches.length > 0 && (
        <ul className={styles['list']}>
          {matches.map((match) => {
            const kind = kindOf(match.gear)
            const gearId = match.gear.id
            const pieces =
              kind === 'per_person' ? piecePeopleFor(state, gearId, view) : null
            return (
              <li key={gearId}>
                {kind === 'counted' ? (
                  <CountedCard state={state} match={match} view={view} />
                ) : pieces !== null && pieces.anyOut ? (
                  <PerPersonCard
                    gearId={gearId}
                    name={match.gear.name?.value ?? ''}
                    people={pieces.people}
                    answers={pieces.answers}
                    unaccounted={pieces.unaccounted}
                  />
                ) : (
                  <PlainRow state={state} match={match} view={view} />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {trimmed === '' && recent.length > 0 && (
        <div className={styles['recent']}>
          <span className={styles['recentLabel']}>RECENT</span>
          <ul className={styles['recentList']}>
            {recent.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  className={styles['recentRow']}
                  onClick={() => setQuery(entry)}
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
