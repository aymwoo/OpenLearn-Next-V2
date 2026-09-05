import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-unsafe-optional-chaining': 'warn',
      'preserve-caught-error': 'warn',
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
  {
    // Node-context scripts (.mjs/.cjs at repo root, e.g. the published bin cli.mjs)
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'plugins/**',
      'storage/**',
      '.venv/**',
      'venv/**',
      'node_modules/**',
      '**/node_modules/**',
      'docs/_build/**',
      'packages/mfe-*/dist/**',
      'packages/mfe-*/node_modules/**',
      'packages/core/esm-loader/__tests__/fixtures/**',
      'packages/plugin-sdk/scaffold/templates/**',
      'scratch/**',
      'artifacts/**',
      '*.cjs',
      '*.min.js',
    ],
  },
];
