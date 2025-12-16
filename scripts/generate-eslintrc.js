#!/usr/bin/env node
/*
  Generador de .eslintrc.js (TypeScript-first) con opciones.

  Uso:
  node scripts/generate-eslintrc.js --preset typescript-default [--dir <ruta>] \
      [--with-sonarjs] [--with-unicorn] [--with-import]

  Por defecto todas las integraciones están activadas.
*/

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    preset: 'typescript-default',
    dir: process.cwd(),
    withSonar: true,
    withUnicorn: true,
    withImport: true,
    withSecurity: true,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--preset') opts.preset = args[++i];
    else if (a === '--dir') opts.dir = path.resolve(args[++i]);
    else if (a === '--with-sonarjs') opts.withSonar = true;
    else if (a === '--no-sonarjs') opts.withSonar = false;
    else if (a === '--with-unicorn') opts.withUnicorn = true;
    else if (a === '--no-unicorn') opts.withUnicorn = false;
    else if (a === '--with-import') opts.withImport = true;
    else if (a === '--no-import') opts.withImport = false;
    else if (a === '--with-security') opts.withSecurity = true;
    else if (a === '--no-security') opts.withSecurity = false;
  }
  return opts;
}

function generateConfig(opts) {
  if (opts.preset !== 'typescript-default') {
    throw new Error(`Preset no soportado: ${opts.preset}`);
  }

  const hasTsconfig = require('fs').existsSync(path.join(opts.dir, 'tsconfig.json'));

  const plugins = [
    "'@typescript-eslint/eslint-plugin'",
  ];
  if (opts.withSonar) plugins.push("'sonarjs'");
  if (opts.withUnicorn) plugins.push("'unicorn'");
  if (opts.withImport) plugins.push("'import'");
  if (opts.withSecurity) plugins.push("'security'");

  const extendsArr = [
    "'plugin:@typescript-eslint/recommended'",
  ];
  if (hasTsconfig) {
    extendsArr.push("'plugin:@typescript-eslint/recommended-requiring-type-checking'");
  }
  if (opts.withSonar) extendsArr.push("'plugin:sonarjs/recommended'");
  if (opts.withUnicorn) extendsArr.push("'plugin:unicorn/recommended'");
  if (opts.withImport) {
    extendsArr.push("'plugin:import/recommended'");
    extendsArr.push("'plugin:import/typescript'");
  }
  if (opts.withSecurity) extendsArr.push("'plugin:security/recommended'");

  const rules = [];
  if (opts.withSonar) {
    rules.push(
      "'sonarjs/cognitive-complexity': ['error', 15]",
      "'sonarjs/no-duplicate-string': ['error', { threshold: 3 }]",
      "'sonarjs/no-identical-functions': 'error'",
      "'sonarjs/no-redundant-boolean': 'error'",
      "'sonarjs/no-unused-collection': 'error'",
      "'sonarjs/no-useless-catch': 'error'",
      "'sonarjs/prefer-immediate-return': 'error'",
      "'sonarjs/prefer-object-literal': 'error'",
      "'sonarjs/prefer-single-boolean-return': 'error'",
    );
  }
  if (opts.withUnicorn) {
    rules.push(
      "'unicorn/no-abusive-eslint-disable': 'error'",
      "'unicorn/no-array-for-each': 'error'",
      "'unicorn/no-await-expression-member': 'error'",
      "'unicorn/no-lonely-if': 'error'",
      "'unicorn/no-useless-undefined': 'error'",
      "'unicorn/prefer-array-some': 'error'",
      "'unicorn/prefer-default-parameters': 'error'",
      "'unicorn/prefer-includes': 'error'",
      "'unicorn/prefer-optional-catch-binding': 'error'",
    );
  }
  if (opts.withImport) {
    rules.push(
      "'import/no-duplicates': 'error'",
      "'import/no-unused-modules': 'error'",
      "'import/order': ['error', { groups: ['builtin','external','internal','parent','sibling','index'], 'newlines-between': 'always', alphabetize: { order: 'asc' } }]",
    );
  }

  if (hasTsconfig) {
    rules.push(
      "'@typescript-eslint/no-unnecessary-condition': 'error'",
      "'@typescript-eslint/no-unnecessary-type-assertion': 'error'",
      "'@typescript-eslint/prefer-nullish-coalescing': 'error'",
      "'@typescript-eslint/prefer-optional-chain': 'error'",
      "'@typescript-eslint/prefer-reduce-type-parameter': 'error'",
      "'@typescript-eslint/prefer-string-starts-ends-with': 'error'",
    );
  }
  rules.push(
    "'complexity': ['error', 10]",
    "'max-depth': ['error', 3]",
    "'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }]",
    "'max-nested-callbacks': ['error', 3]",
    "'max-params': ['error', 4]",
  );

  return `module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ${hasTsconfig ? "project: 'tsconfig.json'," : ''}
    sourceType: 'module',
  },
  plugins: [
    ${plugins.join(',\n    ')}
  ],
  extends: [
    ${extendsArr.join(',\n    ')}
  ],
  rules: {
    ${rules.join(',\n    ')}
  },
};\n`;
}

function main() {
  const opts = parseArgs();
  const content = generateConfig(opts);
  const outPath = path.join(opts.dir, '.eslintrc.js');
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`.eslintrc.js generado en: ${outPath}`);
}

main();
