#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';

import { AnalysisOrchestrator, OrchestratorOptions } from '../lib/orchestrator';
import { loadEnvFromFile } from '../lib/utils';
// Scanners
import { KnipScanner } from '../lib/scanners/knip.scanner';
import { SemgrepScanner } from '../lib/scanners/semgrep.scanner';
import { GitleaksScanner } from '../lib/scanners/gitleaks.scanner';
import { OsvScanner } from '../lib/scanners/osv.scanner';
import { JscpdScanner } from '../lib/scanners/jscpd.scanner';
import { EslintScanner } from '../lib/scanners/eslint.scanner';

const { version } = require('../package.json');

// Preload .env
(function preloadDotEnv() {
  const idx = process.argv.indexOf('--env-file');
  let envFile = idx !== -1 ? process.argv[idx + 1] : process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env');
  loadEnvFromFile(envFile);
})();

const program = new Command();

program
  .name('review-gitlab-branches')
  .description('Automated Code Analysis & Review Tool')
  .version(version);

program
  .requiredOption('--repo <url>', 'Git repository URL')
  .option('--branches <list>', 'Comma-separated list of branches to scan', (val: string) => val.split(','))
  .option('--work-dir <path>', 'Working directory for clones', '.work')
  .option('--reports-dir <path>', 'Output directory for reports', 'reports')
  .option('--concurrency <number>', 'Number of concurrent tasks', '2')
  .option('--no-cleanup', 'Disable cleanup of working directory')
  .option('--ignore <list>', 'Comma-separated patterns to ignore', (val: string) => val.split(','))
  .option('--globs <patterns>', 'Glob patterns for source files')
  // GitLab
  .option('--gitlab-base <url>', 'GitLab Base URL')
  .option('--gitlab-token <token>', 'GitLab Personal Access Token')
  .option('--from-gitlab-mrs', 'Fetch open MRs from GitLab')
  .option('--from-gitlab-branches', 'Fetch branches from GitLab')
  .option('--mr-labels <list>', 'Filter MRs by labels', (val: string) => val.split(','))
  // Analysis
  .option('--depth <number>', 'Clone depth', '1')
  // Scanners
  .option('--no-jscpd', 'Disable Copy/Paste detection')
  .option('--no-secret-scan', 'Disable Secret scanning')
  .option('--no-osv', 'Disable Vulnerability scanning')
  .option('--no-semgrep', 'Disable Semgrep scanning')
  .option('--no-gitleaks', 'Disable Gitleaks')
  .option('--no-knip', 'Disable Knip')
  .action(async (opts: any) => {
    console.log(`[CLI] Starting analysis for ${opts.repo}`);

    // Instantiate Scanners (Composition Root)
    const scanners = [
      new EslintScanner(),
      new KnipScanner(),
      new SemgrepScanner(),
      new GitleaksScanner(),
      new OsvScanner(),
      new JscpdScanner()
    ];

    const options: OrchestratorOptions = {
      repo: opts.repo,
      branches: opts.branches,
      workDir: path.resolve(opts.workDir),
      reportsDir: path.resolve(opts.reportsDir),
      concurrency: parseInt(opts.concurrency, 10),
      cleanup: opts.cleanup,
      gitlabBase: opts.gitlabBase || process.env.GITLAB_BASE,
      gitlabToken: opts.gitlabToken || process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN,
      depth: opts.depth ? parseInt(opts.depth, 10) : 1,
      ignore: opts.ignore,
      globs: opts.globs ? [opts.globs] : undefined,
      mrLabels: opts.mrLabels,
      // Scanners
      scanners: scanners,
      // Flags
      noJscpd: opts.jscpd === false,
      noSecretScan: opts.secretScan === false,
      noOsv: opts.osv === false,
      noSemgrep: opts.semgrep === false,
      noGitleaks: opts.gitleaks === false,
      noKnip: opts.knip === false,
      fromGitlabMrs: opts.fromGitlabMrs
    };

    const orchestrator = new AnalysisOrchestrator(options);

    orchestrator.on('task:start', (t) => console.log(`[CLI] Processing: ${t.slug}`));
    orchestrator.on('task:complete', (r) => console.log(`[CLI] Finished: ${r.task.slug}`));
    orchestrator.on('task:error', (r) => console.error(`[CLI] Error: ${r.task.slug} - ${r.error}`));
    orchestrator.on('error', (e) => console.error(`[CLI] Orchestrator Fatal: ${e.message}`));

    try {
      await orchestrator.run();
    } catch (e) {
      process.exit(1);
    }
  });

program.parse(process.argv);
