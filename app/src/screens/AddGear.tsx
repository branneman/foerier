import {
  dimensionValues,
  gearRecorded,
  gearTagApplied,
  normalizeTag,
  personLabel,
  systemIdSource,
  type KindValue,
  type Owner,
  type Residence,
  type TagString,
} from '@foerier/shared'
import { SegmentedControl, Stepper } from '@foerier/ui'
import { useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { OwnerPicker } from '../components/OwnerPicker'
import { TagPicker } from '../components/TagPicker'
import { KIND_OPTIONS, TRAIT_OPTIONS } from '../household/gear'
import { homeLabel } from '../household/gear'
import { useHousehold } from '../household/store'
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
 * NAME · KIND (+ count) · HOME · OWNER · TAGS · RECORDED AS. Three things
 * about that order are decisions rather than habit:
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
 * type → return → type — Kind, count and trait reset, and **Home, owner and
 * tags carry over**, because a depot is recorded shelf by shelf, and a shelf
 * is usually one sort of thing. A fresh entry starts at Loose, Shared and
 * untagged.
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
 * ## The third departure: `TAGS`, and why the submit is N+1 ops
 *
 * `TAGS` sits after `OWNER` on the same argument, one story-35 verb over
 * (`docs/specs/2026-09-07-tags-on-add-gear.md`): the drawn bulk band is
 * `MOVE · TAG · SET OWNER · RETIRE`, `TAG` among them and `LATER`, and a tag
 * is the trait a Quartermaster most often knows *while holding the thing* and
 * least often goes back for. It carries over between records as `HOME` and
 * `OWNER` do, and after S4 took `OWNER` it is the last of the domain model's
 * five shared attributes F1 omitted.
 *
 * So the submit is no longer one op. It is **one `gear.recorded`, unchanged
 * in every field, then one `gear.tag_applied` per drafted tag**, in the row's
 * own order — and a record with no tags emits exactly one op, because a
 * needless write moves the stamp LWW compares (`patterns.md` §2.3), the same
 * rule that makes `OWNER` at `Shared` write no ownership register.
 *
 * The payload was **not** widened, and the reason is the one that did not
 * apply when S4 widened it for `owner`: `owner` was widened in the slice that
 * introduced the register, so no build in the wild could have folded it
 * anyway, while tags have folded since S3. Sync §5's tolerant reader *ignores
 * unknown fields*, so a `gear.recorded` carrying `tags` would fold untagged
 * on every installed build a household actually has — the same Gear reading
 * tagged on the recording Device and untagged on the phone in the next room,
 * invisible until somebody filters. Both op types have shipped since S3, so
 * the N+1 form folds correctly everywhere, and a build older than S3 ignores
 * the tag ops and folds exactly the Gear it would have folded anyway.
 *
 * The screen's **"no failure state" property is untouched**, and it is the
 * one that mattered: every op is local and durable-first, appended to the
 * same log in the same submit, so there is no partial-write window, no
 * request, and nothing to draw a spinner or an error for. The mono fact line
 * is as true of N ops as it was of one. Ordering across them is not a
 * correctness question either — they address different registers on one
 * entity path, and a tag op landing before its `gear.recorded` folds into a
 * Gear that then gets its name.
 */

/** What the last record was, for the confirmation line under the title. */
interface Recorded {
  id: string
  name: string
  home: string
}

export function AddGear() {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const sync = useHousehold((depot) => depot.sync)
  const [, navigate] = useLocation()

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)
  const [kind, setKind] = useState<KindValue>('single')
  // Opens **empty**, deliberately: a silent ×1 is a wrong ledger line.
  // `null` is `ui/Stepper`'s own word for a blank well, and the only reason
  // this screen could not use that component until now.
  const [ownedCount, setOwnedCount] = useState<number | null>(null)
  const [home, setHome] = useState<Residence | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [owner, setOwner] = useState<Owner>({ type: 'shared' })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  // The drafted tags, in the order they were applied — spent as ops at the
  // submit, never before. The picker drives this and not the log
  // (`patterns.md` §4.3): there is no Gear to tag until Add is pressed.
  const [tags, setTags] = useState<readonly TagString[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [recorded, setRecorded] = useState<Recorded | null>(null)
  const [sessionCount, setSessionCount] = useState(0)

  // `splitPane: false` — see the class docstring: `/add` is its own screen at
  // every width, so at Split the back link is the only route back to the
  // Depot.
  const header = useScreenHeader({ splitPane: false, back: '/' })

  const nameField = useRef<HTMLInputElement>(null)

  // The vocabulary the picker's counts and its near-duplicate defence come
  // from — the whole depot's, exactly as `GearDetail.tsx` computes it, so the
  // defence works from the first record of a sitting.
  const vocabulary = useMemo(() => dimensionValues(state, 'tag'), [state])

  const trimmedName = name.trim()
  // `Stepper` parses, clamps at `min` and refuses an unrepresentable integer
  // before it ever calls back, so a non-null value here is already a count
  // this screen can write. The three checks this replaced were that parser,
  // hand-rolled.
  const countIsChosen = ownedCount !== null
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
        ...(kind === 'counted' && ownedCount !== null
          ? { owned_count: ownedCount }
          : {}),
      }),
    )

    // Then one op per drafted tag, in the row's own order. Never a widened
    // `gear.recorded` — see the class docstring — and never anything at all
    // when the row is empty, which falls out of the loop rather than needing
    // a clause.
    for (const tag of tags) emit(gearTagApplied(id, tag))

    setRecorded({
      id,
      name: trimmedName,
      home: homeLabel(state.places, state.gear, home),
    })
    setSessionCount((count) => count + 1)

    // Home, owner and tags persist; everything else returns to its default.
    // A depot is recorded shelf by shelf, a shelf in a bedroom is one
    // person's, and a shelf is usually one sort of thing.
    setName('')
    setKind('single')
    setOwnedCount(null)
    setContainer(false)
    nameField.current?.focus()
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
          {/* A `<span>` and not a `<label htmlFor>`: `ui/Stepper` owns its
              own well and exposes no id, and names it `Owned count` on the
              input itself — gear detail's own field, verbatim, which is the
              point of there being one component. */}
          <span className={styles['label']}>Owned count</span>
          {/* The third caller of `ui/Stepper`, and the one that was
              hand-rolled from before the component could say "blank". The
              two things this screen still owns are below it: the fact line,
              and the CTA gate that reads `null`. */}
          <Stepper
            size="default"
            value={ownedCount}
            min={0}
            onChange={setOwnedCount}
            label="Owned count"
          />
          <p className={styles['fact']}>OPENS EMPTY — GATES THE CTA</p>
        </div>
      )}

      {/* HOME, OWNER and TAGS are one control drawn three times — the same
          48px bordered row, a label, a value and the `›` that says a sheet
          opens. The classes are shared because the board draws the three
          identically; the name stopped being HOME's when the third caller
          arrived. */}
      <button
        type="button"
        className={styles['attrRow']}
        aria-label="Home"
        onClick={() => setPickerOpen(true)}
      >
        <span className={styles['label']}>Home</span>
        <span className={styles['attrValue']}>
          <span className={styles['attrText']}>
            {homeLabel(state.places, state.gear, home)}
          </span>{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>

      <button
        type="button"
        className={styles['attrRow']}
        aria-label="Owner"
        onClick={() => setOwnerPickerOpen(true)}
      >
        <span className={styles['label']}>Owner</span>
        <span className={styles['attrValue']}>
          <span className={styles['attrText']}>
            {owner.type === 'shared'
              ? 'Shared'
              : personLabel(state, owner.personId)}
          </span>{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>

      {/* `None` holds HOME's `Loose` and OWNER's `Shared` position. Chips
          inline are gear detail's shape, where tags are the settled subject;
          here the row shape is established twice over by the two rows above,
          and a third shape in the same block would be the drift. */}
      <button
        type="button"
        className={styles['attrRow']}
        aria-label="Tags"
        onClick={() => setTagsOpen(true)}
      >
        <span className={styles['label']}>Tags</span>
        <span className={styles['attrValue']}>
          <span className={styles['attrText']}>
            {tags.length === 0
              ? 'None'
              : tags.map((tag) => `#${tag}`).join(' ')}
          </span>{' '}
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

      {/* No failure state: every op is local and durable-first, appended to
          the same log in the same submit — as true of the N+1 ops a tagged
          record writes as it was of one.

          Centred, because it follows its CTA block, and that block is the
          full-width primary above it (boards' README §5). The two field-level
          fact lines above stay flush left: the board moves only this one. */}
      <p className={`${styles['fact']} ${styles['ctaFact']}`}>
        RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND
      </p>

      {ownerPickerOpen && (
        <OwnerPicker
          value={owner}
          onPicked={(next) => {
            setOwner(next)
            setOwnerPickerOpen(false)
          }}
          onClose={() => setOwnerPickerOpen(false)}
        />
      )}

      {tagsOpen && (
        <TagPicker
          mode="gear"
          vocabulary={vocabulary}
          applied={tags}
          onApply={(tag) => {
            // Already normalised by the picker — `normalizeTag` here is what
            // turns that string back into the `TagString` the draft holds,
            // and it is the one place that conversion happens.
            const value = normalizeTag(tag)
            if (value === null) return
            setTags((current) =>
              current.includes(value) ? current : [...current, value],
            )
          }}
          onRemove={(tag) => {
            const value = normalizeTag(tag)
            if (value === null) return
            setTags((current) => current.filter((held) => held !== value))
          }}
          onClose={() => setTagsOpen(false)}
        />
      )}

      {pickerOpen && (
        <HomePicker
          onClose={() => setPickerOpen(false)}
          onPicked={(residence) => {
            setHome(residence.in === 'loose' ? undefined : residence)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
