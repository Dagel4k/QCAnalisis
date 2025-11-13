#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

// Reutiliza el generador del paquete consumidor si existe; si no, usa interno
function runLocalOrInternal() {
  const cwd = process.cwd();
  const localGen = path.join(cwd, 'scripts', 'generate-eslintrc.js');
  if (require('fs').existsSync(localGen)) {
    const r = spawnSync(process.execPath, [localGen, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status || 0);
  } else {
    // Fallback: generador mínimo embebido
    const { writeFileSync } = require('fs');
    const out = `module.exports = {\n  parser: '@typescript-eslint/parser',\n  parserOptions: { project: 'tsconfig.json', sourceType: 'module' },\n  plugins: ['@typescript-eslint/eslint-plugin','sonarjs','unicorn','import'],\n  extends: [\n    'plugin:@typescript-eslint/recommended',\n    'plugin:@typescript-eslint/recommended-requiring-type-checking',\n    'plugin:sonarjs/recommended',\n    'plugin:unicorn/recommended',\n    'plugin:import/recommended',\n    'plugin:import/typescript'\n  ],\n  rules: { 'complexity': ['error', 10] }\n};\n`;
    writeFileSync(path.join(cwd, '.eslintrc.js'), out, 'utf8');
    console.log('Generated minimal .eslintrc.js');
  }
}

runLocalOrInternal();

