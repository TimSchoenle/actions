import { fixupPluginRules } from '@eslint/compat';
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import noSecrets from 'eslint-plugin-no-secrets';
import perfectionist from 'eslint-plugin-perfectionist';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Ignore patterns
  {
    ignores: ['node_modules/', 'dist/', '**/dist/', 'coverage/', '**/*.test.ts', '**/*.spec.ts', '**/src/generated/'],
  },

  // General Rules
  {
    rules: {
      curly: ['error', 'all'],
    },
  },

  // Perfectionist - sorting and ordering
  {
    plugins: {
      perfectionist,
    },
    rules: {
      'perfectionist/sort-imports': [
        'warn',
        {
          type: 'natural',
          order: 'asc',
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
        },
      ],
      'perfectionist/sort-named-imports': ['warn', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-named-exports': ['warn', { type: 'natural', order: 'asc' }],
    },
  },

  // Unicorn - modern best practices
  {
    plugins: {
      unicorn,
    },
    rules: {
      'unicorn/prefer-node-protocol': 'warn',
      'unicorn/prefer-module': 'off', // We use CommonJS in some places
      'unicorn/no-null': 'off', // GraphQL uses null
      'unicorn/filename-case': 'off', // Existing naming conventions
    },
  },

  // Security plugins
  {
    plugins: {
      'no-secrets': noSecrets,
      security: fixupPluginRules(security),
    },
    rules: {
      'no-secrets/no-secrets': ['warn', { tolerance: 4.5 }],
      'security/detect-object-injection': 'off', // False positives for safe patterns with generated keys
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'warn',
    },
  },

  // SonarJS - code quality
  {
    plugins: {
      sonarjs,
    },
    rules: {
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/prefer-immediate-return': 'warn',
    },
  },

  // Import plugin - import/export linting
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-duplicates': 'warn',
      'import/first': 'warn',
      'import/newline-after-import': 'warn',
      'import/no-mutable-exports': 'warn',
    },
  },

  // Action sources must read inputs and write outputs through the generated `action-io` module, so
  // that every name is checked against the action.yaml that declares it. Calling @actions/core
  // directly would bypass that check and reintroduce unverifiable string literals.
  {
    files: ['actions/**/src/**/*.ts', 'workflows/**/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Namespace call, e.g. `core.getInput('x')`. Restricting the import itself is not an
          // option: `no-restricted-imports` rejects the whole `* as core` namespace, and the
          // actions legitimately use it for `core.info`, `core.warning` and `core.setFailed`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(getInput|getBooleanInput|getMultilineInput|setOutput)$/]",
          message:
            "Import getInput/getBooleanInput/getMultilineInput/setOutput from './generated/action-io.js' instead of reaching into @actions/core, so the name is checked against action.yaml.",
        },
        {
          // Named import, e.g. `import { getInput } from '@actions/core'`.
          selector:
            "ImportDeclaration[source.value='@actions/core'] > ImportSpecifier[imported.name=/^(getInput|getBooleanInput|getMultilineInput|setOutput)$/]",
          message:
            "Import this from './generated/action-io.js' instead of @actions/core, so the name is checked against action.yaml.",
        },
      ],
    },
  },

  // Scripts-specific overrides
  {
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['info', 'warn', 'error', 'log'] }],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
);
