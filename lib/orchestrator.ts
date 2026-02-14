import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { Logger, sanitizeName, makeRunId } from './utils';
import { GitService } from './git';
import { GitLabService, GitLabMergeRequest } from './gitlab';
import { SandboxManager, VirtualEnvironment } from './sandbox';
import { Analyzer, AnalyzerOptions } from './analyzer';
import { HtmlGenerator } from './html-generator';
import { UnifiedAnalysisResult } from './scanners/scanner.types';
import { IScanner } from './scanners/scanner.interface';
import { SummaryManager } from './summary';
import pLimit from 'p-limit';

export interface OrchestratorOptions {
    repo: string;
    workDir: string;
    reportsDir: string;
    branches?: string[];
    mrLabels?: string[];
    fromGitlabMrs?: boolean;
    fromGitlabBranches?: boolean;
    gitlabToken?: string;
    gitlabBase?: string;
    depth?: number;
    cleanup?: boolean;
    concurrency?: number;
    // Analysis options
    scanners: IScanner[];
    ignore?: string[];
    globs?: string[];
    noJscpd?: boolean;
    noSecretScan?: boolean;
    noOsv?: boolean;
    noSemgrep?: boolean;
    noGitleaks?: boolean;
    noKnip?: boolean;
    noDepCruiser?: boolean;
}

export interface OrchestratorTask {
    id: string;
    type: 'branch' | 'mr';
    target: string; // branch name or source branch
    slug: string;
    url: string;
    ref?: string; // specific commit or branch
}

export class AnalysisOrchestrator extends EventEmitter {
    private options: OrchestratorOptions;
    private logger: Logger;
    private gitlab: GitLabService;
    private limit: any;
    private sandboxManager: SandboxManager;
    private summaryManager: SummaryManager;

    constructor(options: OrchestratorOptions) {
        super();
        this.options = {
            cleanup: true,
            concurrency: 2,
            ...options
        };
        this.logger = new Logger();
        this.gitlab = new GitLabService(this.options.gitlabToken, this.options.gitlabBase);
        this.limit = pLimit(this.options.concurrency || 2);
        this.sandboxManager = new SandboxManager(this.options.workDir, this.logger);
        this.summaryManager = new SummaryManager(this.options.reportsDir);
    }

    public async run(): Promise<void> {
        this.emit('start', this.options);
        this.logger.log('[Orchestrator] Starting analysis run...');

        try {
            // 0. Initialize Sandbox Manager (Reclaims abandoned workspaces)
            await this.sandboxManager.init();

            // 1. Resolve Tasks
            const tasks = await this.resolveTasks();
            if (tasks.length === 0) {
                this.logger.warn('[Orchestrator] No tasks found to process.');
                this.emit('end', []);
                return;
            }

            this.logger.log(`[Orchestrator] Processing ${tasks.length} tasks with concurrency ${this.options.concurrency}`);

            // 2. Execute Tasks Concurrently
            const results = await Promise.all(tasks.map(task => this.limit(() => this.processTask(task))));

            // 3. Aggregate & Finalize
            this.emit('end', results);
            this.logger.log('[Orchestrator] Run completed.');

        } catch (error: any) {
            this.logger.error(`[Orchestrator] Run failed: ${error.message}`);
            this.emit('error', error);
            throw error;
        }
    }

    private async resolveTasks(): Promise<OrchestratorTask[]> {
        const tasks: OrchestratorTask[] = [];

        // Manual branches
        if (this.options.branches && this.options.branches.length > 0) {
            tasks.push(...this.options.branches.map(b => ({
                id: makeRunId(`branch-${sanitizeName(b)}`),
                type: 'branch' as const,
                target: b,
                slug: `branch-${sanitizeName(b)}`,
                url: this.options.repo
            })));
        }

        // GitLab MRs
        if (this.options.fromGitlabMrs && this.options.repo) {
            try {
                this.logger.log('[Orchestrator] Fetching MRs from GitLab...');
                const mrs = await this.gitlab.fetchOpenMergeRequests(this.options.repo, { labels: this.options.mrLabels });
                tasks.push(...mrs.map(mr => ({
                    id: makeRunId((mr as any).slug),
                    type: 'mr' as const,
                    target: mr.sourceBranch || '',
                    slug: (mr as any).slug,
                    url: mr.repoUrl
                })));
            } catch (e: any) {
                this.logger.error(`[Orchestrator] Failed to fetch MRs: ${e.message}`);
            }
        }

        return tasks;
    }

    private async processTask(task: OrchestratorTask): Promise<any> {
        this.emit('task:start', task);

        // Obtain Lease
        const leaseId = `${sanitizeName(this.options.repo.split('/').pop() || 'repo')}-${task.slug}-${task.id}`;
        let lease;

        try {
            lease = await this.sandboxManager.obtainLease(leaseId);
        } catch (e: any) {
            this.logger.error(`[Task] Failed to obtain lease: ${e.message}`);
            this.emit('task:error', { task, error: `Lease failure: ${e.message}`, status: 'failed' });
            return { task, status: 'failed', error: e.message };
        }

        const taskDir = lease.path;
        const reportDir = path.join(this.options.reportsDir, task.id);

        // Ensure directories (reportDir only, taskDir is handled by lease)
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

        const taskLogger = new Logger(path.join(reportDir, 'analysis.log'));
        const git = new GitService(taskLogger);

        // Result container
        const result: any = {
            task,
            status: 'pending',
            startTime: new Date().toISOString()
        };

        try {
            // 1. Clone
            taskLogger.log(`[Task] Cloning ${task.url} (${task.target})...`);

            let authUrl = task.url;
            const isGitLabUrl = task.url.includes('gitlab.com') || (this.options.gitlabBase && task.url.includes(this.options.gitlabBase));
            if (this.options.gitlabToken && /^https/i.test(task.url) && isGitLabUrl) {
                const u = new URL(task.url);
                u.username = 'oauth2';
                u.password = this.options.gitlabToken;
                authUrl = u.toString();
            }

            // Clean dir before clone (Lease created it, but git clone wants it gone or empty)
            if (fs.existsSync(taskDir)) {
                fs.rmSync(taskDir, { recursive: true, force: true });
            }
            git.clone(authUrl, taskDir, task.target, this.options.depth || 1);

            // 2. Setup (Sandbox/VEnv) - Minimal setup for dependencies if needed
            const sourceNodeModules = path.join(process.cwd(), 'node_modules');
            const venv = new VirtualEnvironment(taskDir, sourceNodeModules, taskLogger);
            try { venv.setup(); } catch (e) { taskLogger.warn('Failed to setup virtual env, proceeding...'); }

            // 3. Analyze
            taskLogger.log('[Task] Running analysis...');

            const analyzerOpts: AnalyzerOptions = {
                cwd: taskDir,
                sandbox: this.sandboxManager,
                logger: taskLogger,
                ignore: this.options.ignore,
                globs: this.options.globs,
                noJscpd: this.options.noJscpd,
                noSecretScan: this.options.noSecretScan,
                noOsv: this.options.noOsv,
                noSemgrep: this.options.noSemgrep,
                noGitleaks: this.options.noGitleaks,
                noKnip: this.options.noKnip,
                noDepCruiser: this.options.noDepCruiser
            };

            const analyzer = new Analyzer(analyzerOpts, this.options.scanners);
            const analysisResult = await analyzer.run();

            // 4. Generate Report
            const generator = new HtmlGenerator({ cwd: taskDir });
            const html = await generator.generate(analysisResult);

            const reportFile = path.join(reportDir, 'lint-report.html');
            const jsonFile = path.join(reportDir, 'lint-summary.json');

            fs.writeFileSync(reportFile, html);
            fs.writeFileSync(jsonFile, JSON.stringify(analysisResult, null, 2));

            // 5. Update Repo Summary (Fix for Dashboard 0-issues bug)
            const repoSlug = sanitizeName(this.options.repo.split('/').pop() || 'repo');
            const relReportPath = path.join(task.id, 'lint-report.html');

            try {
                this.summaryManager.updateSummary(
                    repoSlug,
                    this.options.repo,
                    task.id,
                    task.type,
                    task.target,
                    analysisResult,
                    relReportPath
                );
            } catch (sumErr: any) {
                taskLogger.error(`[Task] Failed to update repo summary: ${sumErr.message}`);
                // Don't fail the whole task for this, but log it
            }

            result.status = 'success';
            result.reportPath = reportFile;
            result.metrics = analysisResult.summary;
            result.endTime = new Date().toISOString();

            this.emit('task:complete', result);
            taskLogger.log('[Task] Completed successfully.');

        } catch (e: any) {
            taskLogger.error(`[Task] Failed: ${e.message}`);
            result.status = 'failed';
            result.error = e.message;
            result.endTime = new Date().toISOString();
            this.emit('task:error', result);
        } finally {
            // Cleanup Lease
            if (this.options.cleanup) {
                try {
                    await this.sandboxManager.releaseLease(lease);
                } catch { }
            }
        }

        return result;
    }
}
