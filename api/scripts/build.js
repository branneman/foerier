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
 * The three Maintainer scripts, as further entrypoints.
 *
 * They ship in the image because the database they act on is reachable only
 * from inside the deployment — there is no public port and no intent to open
 * one. `auth-design.md` §3.4 defines the Maintainer as whoever has server
 * access, so the scripts belong where the server is; without this they could
 * only ever run against a developer's local Postgres, and in production
 * there would be no way to mint the first Login of a Household, find an
 * existing one's id, or issue the one break-glass device link that gets a
 * locked-out Maintainer back in.
 *
 * Running them in the image is also what makes each one correct by
 * construction rather than merely present: the image sets NODE_ENV=production,
 * and that is the flag every script reads both to decide which origin a
 * printed link defaults to and to choose its own usage string. A link printed
 * against the wrong origin fails as a passkey ceremony the browser refuses
 * for an RP ID mismatch, which reads as a bug rather than as a wrong URL; a
 * usage string naming the local `npm run` invocation, printed to someone who
 * only has a shell inside the container, is a dead end.
 */
for (const [entryPoint, outfile] of Object.entries({
  'src/admin/bootstrap.ts': 'dist/bootstrap.js',
  'src/admin/invite.ts': 'dist/invite.js',
  'src/admin/list.ts': 'dist/list.js',
})) {
  await esbuild.build({ ...shared, entryPoints: [entryPoint], outfile })
}
