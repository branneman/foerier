import {
  personRecorded,
  systemIdSource,
  UNNAMED_PERSON_GLYPH,
} from '@foerier/shared'
import { PersonCircle, Sheet } from '@foerier/ui'
import { useState } from 'react'

import { sortedPeople } from '../depot/people'
import { useDepot } from '../depot/store'
import styles from './ParticipantPicker.module.css'

/**
 * **Who is on the Trip** — `OwnerPicker`'s twin, multi-select where that one
 * is single-select, and otherwise the same anatomy on purpose: one row per
 * recorded Person in `sortedPeople` order, a dashed create row, a `Close`.
 *
 * Rows, not circles: a picker is made of rows everywhere in this app, and the
 * circle the board draws at the head of each one is display *inside* a row
 * rather than a circle in place of it. The one word that differs from the twin
 * is the marker — membership reads `PARTICIPANT ✓`, the builder's `IN LIST ✓`
 * grammar, and `● NOW` stays reserved for a register that holds exactly one
 * value.
 *
 * There is no pinned first row. `Shared` is a *value* of the ownership
 * register and belongs at the top of the owner picker for that reason; a
 * Participant list is a set of People and has no equivalent pseudo-value.
 *
 * ## Controlled, and it authors no `trip.*` op
 *
 * Both callers agree on the rows and disagree on what a tap means. On
 * `/trips/:id` a toggle is a `trip.participant_added` or
 * `trip.participant_removed` emitted immediately; on `/trips/new` there is no
 * Trip to address yet, so the selection is draft state and the ops are
 * authored later, with `trip.created`. A picker that emitted for itself could
 * only serve the first, and the second is the screen the flow starts on.
 *
 * So the selection comes in and the toggles go out, and the trip id — which
 * this component never learns — stays the caller's business.
 *
 * ## It does record a Person
 *
 * `person.recorded` is a **Depot** fact, not a Trip one, so authoring it here
 * is not a contradiction of the paragraph above: the picker emits nothing
 * about the Trip and everything about the Person it just created. The reason
 * is `OwnerPicker`'s, and it bites harder here — discovering mid-flow that a
 * Participant was never recorded would otherwise be a dead end in the middle
 * of the one screen (`/trips/new`) designed to be finished in one sitting, and
 * a household planning its first Trip before recording anybody would face an
 * empty sheet with no way out.
 *
 * A Person created while picking is **selected**, which is the Home picker's
 * rule inherited through `OwnerPicker`.
 *
 * ## Removal never confirms
 *
 * The tag picker's rule: it is cheap and instantly reversible — the next tap
 * puts them back — and at S6 removing a Participant removes nothing else.
 * When S8's per-person Pieces exist they are derived from participation
 * (invariant 10) rather than cascaded from it, so this stays true.
 */
export interface ParticipantPickerProps {
  /** The person ids currently on the Trip, or in the caller's draft. */
  selected: readonly string[]
  /** `next` is what the row becomes, so a caller never re-derives it. */
  onToggle: (personId: string, next: boolean) => void
  onClose: () => void
}

export function ParticipantPicker({
  selected,
  onToggle,
  onClose,
}: ParticipantPickerProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  // Mount resets these — `ui/`'s `Sheet` has no `open` prop, so a caller
  // writes `{open && <ParticipantPicker …/>}` and closing genuinely unmounts.
  // That is the Radix conversion's rule, and it is why a half-typed new name
  // never comes back on the next open.
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const people = sortedPeople(state)
  const onTrip = new Set(selected)

  function addPerson() {
    const trimmed = newName.trim()
    if (trimmed === '') return
    const id = systemIdSource.next()
    emit(personRecorded(id, trimmed))
    // Created while picking is selected — the Home picker's rule.
    onToggle(id, true)
    // And then the create row folds away again, which `OwnerPicker` never has
    // to do: selecting an owner closes that sheet, so mount is its reset.
    // This one stays open for the next Participant, so a second
    // `+ NEW PERSON` must not open on the name just recorded.
    setNewName('')
    setAdding(false)
  }

  return (
    <Sheet title="Participants" onClose={onClose} desktopCard>
      <ul className={styles['rows']}>
        {people.map((person) => {
          const chosen = onTrip.has(person.id)
          return (
            <li key={person.id}>
              <button
                type="button"
                className={styles['row']}
                data-testid="participant-row"
                // The state a screen reader gets. The mono marker beside it is
                // the sighted half of the same fact — never colour alone.
                aria-pressed={chosen}
                onClick={() => onToggle(person.id, !chosen)}
              >
                {/* The board's 30px initial circle, the People screen's size
                    and not the trip card's 22px — a picker row is a row, and
                    it is the row's height that sets the circle's. `aria-hidden`
                    for `AccountAvatar`'s reason: the name is right beside it,
                    and an initial announced is as easily a stray letter. A
                    Person with no folded name draws an **empty** circle rather
                    than a placeholder letter. No login ring: that encoding is
                    the People screen's statement about Logins, and this sheet
                    knows nothing about them. */}
                <span aria-hidden="true">
                  <PersonCircle
                    label={
                      person.label === UNNAMED_PERSON_GLYPH
                        ? undefined
                        : person.label.charAt(0).toUpperCase()
                    }
                    size={30}
                  />
                </span>
                <span className={styles['name']}>{person.label}</span>
                {chosen && (
                  <span className={styles['marker']}>PARTICIPANT ✓</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {adding ? (
        <div className={styles['addRow']}>
          <input
            className={styles['addInput']}
            aria-label="New person name"
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addPerson()
              }
            }}
          />
          <button
            type="button"
            className={styles['inlineSave']}
            onClick={addPerson}
            disabled={newName.trim() === ''}
          >
            Add
          </button>
          <button
            type="button"
            className={styles['inlineCancel']}
            // Cancelling drops the draft name as well as the row. Mount is
            // this sheet's only other reset and the sheet stays open across
            // both paths, so without it a second `+ NEW PERSON` would open
            // on the text that was just abandoned — the same wrong state
            // `addPerson` clears itself to avoid.
            onClick={() => {
              setNewName('')
              setAdding(false)
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles['addPerson']}
          onClick={() => setAdding(true)}
        >
          + NEW PERSON
        </button>
      )}

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
