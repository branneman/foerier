import { Route, Switch } from 'wouter'

import { AppShell } from './shell/AppShell'
import styles from './shell/AppShell.module.css'

/**
 * An empty depot, honestly stated.
 *
 * The skeleton has no op log yet, so there is nothing to read and nothing to
 * pretend about. The ledger voice does not cheerlead
 * (`docs/design/README.md`, Voice).
 */
function EmptyState({ title, line }: { title: string; line: string }) {
  return (
    <div className={styles['emptyState']}>
      <h1>{title}</h1>
      <p>{line}</p>
    </div>
  )
}

export function App() {
  return (
    <AppShell>
      <Switch>
        <Route path="/">
          <EmptyState title="Depot" line="Nothing recorded yet." />
        </Route>
        <Route path="/trips">
          <EmptyState title="Trips" line="No trips." />
        </Route>
        <Route path="/find">
          <EmptyState title="Find" line="Nothing to search yet." />
        </Route>
        <Route>
          <EmptyState title="Not found." line="No such page." />
        </Route>
      </Switch>
    </AppShell>
  )
}
