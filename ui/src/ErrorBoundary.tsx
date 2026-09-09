import { Component, type ErrorInfo, type ReactNode } from 'react'

import styles from './ErrorBoundary.module.css'

/**
 * The crash fallback — `frontend-design.md` §5's component of that name, and
 * §6's *Component crash* row. Drawn since the frontend design was written and
 * built here; until it existed, `main.tsx` mounted `<App/>` bare and one
 * card's render error was a white page for the whole app.
 *
 * ## What it says, and what it deliberately does not
 *
 * No board draws a crashed card, so the copy is code-authored and recorded as
 * such (`docs/design/README.md` §16). It is two sentences and one control:
 * what happened, that the log is safe, and a way to try again. The reassurance
 * is a **fact, not comfort** — writes are durable-first (`patterns.md` §2.2),
 * so an op is in IndexedDB before any component renders anything about it, and
 * a render crash cannot take one with it.
 *
 * The report beneath is collapsed, because a stack trace is not what a
 * Quartermaster mid-sitting needs and is exactly what the maintainer needs
 * afterwards. It carries **both** stacks: `error.stack`, which is minified in
 * production and maps back through the source maps the build emits
 * (`app/vite.config.ts`), and React's own component stack, which names the
 * screen and is legible with no map at all — `keepNames` is set for it.
 * `BUILD <sha>` is what pins a stack to the bundle it came from, and is the
 * reason `buildSha` is a prop: `ui/` imports nothing of the app's
 * (`patterns.md` §5.1), `app/src/build.ts` included.
 *
 * ## The retry is honest
 *
 * Clearing the state re-renders the same children. A deterministic crash
 * crashes again and the fallback comes straight back — which is the truthful
 * behaviour, and why the copy names reloading as the second move rather than
 * promising the first one works. The boundary is not a repair; it is a place
 * to stand.
 *
 * A boundary must not be a trap either, which is the caller's half: the screen
 * boundary in `AppShell` is keyed on the location, so leaving a broken screen
 * always clears it.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5).
 */
export interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * The build's identity, drawn in the report. A prop rather than an import
   * because `ui/` may not read `app/src/build.ts` — and because the landing
   * page, which renders these components against fixtures, has its own.
   */
  buildSha: string
  /**
   * Names what failed, in the console line only — `the screen`, `a panel`.
   * Never drawn: the fallback stands where the thing it replaced was, so the
   * reader can already see which part is missing, and a screen-shaped noun in
   * a panel-shaped card is how that goes wrong.
   */
  label?: string
  /**
   * **The scope decides the noun, the vessel and the control** (§5n K1/K1b).
   *
   * `inline` is the default and is what a screen or a panel boundary wears:
   * the fallback stands in the box the crashed thing occupied, so the
   * placement states the scope and one sentence is true of both — a screen
   * with the nav beside it and a panel with its sibling beside it are each
   * *a part* that could not be drawn.
   *
   * `page` is the root boundary's, and at that scope the same sentence is
   * **false**: there is no whole with other parts standing and no shell. So
   * it names the app, drops the body's first clause (there is no *try again*
   * left to offer), takes the sign-in shell's centred column on `bg/base`
   * rather than a card — a card implies a page around it — and its control
   * reloads rather than retries.
   */
  variant?: 'inline' | 'page'
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

const EMPTY: ErrorBoundaryState = {
  error: null,
  componentStack: null,
  copied: false,
}

/**
 * Anything can be thrown, and a `throw 'the outbox is gone'` must not become a
 * report with no message in it. Normalising once here is what lets every
 * reader below assume a name and a message.
 */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown))
}

/**
 * One string, built once and used twice — drawn in the `<pre>`, copied by the
 * control, and logged verbatim. Two spellings of a crash report is two
 * spellings to read six months later.
 */
function report(
  error: Error,
  componentStack: string | null,
  buildSha: string,
): string {
  // `error.stack` normally opens with `Name: message`; the fallback covers an
  // engine that gives no stack at all.
  const head = error.stack ?? `${error.name}: ${error.message}`
  const component =
    componentStack === null ? null : `COMPONENT STACK${componentStack}`
  return [head, component, `BUILD ${buildSha}`]
    .filter((part) => part !== null)
    .join('\n\n')
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = EMPTY

  static getDerivedStateFromError(
    thrown: unknown,
  ): Partial<ErrorBoundaryState> {
    return { error: asError(thrown), copied: false }
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    const error = asError(thrown)
    this.setState({ componentStack: info.componentStack ?? null })
    // React logs the error itself; this line is the *report* — one greppable
    // string carrying both stacks and the build, so a console handed over
    // from a device is enough on its own.
    console.error(
      `crash: ${this.props.label ?? 'the app'} could not be drawn`,
      report(error, info.componentStack ?? null, this.props.buildSha),
    )
  }

  private readonly retry = (): void => {
    this.setState(EMPTY)
  }

  private readonly copy = (): void => {
    const { error, componentStack } = this.state
    if (error === null) return
    void navigator.clipboard
      ?.writeText(report(error, componentStack, this.props.buildSha))
      .then(() => {
        this.setState({ copied: true })
      })
      .catch(() => {
        // A refused clipboard is not worth a second failure state on a screen
        // that is already reporting one; the text stays selectable.
      })
  }

  /**
   * Reloading is the page scope's move: re-rendering the same children is
   * what `Try again` does, and at this scope it is the one least likely to
   * work. `location.reload()` asks `ui/` for no router import (§5.1).
   */
  private readonly reload = (): void => {
    globalThis.location.reload()
  }

  override render(): ReactNode {
    const { error, componentStack, copied } = this.state
    if (error === null) return this.props.children

    const page = this.props.variant === 'page'

    return (
      <section
        className={styles['fallback']}
        data-variant={page ? 'page' : 'inline'}
        /* The one stable hook a caller's stylesheet can match on: a CSS
           module's class name is hashed, and `ui/`'s is not the app's to
           name. `TripPanels` uses it to keep the fallback's own card from
           being drawn inside the panel row's. */
        data-error-boundary=""
        role="alert"
      >
        <h2 className={styles['title']}>
          {page
            ? 'foerier could not be drawn.'
            : 'This part could not be drawn.'}
        </h2>
        <p className={styles['line']}>
          {page
            ? 'The ledger is saved on this device. Reload the app.'
            : 'The ledger is saved on this device. Try again, or reload the app.'}
        </p>
        <button
          type="button"
          className={styles['retry']}
          onClick={page ? this.reload : this.retry}
        >
          {page ? 'Reload' : 'Try again'}
        </button>
        <details className={styles['details']} data-testid="error-report">
          <summary className={styles['summary']}>TECHNICAL DETAILS</summary>
          <pre className={styles['report']} data-testid="error-report-text">
            {report(error, componentStack, this.props.buildSha)}
          </pre>
          {navigator.clipboard !== undefined && (
            <button
              type="button"
              className={styles['copy']}
              onClick={this.copy}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </details>
      </section>
    )
  }
}
