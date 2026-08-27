import {
  gearRecorded,
  systemIdSource,
  type KindValue,
  type Residence,
} from '@foerier/shared'
import { useRef, useState } from 'react'
import { useLocation } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { useDepot } from '../depot/store'
import styles from './AddGear.module.css'

/**
 * **F1 — the first screen a Quartermaster records something on**, redrawn
 * round 2 (`docs/design/README.md` §3b, Screens A §06).
 *
 * **A screen, not a sheet** — confirmed against the sheet alternative rather
 * than inherited: the OS keyboard owns the lower half for a whole sitting,
 * the Home picker stacks on top as the only sheet, and Split renders the same
 * form in the detail pane with the list kept.
 *
 * ## Order = the ledger line being written
 *
 * NAME · KIND (+ count) · HOME · RECORDED AS. Two things about that order are
 * decisions rather than habit:
 *
 * - **Owned count inserts *below* Kind**, so nothing at or above the thumb
 *   moves when Counted is picked.
 * - **The trait sits last**, beside the CTA: it is the rarest decision and
 *   the only irreversible one, so it sits where the eye lands before
 *   committing. Round 1's checkbox is retired — a checkbox reads as a
 *   setting, and this is not a setting.
 *
 * ## The sitting
 *
 * **After Add the screen stays.** Round 1 navigated to the new gear's detail
 * after every record, which made populating a depot a round trip per item.
 * Now the name clears and keeps focus — return records, so the batch loop is
 * type → return → type — Kind, count and trait reset, and **Home carries
 * over**, because a depot is recorded shelf by shelf. A fresh entry starts at
 * Loose.
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
 */

const KIND_OPTIONS: readonly { value: KindValue; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'per_person', label: 'Per-person' },
  { value: 'counted', label: 'Counted' },
]

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
  const [, navigate] = useLocation()

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)
  const [kind, setKind] = useState<KindValue>('single')
  // Opens **empty**, deliberately: a silent ×1 is a wrong ledger line.
  const [ownedCount, setOwnedCount] = useState('')
  const [home, setHome] = useState<Residence | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [recorded, setRecorded] = useState<Recorded | null>(null)
  const [sessionCount, setSessionCount] = useState(0)

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

    // Home persists; everything else returns to its default.
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
        <div className={styles['segmented']}>
          {KIND_OPTIONS.map((option) => (
            <label key={option.value} className={styles['segment']}>
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
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

      <fieldset className={styles['segmentedField']}>
        <legend className={styles['label']}>Recorded as</legend>
        <div className={styles['segmented']}>
          {/* The glossary's own meta-line words. Not a checkbox: a checkbox
              reads as a setting, and the trait is fixed at recording. */}
          <label className={styles['segment']}>
            <input
              type="radio"
              name="trait"
              checked={!container}
              onChange={() => setContainer(false)}
            />
            <span>Item</span>
          </label>
          <label className={styles['segment']}>
            <input
              type="radio"
              name="trait"
              checked={container}
              onChange={() => setContainer(true)}
            />
            <span>Container</span>
          </label>
        </div>
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

      {/* No failure state: one local `gear.recorded` carrying every field. */}
      <p className={styles['fact']}>
        RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND
      </p>

      <HomePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(residence) => {
          setHome(residence.in === 'loose' ? undefined : residence)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
