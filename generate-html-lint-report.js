const fs = require('fs');
const path = require('path');
const { Analyzer } = require('./lib/analyzer');
const { HtmlGenerator } = require('./lib/html-generator');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    globs: undefined,
    ignore: [],
    output: 'reports'
  };

  // Parse flags to match the expected Env vars or CLI flags
  // The previous script largely relied on ENV vars, but we respect the CLI args too
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--globs' && i + 1 < args.length) opts.globs = args[++i];
    else if (args[i] === '--ignore' && i + 1 < args.length) opts.ignore = args[++i].split(',');
    else if (args[i] === '--output' && i + 1 < args.length) opts.output = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.output)) {
    fs.mkdirSync(opts.output, { recursive: true });
  }

  // Load configuration from Env Vars (backward compatibility with "God Script")
  const analyzerOpts = {
    cwd: process.cwd(),
    globs: opts.globs,
    ignore: opts.ignore,
    forceInternalEslint: process.env.REPORT_USE_INTERNAL_ESLINT_CONFIG === '1',
    noTsPrune: process.env.REPORT_NO_TSPRUNE === '1' || process.argv.includes('--no-ts-prune'),
    noJscpd: process.env.REPORT_NO_JSCPD === '1' || process.argv.includes('--no-jscpd'),
    noSecretScan: process.env.REPORT_NO_SECRET_SCAN === '1' || process.argv.includes('--no-secret-scan'),
    noOsv: process.env.REPORT_NO_OSV === '1',
    noSemgrep: process.env.REPORT_NO_SEMGREP === '1',
    noGitleaks: process.env.REPORT_NO_GITLEAKS === '1'
  };

  console.log('[Main] Starting modular analysis...');
  const analyzer = new Analyzer(analyzerOpts);

  try {
    // 1. Run Analysis
    const data = await analyzer.run();

    // 2. Save JSON
    const jsonPath = path.join(opts.output, 'lint-summary.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    console.log(`[Main] JSON Report saved to ${jsonPath}`);

    // 3. Generate HTML
    console.log('[Main] Generating HTML report...');
    const generator = new HtmlGenerator({ cwd: process.cwd() });
    const htmlContent = await generator.generate(data);

    const htmlPath = path.join(opts.output, 'lint-report.html');
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`[Main] HTML Report saved to ${htmlPath}`);

  } catch (error) {
    console.error('[Main] Failed:', error);
    process.exit(1);
  }
}

main();
