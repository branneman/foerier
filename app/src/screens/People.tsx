import {
  personRecorded,
  personRenamed,
  systemIdSource,
  UNNAMED_PERSON_GLYPH,
} from '@foerier/shared'
import { Confirm, ExpiryChip, PersonCircle } from '@foerier/ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'

import type { AuthApi, InviteRow, LoginRow } from '../auth/api'
import { sortedPeople } from '../depot/people'
import { formatDateTime } from '../format'
import { useDepot } from '../depot/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
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
 * cannot be loaded. It renders what S4 rendered **everywhere except the
 * circle**: S4 could draw the control border and call it neutral because it
 * meant nothing yet, and S5 gives that same border the meaning `= no login`,
 * so reusing it here would state something false about every Person on
 * screen. The circle withdraws its ring instead
 * (`People.module.css`'s `.circle`).
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
          : ` · LAST SEEN ${formatDateTime(state.lastSeenAt)}`)
      )
    case 'invited':
      return 'INVITE OUT · SINGLE USE'
    case 'none':
      return 'NO LOGIN · JOINS TRIPS AS PARTICIPANT'
  }
}

/**
 * The verb-and-noun agreement `N of M people hold(s) a login.` carries.
 * Exported so `Account.tsx`'s phone summary row, which states the same fact
 * in its own compact shape (`N OF M PEOPLE HOLD A LOGIN`, the board's own
 * phrase — `docs/design/README.md` §13), can agree on the same rule rather
 * than re-deriving it. A second derivation is exactly what drifts (S4's
 * `owner.ts` lesson, `CLAUDE.md`).
 *
 * The verb agrees with the **count of logins**, never with the count of
 * people: `1 of 3 people holds a login.` and `2 of 3 people hold a login.`
 */
export function loginVerbClause(
  loginCount: number,
  peopleCount: number,
): string {
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

  // `splitPane: false` — `/account/people` has no two-pane view: below Desktop
  // it is a screen of its own, and at Desktop it is not this component at all
  // but Account's inline card. The hook is called unconditionally, before the
  // `variant === 'inline'` return below, because a hook cannot be; `inline`
  // simply never reads the answer.
  const header = useScreenHeader({ splitPane: false })

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
    setRenameValue(current === UNNAMED_PERSON_GLYPH ? '' : current)
  }

  function submitRename() {
    if (renamingId === null) return
    const trimmed = renameValue.trim()
    // Only when it changed — gear detail's `submitEdit` discipline. `startRename`
    // seeds the field with the current name, so Save-without-editing is the
    // ordinary way to author a redundant `person.renamed`, and a needless
    // write is never free: it moves the LWW stamp and can silently beat a
    // genuine rename queued on a Device that was offline.
    const current = state.people[renamingId]?.name?.value ?? ''
    if (trimmed !== '' && trimmed !== current) {
      emit(personRenamed(renamingId, trimmed))
    }
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

  // Counted from the rows this screen actually draws, not from the raw
  // lists. A Maintainer-minted join Invite (`mintJoinInvite`) carries a
  // `person_id` no `person.recorded` op has ever named, so it renders no
  // row — counting `invites.length` there would print "… 1 invite out."
  // with nothing on screen marked `INVITE OUT`, and symmetrically let
  // `loginCount` print higher than `people.length`. `rowStateOf` is what
  // decides whether a Login or Invite earns a row, so it is the one place
  // both counts and the rendered rows below are allowed to come from.
  const rows = people.map((person) => ({
    person,
    rowState: rowStateOf(person.id, personId, status, logins, invites),
  }))
  const loginCount = rows.filter(
    ({ rowState }) => rowState.kind === 'own' || rowState.kind === 'login',
  ).length
  const inviteCount = rows.filter(
    ({ rowState }) => rowState.kind === 'invited',
  ).length
  const countLine =
    `${loginCount} of ${people.length} ${loginVerbClause(loginCount, people.length)} a login.` +
    (inviteCount === 0
      ? ''
      : ` ${inviteCount} ${inviteCount === 1 ? 'invite' : 'invites'} out.`)

  const body = (
    <>
      {variant === 'list' && (
        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>People & logins</h1>
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
        {rows.map(({ person, rowState }) => {
          const meta = metaOf(rowState)

          return (
            <li
              key={person.id}
              className={styles['row']}
              data-testid={`person-row-${person.id}`}
            >
              {/* `aria-hidden`, following `AppShell`'s `AccountAvatar`: an
                  initial read aloud is as easily a stray letter as a name, and
                  the row's own text already carries the name. `ui/`'s
                  `PersonCircle` draws the empty circle for a Person with no
                  folded name on its own — see its docstring — so this file
                  states only which `tone` the ring carries.

                  `tone` carries the board's accent-vs-control ring encoding,
                  and is `'none'` — a **transparent** border — while the login
                  half is not `'loaded'`. **Do not give `'unknown'` an
                  accent or control tone as a stand-in.** The ring is the
                  statement "login state is known"; painting one here would
                  say "no login" about every Person on screen, including the
                  reader, whose own Login is the reason the screen is open. A
                  third colour was tried and flattened in the parchment
                  theme — see `PersonCircle.module.css`'s own comment.

                  `.circleWrap` (`display: flex`) rather than an unstyled
                  wrapper: a plain `<span>` around a single inline-flex child
                  blockifies into a line box a few px taller than the circle,
                  off-centring it inside `.row` (review round F1). */}
              <span className={styles['circleWrap']} aria-hidden="true">
                <PersonCircle
                  label={
                    person.label === UNNAMED_PERSON_GLYPH
                      ? undefined
                      : person.label.charAt(0).toUpperCase()
                  }
                  size={30}
                  tone={
                    rowState.kind === 'unknown'
                      ? 'none'
                      : rowState.kind === 'own' || rowState.kind === 'login'
                        ? 'accent'
                        : 'control'
                  }
                />
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
          description={`${revoking.name}’s devices lose access at their next sync. Everything ${revoking.name} recorded stays with the household.`}
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
      {/* `useScreenHeader`'s rule (`frontend-design.md` §3.3): the back link
          unless its destination is already on the page, the sync line at
          Split alone. This screen only exists below Desktop, so what the two
          answers come to here is `‹ ACCOUNT` at both widths and the sync line
          at Split — but the rule is asked rather than spelled out, because a
          rule spelled per screen is a chance to spell it differently. */}
      <ScreenBand
        header={header}
        back={{ href: '/account', label: 'ACCOUNT' }}
        sync={sync}
      />

      {body}
    </div>
  )
}
