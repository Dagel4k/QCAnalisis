#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Modules
const { Logger, sanitizeName, loadEnvFromFile, makeRunId } = require('../lib/utils');
const { GitService } = require('../lib/git');
const { GitLabService } = require('../lib/gitlab');

// Preload ENV
(function preloadDotEnv() {
  let envFile;
  const argv = process.argv;
  const idx = argv.indexOf('--env-file');
  if (idx !== -1 && idx + 1 < argv.length) envFile = path.resolve(argv[idx + 1]);
  else if (process.env.DOTENV_PATH) envFile = path.resolve(process.env.DOTENV_PATH);
  else envFile = path.resolve(process.cwd(), '.env');
  loadEnvFromFile(envFile);
})();

class SummaryManager {
  constructor(reportsDir, opts = {}) {
    this.reportsDir = reportsDir;
    this.path = path.join(reportsDir, 'summary.json');
    this.repo = opts.repo || '';
    this.data = this._load();
  }

  _load() {
    if (fs.existsSync(this.path)) {
      try {
        const content = fs.readFileSync(this.path, 'utf-8');
        const existing = JSON.parse(content);
        return {
          repo: this.repo,
          branches: [],
          mrs: [],
          history: [],
          ...existing
        };
      } catch (e) {
        console.error(`Failed to load summary: ${e.message}`);
      }
    }
    return {
      repo: this.repo,
      branches: [],
      mrs: [],
      history: [],
      generatedAt: new Date().toISOString()
    };
  }

  save() {
    this.data.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  addRunToHistory(runId, task, status, reportPath, metrics = {}, error = null) {
    if (!this.data.history) this.data.history = [];
    this.data.history.unshift({
      id: runId,
      name: task.branch || task.sourceBranch || task.slug,
      generatedAt: new Date().toISOString(),
      status,
      reportPath,
      metrics,
      error
    });
  }

  updateTaskStatus(task, result) {
    const targetArray = task.type === 'mr' ? this.data.mrs : this.data.branches;
    const existingIdx = targetArray.findIndex(t => t.slug === task.slug || (task.branch && t.branch === task.branch));

    if (existingIdx >= 0) {
      targetArray[existingIdx] = { ...targetArray[existingIdx], ...result };
    } else {
      targetArray.push(result);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo: undefined,
    branches: [],
    workDir: path.resolve(process.cwd(), '.work'),
    reportsDir: path.resolve(process.cwd(), 'reports'),
    ignore: [],
    cleanup: true,
    depth: 1,
    gitlabToken: process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN,
    reportScript: process.env.REPORT_SCRIPT || undefined,
    installDev: process.env.INSTALL_DEV_SPEC,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo') opts.repo = args[++i];
    else if (a === '--branches') opts.branches = args[++i].split(',');
    else if (a === '--work-dir') opts.workDir = path.resolve(args[++i]);
    else if (a === '--reports-dir') opts.reportsDir = path.resolve(args[++i]);
    else if (a === '--ignore') opts.ignore = args[++i].split(',');
    else if (a === '--install-dev') opts.installDev = args[++i];
    else if (a === '--from-gitlab-mrs') opts.fromGitlabMrs = true;
    else if (a === '--from-gitlab-branches') opts.fromGitlabBranches = true;
    else if (a === '--gitlab-token') opts.gitlabToken = args[++i];
    else if (a === '--report-script') opts.reportScript = args[++i];
  }

  if (!opts.repo) {
    console.error('Missing required argument: --repo <url>');
    process.exit(1);
  }
  return opts;
}

async function runAnalysisScript(scriptPath, cwd, args, env, logFile) {
  return new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(logFile, { flags: 'a' });
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.pipe(outStream);
    child.stderr.pipe(outStream);

    child.on('close', (code) => {
      outStream.end();
      if (code === 0) resolve();
      else reject(new Error(`Analysis script failed with code ${code}`));
    });
    child.on('error', (err) => {
      outStream.end();
      reject(err);
    });
  });
}

function installDevTools(cwd, spec) {
  if (!spec) return;
  console.log(`[SETUP] Installing dev tools: ${spec}`);
  const res = spawnSync('npm', ['install', '-D', spec, '--prefer-offline', '--no-audit'], { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    console.warn('[WARN] Failed to install dev tools. Continuing anyway...');
  }
}

async function main() {
  const opts = parseArgs();
  const logger = new Logger();

  if (!fs.existsSync(opts.workDir)) fs.mkdirSync(opts.workDir, { recursive: true });
  if (!fs.existsSync(opts.reportsDir)) fs.mkdirSync(opts.reportsDir, { recursive: true });

  let reportScript = opts.reportScript || process.env.REPORT_SCRIPT_PATH;
  if (!reportScript) {
    const local = path.join(process.cwd(), 'generate-html-lint-report.js');
    if (fs.existsSync(local)) reportScript = local;
  }
  if (!reportScript) throw new Error('Could not find generate-html-lint-report.js. Please specify --report-script.');

  const gitlab = new GitLabService(opts.gitlabToken, opts.gitlabBase);
  let tasks = [];

  if (opts.branches && opts.branches.length) {
    tasks.push(...opts.branches.map(b => ({
      type: 'branch', branch: b, repoUrl: opts.repo, slug: `branch-${sanitizeName(b)}`
    })));
  }

  if (opts.fromGitlabMrs) {
    try {
      logger.log('Fetching MRs from GitLab...');
      const mrs = await gitlab.fetchOpenMergeRequests(opts.repo, { labels: opts.mrLabels });
      tasks.push(...mrs);
    } catch (e) {
      logger.error(`Failed to fetch MRs: ${e.message}`);
    }
  }

  if (tasks.length === 0) {
    logger.error('No tasks found (no branches or MRs specified/found).');
    process.exit(1);
  }

  logger.log(`Found ${tasks.length} tasks to process.`);

  const summaryManager = new SummaryManager(opts.reportsDir, { repo: opts.repo });

  for (const task of tasks) {
    const runId = makeRunId(task.slug);
    const taskReportDir = path.join(opts.reportsDir, runId);
    fs.mkdirSync(taskReportDir, { recursive: true });

    const taskLogger = new Logger(path.join(taskReportDir, 'analysis.log'));
    taskLogger.log(`Starting task: ${task.slug} (${task.repoUrl})`);

    const cloneDir = path.join(opts.workDir, `${sanitizeName(opts.repo)}-${task.slug}`);
    const git = new GitService(taskLogger);
    let taskResult = { ...task, status: 'pending' };

    try {
      let authUrl = task.repoUrl;
      if (opts.gitlabToken && /^https/i.test(task.repoUrl)) {
        const u = new URL(task.repoUrl);
        u.username = 'oauth2';
        u.password = opts.gitlabToken;
        authUrl = u.toString();
      }

      if (fs.existsSync(cloneDir)) {
        if (process.env.REUSE_CLONES === '1') {
          taskLogger.log('Reusing clone...');
        } else {
          fs.rmSync(cloneDir, { recursive: true, force: true });
          git.clone(authUrl, cloneDir, task.type === 'mr' ? task.sourceBranch : task.branch, opts.depth);
        }
      } else {
        git.clone(authUrl, cloneDir, task.type === 'mr' ? task.sourceBranch : task.branch, opts.depth);
      }

      if (opts.installDev) installDevTools(cloneDir, opts.installDev);

      taskLogger.log('Running analysis...');
      const ignoreArgs = opts.ignore && opts.ignore.length ? ['--ignore', opts.ignore.join(',')] : [];
      await runAnalysisScript(
        reportScript,
        cloneDir,
        [...ignoreArgs],
        { NODE_PATH: path.join(cloneDir, 'node_modules') },
        path.join(taskReportDir, 'analysis.log')
      );

      const srcReport = path.join(cloneDir, 'reports', 'lint-report.html');
      if (fs.existsSync(srcReport)) {
        fs.copyFileSync(srcReport, path.join(taskReportDir, 'lint-report.html'));
        const srcJson = path.join(cloneDir, 'reports', 'lint-summary.json');

        if (fs.existsSync(srcJson)) {
          fs.copyFileSync(srcJson, path.join(taskReportDir, 'lint-summary.json'));
          try {
            const reportData = JSON.parse(fs.readFileSync(srcJson, 'utf-8'));
            if (reportData.summary) {
              taskResult.metrics = {
                totalIssues: (reportData.summary.errors || 0) + (reportData.summary.warnings || 0),
                errorCount: reportData.summary.errors || 0,
                warningCount: reportData.summary.warnings || 0,
                security: { count: (reportData.semgrep?.length || 0) + (reportData.gitleaks?.length || 0) },
                tsPrune: reportData.tsPrune,
                jscpd: reportData.jscpd,
                qualityGate: { passed: true }
              };
            }
          } catch (e) {
            taskLogger.error(`Failed to read report JSON for metrics: ${e.message}`);
          }
        }

        taskResult.status = 'success';
        taskResult.reportPath = path.join(runId, 'lint-report.html');
        taskLogger.log('Success.');

        summaryManager.addRunToHistory(runId, task, 'success', path.join(runId, 'lint-report.html'), taskResult.metrics);
      } else {
        throw new Error('Report file not generated.');
      }

    } catch (e) {
      taskLogger.error(`Task failed: ${e.message}`);
      taskResult.status = 'failed';
      taskResult.error = e.message;
      summaryManager.addRunToHistory(runId, task, 'failed', null, null, e.message);
    } finally {
      if (opts.cleanup) {
        taskLogger.log('Cleaning up clone...');
        try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch (e) { }
      }
    }

    summaryManager.updateTaskStatus(task, taskResult);
  }

  summaryManager.save();
  logger.log(`Done. Summary saved to ${summaryManager.path}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
