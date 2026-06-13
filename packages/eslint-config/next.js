/** @type {import('eslint').Linter.Config} */
module.exports = {
  ...require('./index'),
  extends: [...require('./index').extends, 'next/core-web-vitals', 'next/typescript'],
  rules: {
    ...require('./index').rules,
    '@next/next/no-html-link-for-pages': 'error',
  },
};
