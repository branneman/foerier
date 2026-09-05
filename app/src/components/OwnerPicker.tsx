import { personRecorded, systemIdSource, type Owner } from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'

import { sortedPeople } from '../household/people'
import { useHousehold } from '../household/store'
import styles from './OwnerPicker.module.css'

/**
 * **Who a piece of gear belongs to** — `Shared`, or one recorded Person.
 *
 * Opened from Add gear's `OWNER` row and from gear detail's Edit sheet, which
 * are the only two places ownership is decided. The Depot's bulk `SET OWNER`
 * band is story 35 and tagged LATER on the boards.
 *
 * ## Shared is a row, not a clear
 *
 * The domain has exactly two states — "personal to one person, **or** shared"
 * — and shared is one of them, not the absence of the other. So `Shared` is
 * the first row and is drawn chosen like any other, rather than sitting at the
 * bottom as a `CLEAR` affordance.
 *
 * It sits **first** for the same reason `Loose` sits first in the Home picker:
 * the pseudo-value meaning "belongs to no one in particular" is the list's
 * spine rather than an entry in it, and it is what most gear is. The group
 * headers under `GROUP BY OWNER` pin `shared` for the identical reason.
 *
 * ## It can record a Person
 *
 * The Home picker can create a Place while picking, and "a place created while
 * picking is **selected**". The same is true here, and matters more: Add gear
 * carries the owner over between records precisely so a shelf's worth of one
 * person's gear goes in a single sitting, so discovering mid-sitting that the
 * Person was never recorded would otherwise mean leaving the screen and losing
 * the form.
 *
 * Recording is `person.recorded` — S2's op, not one of S4's two. The People
 * screen is the other caller.
 */
export interface OwnerPickerProps {
  /** The owner the caller currently holds; its row is drawn chosen. */
  value: Owner
  onSelect: (owner: Owner) => void
  onClose: () => void
}

export function OwnerPicker({ value, onSelect, onClose }: OwnerPickerProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  // Mount resets these — `ui/`'s `Sheet` has no `open` prop, so a caller
  // writes `{open && <OwnerPicker …/>}` and closing genuinely unmounts. That
  // is the Radix conversion's rule, and it is why a half-typed new name never
  // comes back on the next open.
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const people = sortedPeople(state)

  function addPerson() {
    const trimmed = newName.trim()
    if (trimmed === '') return
    const id = systemIdSource.next()
    emit(personRecorded(id, trimmed))
    // Created while picking is selected — the Home picker's rule.
    onSelect({ type: 'person', personId: id })
  }

  return (
    <Sheet title="Owner" onClose={onClose} desktopCard>
      <ul className={styles['rows']}>
        <li>
          <button
            type="button"
            className={styles['row']}
            data-testid="owner-row"
            aria-pressed={value.type === 'shared'}
            onClick={() => onSelect({ type: 'shared' })}
          >
            <span>Shared</span>
            {value.type === 'shared' && (
              <span className={styles['now']}>● NOW</span>
            )}
          </button>
        </li>
        {people.map((person) => {
          const chosen = value.type === 'person' && value.personId === person.id
          return (
            <li key={person.id}>
              <button
                type="button"
                className={styles['row']}
                data-testid="owner-row"
                aria-pressed={chosen}
                onClick={() =>
                  onSelect({ type: 'person', personId: person.id })
                }
              >
                <span>{person.label}</span>
                {chosen && <span className={styles['now']}>● NOW</span>}
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
            onClick={() => setAdding(false)}
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
          + New person
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
