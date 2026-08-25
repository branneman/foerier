import {
  gearRecorded,
  systemIdSource,
  type KindValue,
  type Residence,
} from '@foerier/shared'
import { useState } from 'react'
import { useLocation } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { useDepot } from '../depot/store'
import styles from './AddGear.module.css'

/**
 * F1 — the first screen a Quartermaster records something on
 * (`docs/design/README.md`, Depot §3). Name · a container toggle · a Kind
 * picker · an Owned-count field shown only for Counted (invariant 6) · Home.
 * Submitting emits **one** `gear.recorded` carrying every field the form
 * holds and navigates to the new gear's detail.
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

export function AddGear() {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const [, navigate] = useLocation()

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)
  const [kind, setKind] = useState<KindValue>('single')
  const [ownedCount, setOwnedCount] = useState('1')
  const [home, setHome] = useState<Residence | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)

  const trimmedName = name.trim()
  const canSubmit = trimmedName !== ''

  function submit() {
    if (!canSubmit) return

    const id = systemIdSource.next()
    const parsedCount = Number.parseInt(ownedCount, 10)
    const validCount = Number.isSafeInteger(parsedCount) && parsedCount >= 0

    emit(
      gearRecorded(id, {
        name: trimmedName,
        container,
        kind,
        ...(home === undefined ? {} : { residence: home }),
        ...(kind === 'counted' && validCount
          ? { owned_count: parsedCount }
          : {}),
      }),
    )
    navigate(`/gear/${id}`)
  }

  return (
    <div className={styles['screen']}>
      <h1 className={styles['title']}>Add gear</h1>

      <label className={styles['field']}>
        <span className={styles['label']}>Name</span>
        <input
          className={styles['input']}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
        />
      </label>

      <label className={styles['toggleRow']}>
        <input
          type="checkbox"
          checked={container}
          onChange={(event) => setContainer(event.target.checked)}
        />
        <span>Container</span>
      </label>

      <fieldset className={styles['kindField']}>
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

      {kind === 'counted' && (
        <label className={styles['field']}>
          <span className={styles['label']}>Owned count</span>
          <input
            type="number"
            className={styles['input']}
            value={ownedCount}
            min={0}
            onChange={(event) => setOwnedCount(event.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        className={styles['homeRow']}
        aria-label="Home"
        onClick={() => setPickerOpen(true)}
      >
        <span className={styles['label']}>Home</span>
        <span>{homeLabel(state.places, state.gear, home)}</span>
      </button>

      <div className={styles['spacer']} />

      <button
        type="button"
        className={styles['primary']}
        disabled={!canSubmit}
        onClick={submit}
      >
        Add gear
      </button>

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
