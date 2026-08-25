import * as esbuild from 'esbuild'

/**
 * Bundles the server to single files for the container image.
 *
 * Bundling rather than shipping `node_modules` is what lets the runtime stage
 * of the Dockerfile be `node:24-alpine` plus a directory, and it is also what
 * makes the source-exporting workspace layout work: `@foerier/shared` resolves
 * to raw TypeScript, and esbuild compiles it in like any other module, so
 * there is no build ordering between packages.
 */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // `pg` is CommonJS and calls `require` internally; bundling it into ESM
  // leaves those calls without a definition unless one is reintroduced.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Optional native bindings for `pg` that we neither install nor want.
  external: ['pg-native'],
}

/** The server itself. */
await esbuild.build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
})

/**
 * The Maintainer bootstrap, as a second entrypoint.
 *
 * It ships in the image because the database it writes to is reachable only
 * from inside the deployment — there is no public port and no intent to open
 * one. `auth-design.md` §3.4 defines the Maintainer as whoever has server
 * access, so the script belongs where the server is; without this it could
 * only ever create Households in a developer's local Postgres.
 *
 * Running it in the image is also what makes the join link correct by
 * construction: the image sets NODE_ENV=production, and that is the flag the
 * script reads to decide which origin to print. A link printed against the
 * wrong origin fails as a passkey ceremony the browser refuses for an RP ID
 * mismatch, which reads as a bug rather than as a wrong URL.
 */
await esbuild.build({
  ...shared,
  entryPoints: ['src/admin/bootstrap.ts'],
  outfile: 'dist/bootstrap.js',
})
