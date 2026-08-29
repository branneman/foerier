import { personRecorded, personRenamed, systemIdSource } from '@foerier/shared'
import { Confirm, ExpiryChip } from '@foerier/ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'

import type { AuthApi, InviteRow, LoginRow } from '../auth/api'
import { sortedPeople } from '../depot/people'
import { useDepot } from '../depot/store'
import { syncLabel, syncTone } from '../depot/syncLabel'
import styles from './People.module.css'

/**
 * **People** — the board's Screens C §08 (`docs/design/README.md` §13), now
 * with its login half: `GET /auth/logins` and the join half of
 * `GET /auth/invites` are S5's (story 28).
 *
 * `+ NEW PERSON` authors `person.recorded` (S2's op, given a second caller
 * here and in the owner picker); EDIT mode authors `person.renamed` (one of
 * S4's two). Neither op nor the People list itself needed the server half —
 * only the row's meta line and right column did.
 *
 * ## Five row states, one load
 *
 * `rowStateOf` below is the whole of the mapping from three inputs — the
 * folded People, the Logins list, and the join half of the Invites list —
 * to the board's five row states (own Login, another's Login with or
 * without a Device, an outstanding join Invite, or nothing at all). It reads
 * `status !== 'loaded'` first, which is what makes the offline fallback
 * exact: every row it produces for `'loading'` or `'failed'` is the literal
 * `unknown` state S4 shipped, not a guess dressed up as one.
 *
 * **Stating something false is worse than stating less** is not a historical
 * note about S4 — it is what the offline fallback still has to honour. When
 * the login half cannot be loaded, this screen renders precisely what S4
 * rendered: neutral circles, no meta, no right column, `N people.` — plus
 * one line saying why.
 *
 * **A device link is deliberately ignored when deciding whether an invite is
 * out.** `INVITE OUT` describes a Login that does not exist yet; a device
 * link belongs to a Login that already does, so `rowStateOf` filters the
 * Invites list to `purpose === 'join'` before it ever looks for a match.
 *
 * ## EDIT mode, and only one verb in it
 *
 * Renaming lives behind the same quiet mono `EDIT` toggle the Home picker
 * settled on (`docs/design/README.md` §3c, R2: "RENAME / REMOVE moved off the
 * pick rows into an EDIT mode"), because a rename affordance on every resting
 * row is a wall of controls around a list you mostly read. The right column
 * this slice adds and `RENAME` never compete for the row's slot: the right
 * column renders only while `!editing`.
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
 *
 * **The own row's `›` is omitted at Desktop.** There, People unfolds into
 * Account's card, and `/account/devices` redirects back to `/account` — so
 * the chevron's destination is the card two rows above it. An affordance
 * that leads nowhere is worse than a missing one.
 */
export interface PeopleProps {
  api: AuthApi
  token: string
  /** The signed-in Login's Person, for the `YOU` badge and the own-row
   * state. */
  personId: string
  /** `list` is the pushed screen; `inline` is Account's Desktop card. */
  variant?: 'list' | 'inline'
}

type LoadStatus = 'loading' | 'loaded' | 'failed'

type RowState =
  | { kind: 'unknown' }
  | { kind: 'own'; deviceCount: number }
  | {
      kind: 'login'
      loginId: string
      deviceCount: number
      lastSeenAt: string | null
    }
  | { kind: 'invited'; inviteId: string; expiresAt: string }
  | { kind: 'none' }

/**
 * The five states of boards §08's person row, from three inputs: the folded
 * People, `GET /auth/logins`, and the join half of `GET /auth/invites`.
 *
 * A device link is deliberately ignored — one Mark issued for Els must not
 * make Els's row read `INVITE OUT`, which describes a Login that does not
 * exist yet.
 *
 * `unknown` is what the whole screen falls back to when the server half
 * cannot be loaded, and it renders exactly what S4 rendered.
 */
function rowStateOf(
  personId: string,
  selfPersonId: string,
  status: LoadStatus,
  logins: readonly LoginRow[],
  invites: readonly InviteRow[],
): RowState {
  if (status !== 'loaded') return { kind: 'unknown' }

  const login = logins.find((row) => row.person_id === personId)
  if (login !== undefined) {
    return personId === selfPersonId
      ? { kind: 'own', deviceCount: login.device_count }
      : {
          kind: 'login',
          loginId: login.id,
          deviceCount: login.device_count,
          lastSeenAt: login.last_seen_at,
        }
  }

  const invite = invites.find(
    (row) => row.purpose === 'join' && row.person_id === personId,
  )
  if (invite !== undefined) {
    return {
      kind: 'invited',
      inviteId: invite.id,
      expiresAt: invite.expires_at,
    }
  }

  return { kind: 'none' }
}

/**
 * `2026-08-20 19:04`. Sliced straight off the ISO string rather than read
 * through `Date`'s local-time accessors — the same choice
 * `Devices.tsx`'s own `formatDateTime` already made, and for the same
 * reason: a `getHours()`/`getMinutes()` read is the *viewer's* offset, which
 * would make this line print a different hour on a device in a different
 * timezone than the one the Login was last seen from, and silently drift
 * further from `Devices.tsx`'s twin the moment anyone touched either.
 */
function lastSeenLabel(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

function metaOf(state: RowState): string | null {
  switch (state.kind) {
    case 'unknown':
      return null
    case 'own':
      // No `LAST SEEN` on your own row: printing when *you* were last seen,
      // on the screen you are looking at, is noise.
      return `SIGNED IN · ${state.deviceCount} ${
        state.deviceCount === 1 ? 'DEVICE' : 'DEVICES'
      }`
    case 'login':
      if (state.deviceCount === 0) return 'LOGIN · NO DEVICE SIGNED IN'
      return (
        `SIGNED IN · ${state.deviceCount} ` +
        `${state.deviceCount === 1 ? 'DEVICE' : 'DEVICES'}` +
        (state.lastSeenAt === null
          ? ''
          : ` · LAST SEEN ${lastSeenLabel(state.lastSeenAt)}`)
      )
    case 'invited':
      return 'INVITE OUT · SINGLE USE'
    case 'none':
      return 'NO LOGIN · JOINS TRIPS AS PARTICIPANT'
  }
}

/**
 * The verb-and-noun agreement `N of M people hold(s) a login.` carries. Not
 * exported: `Account.tsx`'s phone summary row states the same fact in its
 * own compact shape (`N SIGNED IN`, matching the DEVICES section head's own
 * badge) rather than fitting this full sentence into a row.
 *
 * The verb agrees with the **count of logins**, never with the count of
 * people: `1 of 3 people holds a login.` and `2 of 3 people hold a login.`
 */
function loginVerbClause(loginCount: number, peopleCount: number): string {
  return peopleCount === 1
    ? 'person holds'
    : loginCount === 1
      ? 'people holds'
      : 'people hold'
}

export function People({
  api,
  token,
  personId,
  variant = 'list',
}: PeopleProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)

  const [editing, setEditing] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [logins, setLogins] = useState<readonly LoginRow[]>([])
  const [invites, setInvites] = useState<readonly InviteRow[]>([])
  const [revoking, setRevoking] = useState<{
    loginId: string
    name: string
  } | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  // The same list the owner picker draws, from the same function: two views of
  // one list sorting differently would make "the third one down" mean two
  // different People.
  const people = sortedPeople(state)

  /**
   * One status for both lists, because the login half is one claim and half
   * of it is not worth drawing: a row that knows about an outstanding invite
   * but not about a Login would say `INVITE OUT` for somebody who has
   * already joined.
   */
  const load = useCallback(async () => {
    try {
      const [loginsBody, invitesBody] = await Promise.all([
        api.listLogins(token),
        api.listInvites(token),
      ])
      setLogins(loginsBody.logins)
      setInvites(invitesBody.invites)
      setStatus('loaded')
    } catch (error) {
      console.error('people: could not load login state', error)
      setStatus('failed')
    }
  }, [api, token])

  useEffect(() => {
    void load()
  }, [load])

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

  async function confirmRevokeLogin() {
    if (revoking === null) return
    setRevokeBusy(true)
    try {
      await api.revokeLogin(token, revoking.loginId)
      setRevoking(null)
      void load()
    } catch (error) {
      console.error('people: could not revoke the login', error)
    } finally {
      setRevokeBusy(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    try {
      await api.revokeInvite(token, inviteId)
      void load()
    } catch (error) {
      console.error('people: could not revoke the invite', error)
    }
  }

  const loginCount = logins.length
  const inviteCount = invites.filter((row) => row.purpose === 'join').length
  const countLine =
    `${loginCount} of ${people.length} ${loginVerbClause(loginCount, people.length)} a login.` +
    (inviteCount === 0
      ? ''
      : ` ${inviteCount} ${inviteCount === 1 ? 'invite' : 'invites'} out.`)

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
        {status === 'loaded'
          ? countLine
          : `${people.length} ${people.length === 1 ? 'person' : 'people'}.`}
      </p>

      {status === 'failed' && (
        <p className={styles['nudgeLine']}>
          Login state could not be loaded. Check your connection.
        </p>
      )}

      <ul className={styles['rows']}>
        {people.map((person) => {
          const rowState = rowStateOf(
            person.id,
            personId,
            status,
            logins,
            invites,
          )
          const meta = metaOf(rowState)

          return (
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

                  `data-login` carries the board's accent-vs-control border
                  encoding, and carries **no attribute at all** while the
                  login half is not `'loaded'` — the CSS then falls through
                  to S4's neutral border, which is the whole of the offline
                  fallback for the circle. */}
              <span
                className={styles['circle']}
                data-testid={`person-initial-${person.id}`}
                data-login={
                  rowState.kind === 'unknown'
                    ? undefined
                    : rowState.kind === 'own' || rowState.kind === 'login'
                      ? 'yes'
                      : 'no'
                }
                aria-hidden="true"
              >
                {person.label === '—'
                  ? ''
                  : person.label.charAt(0).toUpperCase()}
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

                  {meta !== null && (
                    <span className={styles['meta']}>{meta}</span>
                  )}

                  {!editing &&
                    rowState.kind === 'own' &&
                    variant === 'list' && (
                      // At Desktop the inline card sits inside Account, which
                      // already draws DEVICES two rows above — and
                      // `/account/devices` redirects back to `/account` there.
                      // A chevron whose destination is the card above it is an
                      // affordance that leads nowhere.
                      <Link
                        href="/account/devices"
                        className={styles['chevron']}
                      >
                        ›
                      </Link>
                    )}

                  {!editing && rowState.kind === 'login' && (
                    <>
                      <Link
                        href={`/account/people/${person.id}/device-link`}
                        className={styles['action']}
                      >
                        DEVICE LINK ›
                      </Link>
                      <button
                        type="button"
                        className={styles['revoke']}
                        onClick={() =>
                          setRevoking({
                            loginId: rowState.loginId,
                            name: person.label,
                          })
                        }
                      >
                        REVOKE
                      </button>
                    </>
                  )}

                  {!editing && rowState.kind === 'invited' && (
                    <>
                      <ExpiryChip expiresAt={rowState.expiresAt} />
                      {/* No REOPEN: the secret is stored hashed and exists
                          only in the link (auth-design §3.1), so nothing can
                          reopen one. Re-handing a link is REVOKE, which
                          returns this row to `INVITE ›`. */}
                      <button
                        type="button"
                        className={styles['revoke']}
                        onClick={() => void revokeInvite(rowState.inviteId)}
                      >
                        REVOKE
                      </button>
                    </>
                  )}

                  {!editing && rowState.kind === 'none' && (
                    <Link
                      href={`/account/people/${person.id}/invite`}
                      className={styles['action']}
                    >
                      INVITE ›
                    </Link>
                  )}

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
          )
        })}
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

      {revoking !== null && (
        <Confirm
          variant="sheet"
          title={`Revoke ${revoking.name}’s login?`}
          description={`${revoking.name}’s devices lose access at their next contact with the server. Everything ${revoking.name} recorded stays.`}
          onClose={() => setRevoking(null)}
          actions={
            <>
              {/* No `▲`: nothing is discarded here — signing out this
                  device is the only auth action that can, and the only one
                  that earns that warning. */}
              <Confirm.Action>
                <button
                  type="button"
                  className={styles['confirmAttention']}
                  disabled={revokeBusy}
                  onClick={() => void confirmRevokeLogin()}
                >
                  Revoke login
                </button>
              </Confirm.Action>
              <Confirm.Cancel>
                <button
                  type="button"
                  className={styles['ghost']}
                  disabled={revokeBusy}
                >
                  Cancel
                </button>
              </Confirm.Cancel>
            </>
          }
        />
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
