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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-unsafe-optional-chaining': 'warn',
      'preserve-caught-error': 'warn',
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'warn',
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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
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
      '**/.venv/**',
      'venv/**',
      '**/venv/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/.__mf__temp/**',
      'docs/_build/**',
      'packages/mfe-*/dist/**',
      'packages/mfe-*/node_modules/**',
      'packages/core/esm-loader/__tests__/fixtures/**',
      'packages/plugin-sdk/scaffold/templates/**',
      'scratch/**',
      'artifacts/**',
      // 覆盖率报告是生成物（.gitignore 已忽略）。漏掉这里会让「本地跑过 --coverage
      // 再跑 check-lint-budget」凭空多出 1 条告警（coverage/block-navigation.js）——
      // 棘轮只许往下，那条假告警会把人挡在 CI 门外，而 CI 上根本没有 coverage/。
      'coverage/**',
      'v2_plugins/**',
      // Vite 依赖预打包缓存（见 vite.config.ts 的 cacheDir）。跑过 dev server 就会生成，
      // 是纯生成物且已进 .gitignore —— 不忽略它，本地跑过 dev 之后 ESLint 的文件集合
      // 与 CI 就不再是同一份，告警预算棘轮会凭空多出噪音。
      '.vite-cache/**',
      // Qoder/Cursor 一类 IDE 的工作区快照目录（`.gitignore` L68 已忽略）。
      // 里面的 worktree 副本是整棵源码树的拷贝，实测在本机贡献 6,226 条告警
      // （占全仓 12,466 条的 50%），把 ESLint 告警预算棘轮从 6,237 顶到 12,477 ——
      // 本地门禁直接不可用，而 CI 上根本不存在这个目录。
      '.qoder/**',
      '*.cjs',
      '*.min.js',
      '**/*.min.js',
    ],
  },
];
