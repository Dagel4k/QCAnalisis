import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, AnalysisResult } from './lib/analyzer';
import { HtmlGenerator } from './lib/html-generator';
import { SandboxManager } from './lib/sandbox';
import { Logger } from './lib/utils';

interface ScriptOptions {
  globs?: string;
  ignore: string[];
  output: string;
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const opts: ScriptOptions = {
    globs: undefined,
    ignore: [],
    output: 'reports'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--globs' && i + 1 < args.length) opts.globs = args[++i];
    else if (arg === '--ignore' && i + 1 < args.length) opts.ignore = args[++i].split(',');
    else if (arg === '--output' && i + 1 < args.length) opts.output = args[++i];
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (!fs.existsSync(opts.output)) {
    fs.mkdirSync(opts.output, { recursive: true });
  }

  const logger = new Logger(); // Logs to console by default

  // Load configuration from Env Vars (backward compatibility with "God Script")
  const targetDir = process.env.ANALYSIS_TARGET_DIR || process.cwd();

  const analyzerOpts = {
    cwd: targetDir,
    sandbox: new SandboxManager(targetDir, logger),
    logger: logger,
    globs: opts.globs ? [opts.globs] : undefined,
    ignore: opts.ignore,
    forceInternalEslint: process.env.REPORT_USE_INTERNAL_ESLINT_CONFIG === '1',
    // Flags for tools (assuming Analyzer supports them)
    noJscpd: process.env.REPORT_NO_JSCPD === '1' || process.argv.includes('--no-jscpd'),
    noSecretScan: process.env.REPORT_NO_SECRET_SCAN === '1' || process.argv.includes('--no-secret-scan'),
    noOsv: process.env.REPORT_NO_OSV === '1',
    noSemgrep: process.env.REPORT_NO_SEMGREP === '1',
    noGitleaks: process.env.REPORT_NO_GITLEAKS === '1',
    noKnip: false, // Default
    noDepCruiser: false // Default
  };

  console.log('[Main] Starting modular analysis...');
  const analyzer = new Analyzer(analyzerOpts);

  try {
    // 1. Run Analysis
    const data: AnalysisResult = await analyzer.run();

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
