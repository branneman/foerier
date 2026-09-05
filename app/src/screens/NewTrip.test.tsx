import { personRecorded, personRenamed, type OpSpec } from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anAuthor, noopEngine } from '../testUtils'
import { NewTrip } from './NewTrip'
import styles from './NewTrip.module.css'

/**
 * **F3 step 1** — `Trips → + NEW → name · dates · participants`, then the trip
 * screen.
 *
 * Every test drives a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createHouseholdStore` — and reads the log back, as `AddGear.test.tsx`
 * does. Reading the *log* rather than the fold is the point here and not a
 * habit: the fold cannot tell one op from three, and the single most important
 * property of this screen is that a Trip with a name and nothing else costs
 * **one** op. A `trip.dates_set` carrying two clears would fold to exactly the
 * same state and still be the waste spec §4.2 forbids — it moves a stamp, and
 * at this slice a moved stamp is visible, because `phaseDay` reads one.
 */

type OpPayload = Record<string, unknown>

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: OpPayload }[]>
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  return {
    store,
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

function renderNewTrip({ store }: Seeded) {
  const location = memoryLocation({ path: '/trips/new', record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/new">
          <HouseholdProvider value={store}>
            <NewTrip />
          </HouseholdProvider>
        </Route>
        <Route path="/trips/:id">
          {(params) => <p>Trip {params['id']}</p>}
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

/** The one Trip a store holds after a create, and its id. */
function soleTrip(store: StoreApi<HouseholdStoreState>): string {
  const tripIds = Object.keys(store.getState().state.trips)
  expect(tripIds).toHaveLength(1)
  const id = tripIds[0]
  if (id === undefined) throw new Error('unreachable: length checked above')
  return id
}

describe('New trip — the band above the title', () => {
  /**
   * `useScreenHeader`'s rule, on a screen that answers `splitPane: false` —
   * `/trips/new` has no two-pane view at any width. The back link is the only
   * other way out of a half-typed Trip below Desktop; at Desktop the 216px
   * sidebar's `TRIPS` row *is* where it points, so it goes. The sync line is
   * drawn at Split alone, the one mode where `AppShell`'s marker is a bare
   * rail dot with no words beside it.
   */
  it('draws the back link and no sync line below Split', async () => {
    renderNewTrip(await seeded())

    // `AppShell`'s own header band already states it, in words, at this width.
    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toBeVisible()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('draws both at Split, where the rail has neither a label nor a word', async () => {
    setViewport(SPLIT)
    renderNewTrip(await seeded())

    // The rail draws no labels, so the link is still the only thing naming
    // where the reader came from — and its sync marker is a bare 6px dot, so
    // this band is the only legible statement of the state.
    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toBeVisible()
    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws neither at Desktop, where the sidebar is the navigation', async () => {
    setViewport(SPLIT, DESKTOP)
    renderNewTrip(await seeded())

    expect(screen.queryByRole('link', { name: '‹ TRIPS' })).toBeNull()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })
})

describe('New trip — the create', () => {
  it('holds the primary until a name is typed', async () => {
    const user = userEvent.setup()
    renderNewTrip(await seeded())

    expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    expect(
      screen.getByRole('button', { name: 'Create trip' }),
    ).not.toBeDisabled()
  })

  /**
   * **The assertion this screen exists to satisfy.** A Trip with a name and
   * nothing else is one `trip.created`, full stop: no `trip.dates_set`
   * carrying `{start: null, end: null}`, and no participant ops.
   */
  it('emits exactly one op for a Trip with a name and nothing else', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.type).toBe('trip.created')
    expect(ops[0]?.payload).toEqual({ name: 'Alps 2026' })
  })

  it('trims the name it writes, and never writes a blank one', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.type(field, '   ')
    expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled()

    await user.type(field, 'Vosges  ')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect((await seed.authored())[0]?.payload).toEqual({ name: 'Vosges' })
  })

  it('carries only the date that was entered', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops.map((op) => op.type)).toEqual(['trip.created', 'trip.dates_set'])
    // One key, not two: an end date nobody entered is a register nothing has
    // ever written, and a clear over it is a needless op.
    expect(ops[1]?.payload).toEqual({ start: '2026-08-14' })
  })

  it('carries both dates when both were entered', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.type(screen.getByLabelText('End'), '2026-09-02')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops[1]?.payload).toEqual({ start: '2026-08-14', end: '2026-09-02' })
  })

  it('adds one op per chosen Participant, and none for one unchosen again', async () => {
    const seed = await seeded(
      personRecorded('els', 'Els'),
      personRecorded('mies', 'Mies'),
      personRecorded('kees', 'Kees'),
    )
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: /^Participants/ }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: /Mies/ }))
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    // Off again before the Trip exists: the picker holds draft state here, so
    // this costs nothing at all rather than an add and a remove.
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    const added = ops.filter((op) => op.type === 'trip.participant_added')
    expect(added).toHaveLength(2)
    expect(added.map((op) => op.payload['person_id']).sort()).toEqual([
      'els',
      'mies',
    ])
    expect(ops.some((op) => op.type === 'trip.participant_removed')).toBe(false)
  })

  /**
   * A Person recorded from inside the picker is on the row **at once**, which
   * is `peopleOn`'s doing rather than this screen's: `emit` folds on the
   * store's queue, so for a tick that Person is in the selection and not yet
   * in `sortedPeople`. A row that filtered the roster would drop the Person it
   * had just been told to add.
   */
  it('lists a Person recorded from inside the picker', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.click(screen.getByRole('button', { name: /^Participants/ }))
    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New person name' }),
      'Kees',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // The circle is one letter, so the roster lives in the row's accessible
    // name: initials read out one at a time are as easily a stray alphabet as
    // a list of People (`TripCard`'s argument, one screen along).
    expect(
      screen.getByRole('button', { name: 'Participants: Kees' }),
    ).toBeVisible()
  })

  it('draws the chosen Participants as circles, and names them in full', async () => {
    const seed = await seeded(
      personRecorded('els', 'Els'),
      personRecorded('mies', 'Mies'),
    )
    const user = userEvent.setup()
    renderNewTrip(seed)

    // `None`, not an empty slot: a Trip with nobody on it is a state the
    // ledger states rather than leaves blank.
    expect(
      screen.getByRole('button', { name: 'Participants: None' }),
    ).toHaveTextContent('None')

    await user.click(screen.getByRole('button', { name: /^Participants/ }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: /Mies/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // Circles, as the board draws them — the trip card's own display idiom,
    // and deliberately not the trip screen's dashed `+` ghost: this row is
    // Add gear's bordered `HOME`/`OWNER` control, on Add gear's shape of
    // screen.
    const row = screen.getByRole('button', { name: 'Participants: Els, Mies' })
    expect(row).toHaveTextContent('E')
    expect(row).toHaveTextContent('M')
    expect(row).not.toHaveTextContent('Els')
  })

  it('draws the group label and hides it from the accessibility tree', async () => {
    renderNewTrip(await seeded())

    // The button below it already carries `Participants: …` as its accessible
    // name, so an announced label makes it "Participants", then "Participants:
    // None, button" — two announcements for one control. `Trip.tsx` hides the
    // same word for the same reason.
    expect(screen.getByText('Participants')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Participants: None' }),
    ).toBeVisible()
  })

  it('draws a Person with no folded name as an empty circle', async () => {
    const user = userEvent.setup()
    // A Person whose name the fold holds as **cleared** — `person.renamed`
    // accepts an explicit `null` and the reader folds it, so a peer clearing
    // a name is an ordinary arrival rather than a broken op. `personLabel`
    // reads that as `UNNAMED_PERSON_GLYPH`, which is the branch this asserts.
    //
    // It is stated this way rather than through the picker's own
    // `+ NEW PERSON` — the other route to a label-less Person, an id in the
    // selection before the fold has caught up — because `emit` folds on the
    // store's queue and the queue has drained long before an assertion can
    // read the DOM. That path is covered where it can be held still, in
    // `depot/trips.test.ts`'s `peopleOn` cases.
    const seed = await seeded(
      personRecorded('kees', 'Kees'),
      personRenamed('kees', null),
    )
    renderNewTrip(seed)

    await user.click(screen.getByRole('button', { name: /^Participants/ }))
    await user.click(screen.getByRole('button', { name: /—/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // The circle is empty, not an em dash and not a placeholder letter:
    // inventing one would be a fact the app does not have. The row still
    // names them, because a Participant must never silently vanish.
    const row = screen.getByRole('button', { name: 'Participants: —' })
    expect(row).toBeVisible()
    // `PersonCircle`'s own `data-testid`, not `'span span'`: the ruling-E
    // fold nested one more `<span>` between this row and the circle (the
    // `aria-hidden` wrapper now holds `PersonCluster`'s own `role="img"`
    // span, and `PersonCircle` sits a level under that), so a structural
    // selector would silently start matching the wrong ancestor instead of
    // the circle itself.
    const circle = within(row).getByTestId('person-circle')
    expect(circle.textContent).toBe('')
  })

  /**
   * The whole burst, in the order the ledger line is written. The pairwise
   * tests above pin each op's payload; this one pins that all three go out
   * together and in that order — `trip.created` first, because the two after
   * it address a Trip it is what creates.
   */
  it('writes the three ops in order for a Trip carrying everything', async () => {
    const seed = await seeded(personRecorded('els', 'Els'))
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.click(screen.getByRole('button', { name: /^Participants/ }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.created', payload: { name: 'Alps 2026' } },
      { type: 'trip.dates_set', payload: { start: '2026-08-14' } },
      { type: 'trip.participant_added', payload: { person_id: 'els' } },
    ])
  })

  it('lands on the new Trip, which is where F3 points', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    await seed.store.getState().drained()

    expect(
      await screen.findByText(`Trip ${soleTrip(seed.store)}`),
    ).toBeInTheDocument()
  })

  it('states that the name is the only requirement, in two places', async () => {
    renderNewTrip(await seeded())

    // The board's footnote, and the gate above it are the same fact said
    // twice on purpose: the CTA is disabled and the label never changes, so
    // the line under it is the only thing that says what is missing.
    expect(
      screen.getByText('NAME IS THE ONLY REQUIRED INPUT'),
    ).toBeInTheDocument()
    // The other half of the same fact: the dates say so on their own group,
    // where the eye is when it wonders.
    expect(
      screen.getByRole('group', { name: 'Dates · optional' }),
    ).toBeInTheDocument()
  })

  it('creates on return at desk widths', async () => {
    setViewport(SPLIT, DESKTOP)
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Alps 2026{Enter}',
    )

    expect((await seed.authored()).map((op) => op.type)).toEqual([
      'trip.created',
    ])
  })

  it('leaves the return key to the field on a phone', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Alps 2026{Enter}',
    )

    // Add gear's return-to-record is a batch loop at a desk; this screen is
    // reached once per Trip and the CTA sits in the thumb zone, so on a phone
    // the key belongs to the field the OS keyboard is over. Nothing was
    // written, and the screen is still here to write it.
    expect(await seed.authored()).toEqual([])
    expect(
      screen.getByRole('button', { name: 'Create trip' }),
    ).not.toBeDisabled()
  })

  it('offers a way back to the Trips list', async () => {
    renderNewTrip(await seeded())

    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toHaveAttribute(
      'href',
      '/trips',
    )
  })
})

describe('New trip — the fact line under the CTA', () => {
  /**
   * `docs/design/README.md` §5, settled: **the fact line follows its CTA
   * block.** The board draws the CTA two ways — full-width and pinned to the
   * thumb zone below Split, an inline 40px button in a pane from Split up —
   * and gives the line the alignment of whichever one it sits under. This
   * screen has only the first treatment, at every width `/trips/new` renders,
   * so the line centres unconditionally and no width gate enters the
   * stylesheet.
   *
   * jsdom computes no cascade, so the rules are asserted where they are
   * written (`Trip.test.tsx`'s shape); the DOM test below is what ties them to
   * the element that carries them.
   */
  function css(): string {
    return readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'NewTrip.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('centres the line, under a primary that is full-width and parked at the foot', () => {
    expect(css()).toMatch(/\.ctaFact\s*\{[^}]*text-align:\s*center/)

    // The premise the centring rests on, and the reason it is not merely a
    // taste: the line centres under a *block* that spans the measure, not
    // beside a button that does not.
    expect(css()).toMatch(/\.primary\s*\{[^}]*width:\s*100%/)
    expect(css()).toMatch(/\.primary\s*\{[^}]*margin-top:\s*auto/)
  })

  it('gates the alignment on no width at all', () => {
    // The board changes the alignment exactly where it changes the CTA — the
    // Split boundary, 52em — and this screen has no Split treatment to ride.
    // The one media query in the file is the Roomy 40em measure cap, which
    // moves no CTA. A second query here would be a width rule about text,
    // which is what the board's answer refuses.
    expect(css().match(/@media[^{]*/g)).toEqual(['@media (min-width: 40em) '])
  })

  it('carries the alignment on the line itself, over the shared mono treatment', async () => {
    renderNewTrip(await seeded())

    const fact = screen.getByText('NAME IS THE ONLY REQUIRED INPUT')
    const classes = fact.className.split(' ').filter((name) => name !== '')

    // The mono ledger treatment, then the alignment this one takes from its
    // CTA — named, so a swap or a dropped `.fact` fails here rather than
    // passing a count.
    //
    // `AddGear.test.tsx`'s sibling states the same fact by comparing this
    // line against a field-level one; this screen has no field-level fact
    // line to compare against, so it reads the mapping the bundler produced
    // instead. Never a literal either way: the module's own names are
    // generated.
    expect(classes).toEqual([styles['fact'], styles['ctaFact']])
  })
})
