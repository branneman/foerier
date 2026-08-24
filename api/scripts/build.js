import * as esbuild from 'esbuild'

/**
 * Bundles the server to a single file for the container image.
 *
 * Bundling rather than shipping `node_modules` is what lets the runtime stage
 * of the Dockerfile be `node:24-alpine` plus one file, and it is also what
 * makes the source-exporting workspace layout work: `@foerier/shared` resolves
 * to raw TypeScript, and esbuild compiles it in like any other module, so
 * there is no build ordering between packages.
 */
await esbuild.build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
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
})
