import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger, sanitizeName, loadEnvFromFile, makeRunId } from '../lib/utils';
import { GitService } from '../lib/git';
import { GitLabService, GitLabMergeRequest, GitLabBranch } from '../lib/gitlab';
import { SandboxManager, VirtualEnvironment } from '../lib/sandbox';

(function preloadDotEnv() {
  let envFile: string | undefined;
  const argv = process.argv;
  const idx = argv.indexOf('--env-file');
  if (idx !== -1 && idx + 1 < argv.length) envFile = path.resolve(argv[idx + 1]);
  else if (process.env.DOTENV_PATH) envFile = path.resolve(process.env.DOTENV_PATH);
  else envFile = path.resolve(process.cwd(), '.env');
  loadEnvFromFile(envFile);
})();

interface ReviewOptions {
  repo?: string;
  branches?: string[];
  workDir: string;
  reportsDir: string;
  ignore?: string[];
  cleanup: boolean;
  depth: number;
  gitlabToken?: string;
  gitlabBase?: string;
  reportScript?: string;
  installDev?: string;
  fromGitlabMrs?: boolean;
  fromGitlabBranches?: boolean;
  mrLabels?: string[];
  globs?: string;
}

interface Task {
  type: 'branch' | 'mr';
  branch?: string;
  sourceBranch?: string;
  targetBranch?: string;
  repoUrl: string;
  slug: string;
  iid?: number;
}

class SummaryManager {
  private reportsDir: string;
  public path: string;
  private repo: string;
  private data: any;

  constructor(reportsDir: string, opts: { repo?: string } = {}) {
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
      } catch (e: any) {
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

  addRunToHistory(runId: string, task: Task, status: string, reportPath: string | null, metrics: any = {}, error: string | null = null) {
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

  updateTaskStatus(task: Task, result: any) {
    const targetArray = task.type === 'mr' ? this.data.mrs : this.data.branches;
    const existingIdx = targetArray.findIndex((t: any) => t.slug === task.slug || (task.branch && t.branch === task.branch));

    if (existingIdx >= 0) {
      targetArray[existingIdx] = { ...targetArray[existingIdx], ...result };
    } else {
      targetArray.push(result);
    }
  }
}

function parseArgs(): ReviewOptions {
  const args = process.argv.slice(2);
  const opts: ReviewOptions = {
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
    else if (a === '--globs') opts.globs = args[++i];
  }

  if (!opts.repo) {
    console.error('Missing required argument: --repo <url>');
    process.exit(1);
  }
  return opts;
}

async function runAnalysisScript(scriptPath: string, cwd: string, args: string[], env: any, logFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(logFile, { flags: 'a' });

    let cmd = process.execPath;
    let cmdArgs = [scriptPath, ...args];

    if (scriptPath.endsWith('.ts')) {
      env['NODE_OPTIONS'] = '-r ts-node/register';
    }

    const child = spawn(cmd, cmdArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.pipe(outStream);
    child.stderr.pipe(outStream);
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

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

async function main() {
  const opts = parseArgs();
  const logger = new Logger();

  if (!fs.existsSync(opts.workDir)) fs.mkdirSync(opts.workDir, { recursive: true });
  if (!fs.existsSync(opts.reportsDir)) fs.mkdirSync(opts.reportsDir, { recursive: true });

  let reportScript = opts.reportScript || process.env.REPORT_SCRIPT_PATH;
  if (!reportScript) {
    const localJs = path.join(process.cwd(), 'generate-html-lint-report.js');
    const localTs = path.join(process.cwd(), 'generate-html-lint-report.ts');

    if (fs.existsSync(localJs)) reportScript = localJs;
    else if (fs.existsSync(localTs)) reportScript = localTs;
  }
  if (!reportScript) throw new Error('Could not find generate-html-lint-report.js/ts. Please specify --report-script.');

  const gitlab = new GitLabService(opts.gitlabToken, opts.gitlabBase);
  let tasks: Task[] = [];

  if (opts.branches && opts.branches.length) {
    tasks.push(...opts.branches.map(b => ({
      type: 'branch', branch: b, repoUrl: opts.repo!, slug: `branch-${sanitizeName(b)}`
    } as Task)));
  }

  if (opts.fromGitlabMrs && opts.repo) {
    try {
      logger.log('Fetching MRs from GitLab...');
      const mrs = await gitlab.fetchOpenMergeRequests(opts.repo, { labels: opts.mrLabels });
      tasks.push(...mrs);
    } catch (e: any) {
      logger.error(`Failed to fetch MRs: ${e.message}`);
    }
  }

  if (tasks.length === 0) {
    logger.error('No tasks found (no branches or MRs specified/found).');
    process.exit(1);
  }

  logger.log(`Found ${tasks.length} tasks to process.`);

  const summaryManager = new SummaryManager(opts.reportsDir, { repo: opts.repo });

  const activeCloneDirs = new Set<string>();

  const cleanupAndExit = () => {
    logger.log('\n[SIGNAL] Received termination signal. Cleaning up...');
    for (const dir of activeCloneDirs) {
      try {
        if (fs.existsSync(dir)) {
          logger.log(`Cleaning up ${dir}...`);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (e: any) {
        logger.error(`Failed to cleanup ${dir}: ${e.message}`);
      }
    }
    process.exit(1);
  };

  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);

  for (const task of tasks) {
    const runId = makeRunId(task.slug);
    const taskReportDir = path.join(opts.reportsDir, runId);
    fs.mkdirSync(taskReportDir, { recursive: true });

    const taskLogger = new Logger(path.join(taskReportDir, 'analysis.log'));
    taskLogger.log(`Starting task: ${task.slug} (${task.repoUrl})`);

    const cloneDir = path.join(opts.workDir, `${sanitizeName(opts.repo!)}-${task.slug}`);
    activeCloneDirs.add(cloneDir);

    const git = new GitService(taskLogger);
    let taskResult: any = { ...task, status: 'pending' };

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
          git.clone(authUrl, cloneDir, task.type === 'mr' ? task.sourceBranch! : task.branch!, opts.depth);
        }
      } else {
        git.clone(authUrl, cloneDir, task.type === 'mr' ? task.sourceBranch! : task.branch!, opts.depth);
      }

      const sourceNodeModules = path.join(process.cwd(), 'node_modules');
      const venv = new VirtualEnvironment(cloneDir, sourceNodeModules, taskLogger);
      venv.setup();

      taskLogger.log('Running analysis...');
      const ignoreArgs = opts.ignore && opts.ignore.length ? ['--ignore', opts.ignore.join(',')] : [];
      const globsArgs = opts.globs ? ['--globs', opts.globs] : [];

      await runAnalysisScript(
        reportScript,
        cloneDir,
        [...ignoreArgs, ...globsArgs],
        {
          NODE_PATH: path.join(cloneDir, 'node_modules'),
          ANALYSIS_TARGET_DIR: cloneDir  // Explicitly pass the target directory for scanners
        },
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
                security: { count: (reportData.semgrep?.findings?.length || 0) + (reportData.gitleaks?.findings?.length || 0) },
                knip: reportData.knip,
                architecture: reportData.depCruiser,
                jscpd: reportData.jscpd,
                qualityGate: { passed: true }
              };
            }
          } catch (e: any) {
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

    } catch (e: any) {
      taskLogger.error(`Task failed: ${e.message}`);
      taskResult.status = 'failed';
      taskResult.error = e.message;
      summaryManager.addRunToHistory(runId, task, 'failed', null, null, e.message);
    } finally {
      activeCloneDirs.delete(cloneDir);
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
