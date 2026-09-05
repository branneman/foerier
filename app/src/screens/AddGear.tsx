import {
  gearRecorded,
  personLabel,
  systemIdSource,
  type KindValue,
  type Owner,
  type Residence,
} from '@foerier/shared'
import { SegmentedControl } from '@foerier/ui'
import { useRef, useState } from 'react'
import { useLocation } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { OwnerPicker } from '../components/OwnerPicker'
import { KIND_OPTIONS, TRAIT_OPTIONS } from '../depot/gear'
import { useDepot } from '../depot/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './AddGear.module.css'

/**
 * **F1 — the first screen a Quartermaster records something on**, redrawn
 * round 2 (`docs/design/README.md` §3b, Screens A §06).
 *
 * **A screen, not a sheet** — confirmed against the sheet alternative rather
 * than inherited: the OS keyboard owns the lower half for a whole sitting, and
 * the Home picker stacks on top as the only sheet. The board's
 * `Add gear — split 900` draws the form in a detail pane with the Depot list
 * kept beside it; `App.tsx` routes `/add` to a screen of its own at every
 * width, so that pane is drawn and not built — which is why this screen
 * answers {@link useScreenHeader} `splitPane: false`.
 *
 * ## Order = the ledger line being written
 *
 * NAME · KIND (+ count) · HOME · OWNER · RECORDED AS. Three things about that
 * order are decisions rather than habit:
 *
 * - **Owned count inserts *below* Kind**, so nothing at or above the thumb
 *   moves when Counted is picked.
 * - **The trait sits last**, beside the CTA: it is the rarest decision and
 *   the only irreversible one, so it sits where the eye lands before
 *   committing. Round 1's checkbox is retired — a checkbox reads as a
 *   setting, and this is not a setting.
 * - **OWNER sits beside HOME**, because the two behave identically — both
 *   carry over between records — and because it is not on the board at all.
 *   See "The second departure" below.
 *
 * ## The sitting
 *
 * **After Add the screen stays.** Round 1 navigated to the new gear's detail
 * after every record, which made populating a depot a round trip per item.
 * Now the name clears and keeps focus — return records, so the batch loop is
 * type → return → type — Kind, count and trait reset, and **Home and owner
 * carry over**, because a depot is recorded shelf by shelf. A fresh entry
 * starts at Loose and Shared.
 *
 * ## The one departure from the board
 *
 * The board draws `UNDO` beside the confirmation line, specified as "restores
 * the record into the form and **removes the op**". An op cannot be removed
 * from an append-only log that may already have pushed it, and **story 36
 * (Undo) is Later and opens with a design phase** — it rules out the only
 * compensating op that exists ("It does not leave the Gear marked, Retired,
 * or otherwise visibly different") and forbids by name a reversal that gets
 * weaker because time passed, which is exactly what a before-first-push
 * retraction would be. So the confirmation line ships without it. The board
 * element is blocked on story 36, not wrong.
 *
 * ## The second departure: `OWNER` is not on the board's F1
 *
 * The board's order is settled and reasoned, and carries no owner. Taken
 * anyway, because without it S4's only route to attributing gear is one
 * gear-detail visit per item, and the Depot's bulk `SET OWNER` band is story
 * 35, tagged Later. A household attributing a two-hundred-item depot would
 * make two hundred screen visits, and the slice's own test — "personal gear
 * stops being everyone's problem" — would fail on the first day of real use.
 *
 * It sits **after HOME** because the two behave identically. The board's own
 * argument for HOME carrying over is that "a depot is recorded shelf by
 * shelf"; a shelf in a bedroom is one person's, so the argument is the same
 * one. Owner is also one of the five shared attributes the domain model lists
 * (home, owner, kind, tags, weight) — and the only one F1 omitted.
 *
 * Still **one** `gear.recorded` carrying every field. Nothing new is emitted,
 * and the screen's "no failure state" property is untouched.
 */

/** The current Home selection's display label. Undefined reads as `Loose` —
 * the gear has not been given a residence, so it folds loose (invariant 1). */
function homeLabel(
  places: Record<string, { name?: { value: string | null } }>,
  gear: Record<string, { name?: { value: string | null } }>,
  home: Residence | undefined,
): string {
  if (home === undefined || home.in === 'loose') return 'Loose'
  const entity = home.in === 'place' ? places[home.id] : gear[home.id]
  return entity?.name?.value ?? ''
}

/** What the last record was, for the confirmation line under the title. */
interface Recorded {
  id: string
  name: string
  home: string
}

export function AddGear() {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const [, navigate] = useLocation()

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)
  const [kind, setKind] = useState<KindValue>('single')
  // Opens **empty**, deliberately: a silent ×1 is a wrong ledger line.
  const [ownedCount, setOwnedCount] = useState('')
  const [home, setHome] = useState<Residence | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [owner, setOwner] = useState<Owner>({ type: 'shared' })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [recorded, setRecorded] = useState<Recorded | null>(null)
  const [sessionCount, setSessionCount] = useState(0)

  // `splitPane: false` — see the class docstring: `/add` is its own screen at
  // every width, so at Split the back link is the only route back to the
  // Depot.
  const header = useScreenHeader({ splitPane: false })

  const nameField = useRef<HTMLInputElement>(null)

  const trimmedName = name.trim()
  const parsedCount = Number.parseInt(ownedCount, 10)
  const countIsChosen =
    ownedCount.trim() !== '' &&
    Number.isSafeInteger(parsedCount) &&
    parsedCount >= 0
  // Name always; the count only while Counted, because only then does the
  // ledger line have a number in it to get wrong.
  const canSubmit = trimmedName !== '' && (kind !== 'counted' || countIsChosen)

  function submit() {
    if (!canSubmit) return

    const id = systemIdSource.next()
    emit(
      gearRecorded(id, {
        name: trimmedName,
        container,
        kind,
        ...(home === undefined ? {} : { residence: home }),
        // **Only when it is personal.** An untouched form must not write an
        // ownership register at all: absence already reads `SHARED`
        // (`selectors/owner.ts`), so writing `{type:'shared'}` on every
        // record would add a register carrying no fact anybody stated, and
        // make `NEWEST FIRST`'s `recordedAt` depend on a field nobody set.
        // The row still *draws* `Shared`, because that is what absence means.
        ...(owner.type === 'shared' ? {} : { owner }),
        ...(kind === 'counted' && countIsChosen
          ? { owned_count: parsedCount }
          : {}),
      }),
    )

    setRecorded({
      id,
      name: trimmedName,
      home: homeLabel(state.places, state.gear, home),
    })
    setSessionCount((count) => count + 1)

    // Home and owner persist; everything else returns to its default. A
    // depot is recorded shelf by shelf, and a shelf in a bedroom is one
    // person's.
    setName('')
    setKind('single')
    setOwnedCount('')
    setContainer(false)
    nameField.current?.focus()
  }

  function step(by: number) {
    const from = countIsChosen ? parsedCount : 0
    setOwnedCount(String(Math.max(0, from + by)))
  }

  return (
    <div className={styles['screen']}>
      {/* The same band gear detail carries, under the same rule
          (`frontend-design.md` §3.3). Below Desktop the only other way back
          from a form is the tab bar or the rail, neither of which names the
          Depot, so the link is what this band is for; at Desktop the 216px
          sidebar's own row is where `‹ DEPOT` points, so the link goes. The
          sync line is drawn at Split alone, the one mode where `AppShell`'s
          marker is a bare rail dot with no words. `useScreenHeader` decides
          both, and at Desktop it withholds the band entirely. */}
      <ScreenBand
        header={header}
        back={{ href: '/', label: 'DEPOT' }}
        sync={sync}
      />

      <div className={styles['titleRow']}>
        <h1 className={styles['title']}>Add gear</h1>
        {sessionCount > 0 && (
          <span className={styles['sessionCount']} data-testid="session-count">
            {sessionCount} RECORDED
          </span>
        )}
      </div>

      {recorded !== null && (
        <button
          type="button"
          className={styles['confirmation']}
          data-testid="confirmation"
          onClick={() => navigate(`/gear/${recorded.id}`)}
        >
          RECORDED · {recorded.name} → {recorded.home}
        </button>
      )}

      <label className={styles['field']}>
        <span className={styles['label']}>Name</span>
        <input
          ref={nameField}
          className={styles['input']}
          value={name}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // The two-action record: type the name, press return. The
            // keyboard never dismisses, so the CTA is never reached for in a
            // batch.
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      <fieldset className={styles['segmentedField']}>
        <legend className={styles['label']}>Kind</legend>
        {/* `ui/SegmentedControl`, default — this is the 48px, body-faced size, and
            the only caller of it. */}
        <SegmentedControl
          name="kind"
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
        />
      </fieldset>

      {/* Inserted below Kind, so nothing at or above the thumb moves. */}
      {kind === 'counted' && (
        <div className={styles['field']}>
          <label className={styles['label']} htmlFor="owned-count">
            Owned count
          </label>
          <div className={styles['stepper']}>
            <button
              type="button"
              className={styles['stepperButton']}
              aria-label="Fewer"
              onClick={() => step(-1)}
            >
              −
            </button>
            <input
              id="owned-count"
              // `text` with a numeric keypad, not `number`: a number input
              // reports an empty string for anything it considers invalid, so
              // "opens empty" and "holds nonsense" become indistinguishable —
              // and this well's whole point is that empty is a real state
              // that gates the CTA.
              type="text"
              inputMode="numeric"
              className={styles['stepperWell']}
              value={ownedCount}
              onChange={(event) =>
                setOwnedCount(event.target.value.replace(/[^0-9]/g, ''))
              }
            />
            <button
              type="button"
              className={styles['stepperButton']}
              aria-label="More"
              onClick={() => step(1)}
            >
              +
            </button>
          </div>
          <p className={styles['fact']}>OPENS EMPTY — GATES THE CTA</p>
        </div>
      )}

      <button
        type="button"
        className={styles['homeRow']}
        aria-label="Home"
        onClick={() => setPickerOpen(true)}
      >
        <span className={styles['label']}>Home</span>
        <span className={styles['homeValue']}>
          {homeLabel(state.places, state.gear, home)}{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>

      {/* The same 48px bordered control HOME uses, and deliberately the same
          classes: the board draws the two rows identically, and a third
          caller is when to generalise the name. */}
      <button
        type="button"
        className={styles['homeRow']}
        aria-label="Owner"
        onClick={() => setOwnerPickerOpen(true)}
      >
        <span className={styles['label']}>Owner</span>
        <span className={styles['homeValue']}>
          {owner.type === 'shared'
            ? 'Shared'
            : personLabel(state, owner.personId)}{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>

      <fieldset className={styles['segmentedField']}>
        <legend className={styles['label']}>Recorded as</legend>
        {/* The glossary's own meta-line words. Not a checkbox: a checkbox
            reads as a setting, and the trait is fixed at recording. The
            boolean is mapped to the two words here rather than teaching the
            primitive about booleans — `patterns.md` §5.3, the caller owns
            what a value means. */}
        <SegmentedControl
          name="trait"
          options={TRAIT_OPTIONS}
          value={container ? 'container' : 'item'}
          onChange={(next) => setContainer(next === 'container')}
        />
        <p className={styles['fact']}>
          CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED
        </p>
      </fieldset>

      <button
        type="button"
        className={styles['primary']}
        disabled={!canSubmit}
        onClick={submit}
      >
        Add gear
      </button>

      {/* No failure state: one local `gear.recorded` carrying every field.

          Centred, because it follows its CTA block, and that block is the
          full-width primary above it (boards' README §5). The two field-level
          fact lines above stay flush left: the board moves only this one. */}
      <p className={`${styles['fact']} ${styles['ctaFact']}`}>
        RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND
      </p>

      {ownerPickerOpen && (
        <OwnerPicker
          value={owner}
          onSelect={(next) => {
            setOwner(next)
            setOwnerPickerOpen(false)
          }}
          onClose={() => setOwnerPickerOpen(false)}
        />
      )}

      {pickerOpen && (
        <HomePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(residence) => {
            setHome(residence.in === 'loose' ? undefined : residence)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
