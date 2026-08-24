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

  prettier,
)
