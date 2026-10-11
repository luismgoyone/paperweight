import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Spec §2/§8: nothing is persisted and nothing is sent anywhere.
const PRIVACY = 'Privacy (spec §8): nothing may be persisted or sent off-device.';
const ABSOLUTE_URL = '/^([a-z][a-z0-9+.-]*:|\\/\\/)/i';

const privacyRules = {
  'no-restricted-globals': [
    'error',
    { name: 'localStorage', message: PRIVACY },
    { name: 'sessionStorage', message: PRIVACY },
    { name: 'indexedDB', message: PRIVACY },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'localStorage', message: PRIVACY },
    { object: 'window', property: 'sessionStorage', message: PRIVACY },
    { object: 'window', property: 'indexedDB', message: PRIVACY },
    { object: 'self', property: 'indexedDB', message: PRIVACY },
    { object: 'globalThis', property: 'indexedDB', message: PRIVACY },
    { object: 'document', property: 'cookie', message: PRIVACY },
    { object: 'navigator', property: 'sendBeacon', message: PRIVACY },
    { object: 'navigator', property: 'serviceWorker', message: PRIVACY },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: `CallExpression[callee.name='fetch'] > Literal.arguments:first-child[value=${ABSOLUTE_URL}]`,
      message: PRIVACY,
    },
    {
      selector: `CallExpression[callee.name='fetch'] > TemplateLiteral.arguments:first-child > TemplateElement:first-child[value.raw=${ABSOLUTE_URL}]`,
      message: PRIVACY,
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'docs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: { ...reactHooks.configs.recommended.rules, ...privacyRules },
  },
  {
    files: ['src/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/ui/**', '**/editor/**', 'react', 'react-dom', 'zustand'] },
      ],
    },
  },
  {
    files: ['src/ui/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['mupdf'], patterns: ['**/engine/**'] }],
    },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
