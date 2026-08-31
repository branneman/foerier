import { PersonCircle, type PersonCircleProps } from './PersonCircle'
import styles from './PersonCluster.module.css'

/**
 * One entry in a cluster. Deliberately not a `Person` — `ui/` never imports
 * the store — so `key` is whatever the caller identifies a Person or a piece
 * by (a Person id today; a piece id once Task 8 folds in), and `label`/`tone`
 * pass straight through to the `PersonCircle` this entry draws as.
 */
export interface PersonClusterEntry {
  key: string
  label?: string | undefined
  tone?: PersonCircleProps['tone']
}

/**
 * **Ruling E** (`docs/design/README.md` §5d E) — no board draws more than
 * three participants, and nothing in the domain caps a roster at three, so a
 * six-Person household (grandparents along) was never drawn at all. Four
 * painted slots is the answer: `people.length <= 4` draws every circle
 * whole; past that, the first three of the ordered list plus one `+N`
 * circle — `PersonCircle` itself, `tone="control"`, `label={"+" + n}`. It is
 * the same circle with different content, not a variant, which is exactly
 * why `PersonCircle`'s prop is named `label` and not `initial`: an `initial`
 * prop would have nowhere honest to put a count.
 *
 * **Dashed (excluded) entries sort to the front, ahead of everything else,
 * before the four-slot cut is taken.** Inclusion is the default and
 * exclusion is the signal — a Person drawn `dashed` is the one fact on the
 * row worth a Quartermaster's attention — so the exception can never be the
 * circle truncation hides behind `+N`. The partition is **stable**: dashed
 * entries keep the relative order they arrived in, and so does everyone
 * else; nothing here re-sorts by name or any other key. `×N` beside the
 * cluster is the caller's own exact count (this component draws no digit
 * beyond `+N`), so a Quartermaster who wants the full roster gets it from
 * the picker the cluster opens — truncation loses no fact, only paint.
 *
 * **One `role="img"` over the whole cluster, and this component owns it.**
 * The `label` prop is the accessible name — every one of S8's four callers
 * used to render its own `<span role="img" aria-label="…">` around a bare
 * row of `PersonCircle`s; this takes that span over, so a caller passes the
 * same label text it always composed and drops the wrapper. Individual
 * circles stay unlabelled leaves under it, exactly as they were: initials
 * read out one at a time are as easily a stray alphabet as a roster.
 *
 * **This element is the flex row**, not a wrapper around one — no extra
 * `<span>` between it and the `PersonCircle`s, for the layout-shift reason
 * `PersonCircle`'s own docstring already gives for not wrapping *those*: an
 * unstyled ancestor blockifies into a line box a few px taller than the
 * circles it holds. `flex: none` on the row itself and on every circle
 * inside it (`PersonCircle`'s own rule) is what makes "never shrink below
 * the drawn size" true without a CSS floor to fight; no `flex-wrap` and no
 * `overflow` is what makes "never wrap, never inner-scroll" true — the cap
 * is enforced by capping the count, not by squeezing what is drawn.
 */
export interface PersonClusterProps {
  /** The roster, in arrival order — see the dashed-sorts-first note above. */
  people: readonly PersonClusterEntry[]
  /** 22 · 24 · 30 — passed straight through to every `PersonCircle`. */
  size: PersonCircleProps['size']
  /** The cluster's accessible name, rendered as this element's `aria-label`. */
  label: string
}

export function PersonCluster({ people, size, label }: PersonClusterProps) {
  const dashed = people.filter((person) => person.tone === 'dashed')
  const rest = people.filter((person) => person.tone !== 'dashed')
  const ordered = [...dashed, ...rest]

  const visible = ordered.length <= 4 ? ordered : ordered.slice(0, 3)
  const overflow = ordered.length > 4 ? ordered.length - 3 : 0

  return (
    <span className={styles['cluster']} role="img" aria-label={label}>
      {visible.map((person) => (
        // `tone` is spread rather than passed as `tone={person.tone}`:
        // `PersonCircleProps['tone']` has no explicit `| undefined` (unlike
        // `label`), so under `exactOptionalPropertyTypes` an *omitted* prop
        // and a prop *present and `undefined`* are different types — passing
        // it straight through would fail even though both mean "default to
        // `control`".
        <PersonCircle
          key={person.key}
          label={person.label}
          size={size}
          {...(person.tone === undefined ? {} : { tone: person.tone })}
        />
      ))}
      {overflow > 0 && (
        <PersonCircle label={`+${overflow}`} size={size} tone="control" />
      )}
    </span>
  )
}
