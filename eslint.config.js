import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      // Claude Code keeps its git worktrees nested at `.claude/worktrees/`,
      // so without this ESLint lints a second checkout of the whole monorepo
      // — and the pre-commit hook lints everything, not just staged files,
      // which would let a lint error on one branch block commits on another.
      '.claude/**',
      'docs/design/**',
      'examples/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Correctness only, per docs/testing.md Tier 0: unused vars, hook-dependency
  // bugs, unreachable code. Deliberately not type-aware — the rules that earn
  // their keep here do not need the type checker, and `tsc --noEmit` already
  // runs full-repo in the same hook and the same CI job.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['app/**/*.tsx', 'ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Repo tooling that runs on Node directly, outside any workspace's tsconfig.
  // `js.configs.recommended` assumes a browser, so Node's globals have to be
  // declared or `no-undef` fires on `process`.
  {
    files: ['scripts/**/*.mjs', 'api/scripts/**/*.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },

  prettier,
)
