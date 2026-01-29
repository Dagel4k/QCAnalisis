#!/usr/bin/env node
// proxy para que funcione con ts-node
require('ts-node').register({ transpileOnly: true });
require('./generate-html-lint-report.ts');
