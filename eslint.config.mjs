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
