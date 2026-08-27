import { foldText } from './text.ts'

/**
 * `TagString` and the one function that makes one — the **strict** half of
 * `sync-protocol.md` §4.3's tag rule. Its counterpart is `reduce.ts`, which
 * reads a tag with plain `readString` and folds whatever arrives.
 *
 * ## The rule, and who it binds
 *
 * A conforming tag is **lowercase `[a-z0-9-]`, 1–40 characters**, stored
 * **without** the leading `#` that every screen draws.
 *
 * **Authoring normalises; readers never enforce.** §5's tolerant-reader
 * discipline is absolute and outranks this rule: a tag that does not conform
 * is folded exactly as received, never rejected, never rewritten, and never
 * dropped. An installed PWA may hold ops queued offline against an earlier
 * normalisation, and rejecting them would discard a Quartermaster's work to
 * enforce a cosmetic rule. Two spellings of one intent are therefore two
 * registers that both fold — which is precisely why the defence is the picker
 * at authoring time and not a check at the boundary.
 *
 * ## Why the type is branded
 *
 * There is **no Tag entity and no rename op, by design**
 * (`docs/design/README.md` §4a), so a misspelling is corrected only by
 * removing it and applying the right one. That makes the picker the only
 * place a spelling is ever decided, and {@link normalizeTag} the only place
 * the picker's rule is applied.
 *
 * The brand is what makes "only" structural rather than aspirational: a raw
 * string is not assignable to {@link TagString}, so `gearTagApplied` cannot
 * be handed one, and every authoring path in the app is forced through this
 * module. It costs nothing at runtime — a `TagString` *is* a string, and
 * behaves as one everywhere.
 *
 * A test that deliberately wants a **non**-conforming tag — proving the
 * tolerant reader — hand-shapes an `OpSpec` rather than reaching a builder,
 * which is exactly right: such a test stands in for an op authored by a
 * different build, and it should not be able to use ours.
 */

declare const tagBrand: unique symbol

/**
 * A tag that has been through {@link normalizeTag}: lowercase `[a-z0-9-]`,
 * 1–40 characters, no `#`. The brand is phantom — this is a `string` at
 * runtime and at every use site.
 */
export type TagString = string & { readonly [tagBrand]: 'TagString' }

/** `sync-protocol.md` §4.3. Anchored, so it tests the whole string. */
export const TAG_PATTERN = /^[a-z0-9-]{1,40}$/

/** `sync-protocol.md` §4.3: 1–40 characters. */
export const TAG_MAX_LENGTH = 40

/** Trims the hyphens a collapse or a truncation can leave at either end. */
function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '')
}

/**
 * Normalises anything a human typed into a conforming tag, or `null` when
 * nothing conforming survives.
 *
 * The steps, in order, and each one is load-bearing:
 *
 * 1. **Fold** — case down, and diacritics away via `text.ts`'s `foldText`,
 *    the same fold `selectors/find.ts` applies to a search query. A household
 *    that owns a `Hütte` kit gets `hutte`, not `htte`.
 * 2. **Whitespace runs become one hyphen.** The design's own rule; leading
 *    and trailing whitespace is trimmed first so it does not become one.
 * 3. **Anything outside the charset is dropped.** This is what strips a typed
 *    `#` — at any position, however many — so `##winter` is unreachable
 *    without a rule of its own.
 * 4. **Hyphen runs collapse to one**, because step 3 can leave two adjacent
 *    where it dropped what sat between them.
 * 5. **Truncate to {@link TAG_MAX_LENGTH}**, then trim hyphens **again**: a
 *    cut lands mid-word as readily as not, and a tag must never end in the
 *    hyphen the cut happened to leave behind.
 *
 * Idempotent by construction — a conforming tag survives every step
 * unchanged — which matters because the picker normalises on every keystroke.
 */
export function normalizeTag(input: string): TagString | null {
  const collapsed = foldText(input.trim()).replace(/\s+/g, '-')
  const charset = collapsed.replace(/[^a-z0-9-]/g, '')
  const hyphens = trimHyphens(charset.replace(/-+/g, '-'))
  const tag = trimHyphens(hyphens.slice(0, TAG_MAX_LENGTH))
  return tag === '' ? null : (tag as TagString)
}
