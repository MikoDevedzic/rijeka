import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'e2e/.out']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // A relative "/api/…" resolves against the page's own host; on the hosted app that is the static host, which
      // answers with the HTML shell. Call the API through lib/api.js (apiFetch) or with the API constant.
      // Every way of writing it: fetch or window.fetch, a literal, a template, a concatenation ('/api/x/' + id).
      'no-restricted-syntax': ['error',
        ...[":matches(CallExpression[callee.name='fetch'], CallExpression[callee.property.name='fetch'])"].flatMap(call => [
          { selector: `${call} > Literal.arguments:first-child[value=/^\\/(api|auth)\\//]`, message: 'Relative API path: use apiFetch from lib/api.js (the page host is not the API).' },
          { selector: `${call} > TemplateLiteral.arguments:first-child > TemplateElement:first-child[value.raw=/^\\/(api|auth)\\//]`, message: 'Relative API path: use apiFetch from lib/api.js (the page host is not the API).' },
          // a concatenation whose first piece is the path ('/api/x/' + id, up to three joins); API + '/api/x' is the right form and passes
          ...['', ' > BinaryExpression.left', ' > BinaryExpression.left > BinaryExpression.left'].map(chain => (
            { selector: `${call} > BinaryExpression.arguments:first-child${chain} > Literal.left[value=/^\\/(api|auth)\\//]`, message: 'Relative API path: use apiFetch from lib/api.js (the page host is not the API).' })),
        ]),
      ],
    },
  },
  // The browser journeys and their config run in Node under Playwright: Node globals, and Playwright's fixture
  // callback is named `use`, which is not a React hook.
  {
    files: ['playwright.config.js', 'e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'react-hooks/rules-of-hooks': 'off', 'react-refresh/only-export-components': 'off' },
  },
])
