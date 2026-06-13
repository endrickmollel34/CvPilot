/** @type {import('eslint').Linter.Config} */
module.exports = {
  ...require('./index'),
  env: {
    node: true,
    jest: true,
  },
  rules: {
    ...require('./index').rules,
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
