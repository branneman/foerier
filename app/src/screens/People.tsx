import { personRecorded, personRenamed, systemIdSource } from '@foerier/shared'
import { useState } from 'react'
import { Link } from 'wouter'

import { sortedPeople } from '../depot/people'
import { useDepot } from '../depot/store'
import { syncLabel, syncTone } from '../depot/syncLabel'
import styles from './People.module.css'

/**
 * **People** — the board's Screens C §08 (`docs/design/README.md` §13), minus
 * its entire login half.
 *
 * The screen story 4 needs before gear can belong to anybody, and the fourth
 * thing reachable from Account. `+ NEW PERSON` authors `person.recorded`
 * (S2's op, given a second caller here and in the owner picker); EDIT mode
 * authors `person.renamed` (one of S4's two).
 *
 * ## Why the row is so thin
 *
 * The board's person row carries a meta line and a right column, and **every
 * line in both is login state** — `SIGNED IN · 2 DEVICES`, `NO LOGIN · JOINS
 * TRIPS AS PARTICIPANT`, `INVITE OUT · SINGLE USE`, `INVITE ›`, `DEVICE LINK
 * ›`, `REVOKE`. `GET /auth/logins` is S5's endpoint (story 28), so at S4 none
 * of it is knowable and none of it is drawn. That is Find's `S8 · PIECES`
 * pattern: an element designed final that falls through to a simpler variant
 * until its slice lands.
 *
 * **The circle carries no login encoding either.** The board's rule is accent
 * border for a Person who holds a Login, control border for one who does not.
 * Drawing every circle with the control border would render the joiner — who
 * demonstrably holds one — as having none, so the circle draws the control
 * border with **no meaning attached** and S5 lights it. Stating something
 * false is worse than stating less.
 *
 * The three obligations this hands to S5 are written down in
 * `docs/specs/2026-08-29-people-and-ownership.md` §7, so they are a stated
 * debt rather than a gap somebody has to notice.
 *
 * ## EDIT mode, and only one verb in it
 *
 * Renaming lives behind the same quiet mono `EDIT` toggle the Home picker
 * settled on (`docs/design/README.md` §3c, R2: "RENAME / REMOVE moved off the
 * pick rows into an EDIT mode"), because a rename affordance on every resting
 * row is a wall of controls around a list you mostly read.
 *
 * **`RENAME` only, never `REMOVE`.** A Person is never removed — gear
 * ownership and past trips reference them, and the domain gives no removal
 * operation (`sync-protocol.md` §4.2). The Home picker's second verb has no
 * counterpart here, and its absence is the design rather than an omission.
 *
 * ## Two renders, one component
 *
 * `variant="list"` is the pushed screen below Desktop; `variant="inline"` is
 * the card Account unfolds at Desktop, where the boards draw "all three
 * people inline". Which one exists is a **media query** — it decides what
 * exists, not how it lays out ([frontend-design §3.2](../../../docs/frontend-design.md))
 * — and `/account/people` redirects to `/account` at Desktop for exactly the
 * reason `/account/devices` already does.
 */
export interface PeopleProps {
  /** The signed-in Login's Person, for the `YOU` badge. */
  personId: string
  /** `list` is the pushed screen; `inline` is Account's Desktop card. */
  variant?: 'list' | 'inline'
}

export function People({ personId, variant = 'list' }: PeopleProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)

  const [editing, setEditing] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  // The same list the owner picker draws, from the same function: two views of
  // one list sorting differently would make "the third one down" mean two
  // different People.
  const people = sortedPeople(state)

  function startRename(id: string, current: string) {
    setRenamingId(id)
    // Seeded with the label, so `—` never becomes a literal name: a Person
    // with no name starts from an empty field, which the disabled Save then
    // holds until something real is typed.
    setRenameValue(current === '—' ? '' : current)
  }

  function submitRename() {
    if (renamingId === null) return
    const trimmed = renameValue.trim()
    if (trimmed !== '') emit(personRenamed(renamingId, trimmed))
    setRenamingId(null)
  }

  function submitNewPerson() {
    const trimmed = newName.trim()
    if (trimmed === '') return
    emit(personRecorded(systemIdSource.next(), trimmed))
    setNewName('')
    setAdding(false)
  }

  const body = (
    <>
      {variant === 'list' && (
        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>People</h1>
          <button
            type="button"
            className={styles['modeToggle']}
            aria-pressed={editing}
            onClick={() => {
              setEditing((on) => !on)
              setRenamingId(null)
            }}
          >
            {editing ? 'DONE' : 'EDIT'}
          </button>
        </div>
      )}

      <p className={styles['count']} data-testid="people-count">
        {people.length} {people.length === 1 ? 'person' : 'people'}.
      </p>

      <ul className={styles['rows']}>
        {people.map((person) => (
          <li
            key={person.id}
            className={styles['row']}
            data-testid={`person-row-${person.id}`}
          >
            {/* `aria-hidden`, following `AppShell`'s `AccountAvatar`: an
                initial read aloud is as easily a stray letter as a name, and
                the row's own text already carries the name. A Person with no
                folded name draws an **empty** circle rather than a
                placeholder letter — inventing one would be a fact the app
                does not have.

                No login encoding: the board's accent border means "holds a
                Login", which S4 cannot know. S5 lights it. */}
            <span
              className={styles['circle']}
              data-testid={`person-initial-${person.id}`}
              aria-hidden="true"
            >
              {person.label === '—' ? '' : person.label.charAt(0).toUpperCase()}
            </span>

            {renamingId === person.id ? (
              <div className={styles['renameRow']}>
                <input
                  className={styles['renameInput']}
                  aria-label="New name"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitRename()
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles['inlineSave']}
                  disabled={renameValue.trim() === ''}
                  onClick={submitRename}
                >
                  Save
                </button>
                <button
                  type="button"
                  className={styles['inlineCancel']}
                  onClick={() => setRenamingId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className={styles['name']} data-testid="person-name">
                  {person.label}
                </span>
                {person.id === personId && (
                  <span className={styles['badge']}>YOU</span>
                )}
                {/* The meta slot and the right column are S5's — every line
                    the board draws in them is login state. Deliberately
                    absent rather than faked. */}
                {editing && (
                  <button
                    type="button"
                    className={styles['rename']}
                    onClick={() => startRename(person.id, person.label)}
                  >
                    RENAME
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className={styles['renameRow']}>
          <input
            className={styles['renameInput']}
            aria-label="New person name"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitNewPerson()
              }
            }}
          />
          <button
            type="button"
            className={styles['inlineSave']}
            disabled={newName.trim() === ''}
            onClick={submitNewPerson}
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
          + NEW PERSON
        </button>
      )}

      {/* A Person is never removed (`sync-protocol.md` §4.2) — said once,
          in EDIT mode, rather than left as an absence a reader has to
          notice. */}
      {editing && variant === 'list' && (
        <p className={styles['hint']}>
          A PERSON IS NEVER REMOVED — GEAR AND PAST TRIPS REFER TO THEM.
        </p>
      )}
    </>
  )

  if (variant === 'inline') return body

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Link href="/account" className={styles['back']}>
          ‹ ACCOUNT
        </Link>
        <span className={styles['sync']}>
          <span
            className={`${styles['syncDot']} ${
              syncTone(sync) === 'unreachable'
                ? styles['syncDotUnreachable']
                : ''
            }`}
            aria-hidden="true"
          />
          {syncLabel(sync)}
        </span>
      </header>

      {body}
    </div>
  )
}
