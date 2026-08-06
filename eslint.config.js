// Root ESLint flat config — used by lint-staged on pre-commit.
// ESLint v9 requires flat config; legacy .eslintrc.* format is not supported.
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**', '**/coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Disabled in root config: NestJS DI (apps/api) requires value imports for constructor-injected
      // classes so TypeScript emits design:paramtypes correctly. Each workspace enforces its own
      // import style via its local eslint.config.js and turbo lint.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
