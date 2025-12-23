import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import { config, ensureDirectories } from './config';
import { AnalysisOptions } from '@/types';
import { jobManager } from './jobs';
import { postMrCommentsForRepo } from './mr-comments';

export async function runAnalysis(
  jobId: string,
  repoSlug: string,
  repoUrl: string,
  options: AnalysisOptions
): Promise<void> {
  ensureDirectories();

  const reportsDir = path.join(config.storageDir, repoSlug);

  const args: string[] = [
    config.reviewScriptPath,
    '--repo',
    repoUrl,
    '--reports-dir',
    reportsDir,
    '--work-dir',
    config.workDir,
    '--report-script',
    config.reportScriptPath,
  ];

  // Mode
  if (options.mode === 'mrs' || options.mode === 'mrs-specific') {
    args.push('--from-gitlab-mrs');
    if (options.mrState) {
      args.push('--mr-state', options.mrState);
    }
    if (options.mrTargetBranch) {
      args.push('--mr-target-branch', options.mrTargetBranch);
    }
    if (options.mrLabels && options.mrLabels.length > 0) {
      args.push('--mr-labels', options.mrLabels.join(','));
    }
    if (options.onlyChanged) {
      args.push('--only-changed');
    }
    if (options.mrsIids && options.mrsIids.length > 0) {
      args.push('--mr-iids', options.mrsIids.join(','));
    }
  } else if (options.mode === 'branches') {
    args.push('--from-gitlab-branches');
    if (options.branchFilter) {
      args.push('--branch-filter', options.branchFilter);
    }
  } else if (options.mode === 'specific' && options.branches) {
    args.push('--branches', options.branches.join(','));
  }

  // Ignore patterns
  const ignorePatterns = [
    ...config.defaultIgnore.split(',').filter(Boolean),
    ...(options.ignore || []),
  ];
  if (ignorePatterns.length > 0) {
    args.push('--ignore', ignorePatterns.join(','));
  }

  // Globs
  const globs = options.globs?.join(',') || config.defaultGlobs;
  if (globs) {
    args.push('--globs', globs);
  }

  // GitLab config
  if (config.gitlabBase) {
    args.push('--gitlab-base', config.gitlabBase);
  }
  if (config.gitlabToken) {
    args.push('--gitlab-token', config.gitlabToken);
  }

  // Depth
  if (options.depth) {
    args.push('--depth', options.depth.toString());
  }

  // Install dev dependencies
  if (!config.analyzeOfflineMode && config.installDevSpec) {
    args.push('--install-dev', config.installDevSpec);
  }

  // No cleanup
  if (options.noCleanup) {
    args.push('--no-cleanup');
  }

  // Force ESLint config
  if (config.forceEslintConfig) {
    args.push('--force-eslint-config');
  }

  return new Promise((resolve, reject) => {
    const setPhase = (phase: string, progress: number) => {
      jobManager.updateJob(jobId, { phase, progress });
    };

    const redactedArgs = args.map((arg, i, arr) => {
      if (arg === '--gitlab-token' && i + 1 < arr.length) {
        return '--gitlab-token';
      }
      if (i > 0 && arr[i - 1] === '--gitlab-token') {
        return '***';
      }
      return arg;
    });
    jobManager.addLog(jobId, `Iniciando análisis: node ${redactedArgs.join(' ')}`);
    jobManager.setJobRunning(jobId);
    setPhase('initializing', 1);

    const projectRoot = path.dirname(path.dirname(config.reviewScriptPath));
    
    const envExtras: Record<string, string | undefined> = {
      REPORT_STRICT: options.qualityGates?.strict ? '1' : undefined,
      REPORT_MAX_ERRORS: typeof options.qualityGates?.maxErrors === 'number' ? String(options.qualityGates!.maxErrors) : undefined,
      REPORT_MAX_WARNINGS: typeof options.qualityGates?.maxWarnings === 'number' ? String(options.qualityGates!.maxWarnings) : undefined,
      REPORT_MAX_UNUSED_EXPORTS: typeof options.qualityGates?.maxUnusedExports === 'number' ? String(options.qualityGates!.maxUnusedExports) : undefined,
      REPORT_MAX_DUP_PERCENT: typeof options.qualityGates?.maxDupPercent === 'number' ? String(options.qualityGates!.maxDupPercent) : undefined,
      // P1 gates
      REPORT_MAX_SAST: typeof options.maxSast === 'number' ? String(options.maxSast) : undefined,
      REPORT_MAX_SECRETS: typeof options.maxSecrets === 'number' ? String(options.maxSecrets) : undefined,
      REPORT_MAX_DEP_VULNS: typeof options.maxDepVulns === 'number' ? String(options.maxDepVulns) : undefined,
      // P1 toggles
      REPORT_NO_SEMGREP: options.enableSemgrep === false ? '1' : undefined,
      REPORT_NO_GITLEAKS: options.enableGitleaks === false ? '1' : undefined,
      REPORT_NO_SECRET_SCAN: options.enableSecretHeuristics === false ? '1' : undefined,
      REPORT_NO_OSV: options.enableOsvScanner === false ? '1' : undefined,
      SEMGREP_CONFIG: options.semgrepConfig || undefined,
      // P2 performance
      GIT_FILTER_BLOB_NONE: options.lightClone ? '1' : undefined,
      REUSE_CLONES: options.reuseClones ? '1' : undefined,
      CLONE_TIMEOUT_MS: typeof options.cloneTimeoutMs === 'number' ? String(options.cloneTimeoutMs) : undefined,
      FETCH_TIMEOUT_MS: typeof options.fetchTimeoutMs === 'number' ? String(options.fetchTimeoutMs) : undefined,
      CMD_TIMEOUT_MS: typeof options.cmdTimeoutMs === 'number' ? String(options.cmdTimeoutMs) : undefined,
      // Lint plugin toggles
      REPORT_NO_UNICORN: options.disableUnicorn ? '1' : undefined,
      REPORT_NO_UNICORN_PREVENT_ABBR: options.disableUnicornPreventAbbr ? '1' : undefined,
      REPORT_DISABLED_RULES: options.disabledRules ? options.disabledRules : undefined,
    };

    const child: ChildProcessWithoutNullStreams = spawn('node', args, {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ANALYZE_OFFLINE_MODE: config.analyzeOfflineMode ? 'true' : undefined,
        GITLAB_BASE: config.gitlabBase || undefined,
        GITLAB_TOKEN: config.gitlabToken || undefined,
        GITLAB_PRIVATE_TOKEN: config.gitlabToken || undefined,
        REPORT_USE_INTERNAL_ESLINT_CONFIG: config.forceEslintConfig ? '1' : undefined,
        // Override via options if provided
        ...(options.forceEslintConfig ? { REPORT_USE_INTERNAL_ESLINT_CONFIG: '1' } : {}),
        ...envExtras,
      },
      cwd: projectRoot,
    });
    runningChildren.set(jobId, child);

    child.stdout.on('data', (data) => {
      const log = data.toString();
      jobManager.addLog(jobId, log);
      // Heuristic phase tracking based on child output
      if (/====\s*Clonando/i.test(log)) setPhase('cloning', 5);
      if (/Generando\s+\.eslintrc\.js/i.test(log)) setPhase('configuring', 15);
      if (/Analizando\s+s[oó]lo/i.test(log) || /Ejecutando reporte ESLint \+ extras/i.test(log)) setPhase('linting', 30);
      if (/\[FORMAT\]\s+Applying syntax highlighting/i.test(log)) setPhase('reporting', 80);
      if (/HTML report generated/i.test(log)) setPhase('reporting', 90);
      if (/Resumen guardado/i.test(log)) setPhase('finalizing', 95);
    });

    child.stderr.on('data', (data) => {
      const raw = data.toString();
      const isWarn = /\[WARN\]/i.test(raw);
      const log = isWarn ? raw : `[ERROR] ${raw}`;
      jobManager.addLog(jobId, log);
    });

    child.on('error', (error) => {
      jobManager.addLog(jobId, `[ERROR] ${error.message}`);
      jobManager.setJobFailed(jobId, error.message);
      reject(error);
    });

    child.on('close', (code) => {
      runningChildren.delete(jobId);
      if (code === 0) {
        (async () => {
          // Mark near-complete
          jobManager.addLog(jobId, '✓ Análisis completado exitosamente');
          jobManager.updateJob(jobId, { phase: 'finalizing', progress: 99 });
          // Post MR comments before marking as succeeded so logs stream to client
          if (options.mode === 'mrs' || options.mode === 'mrs-specific') {
            jobManager.addLog(jobId, '[INFO] Publicando comentarios en MRs…');
            jobManager.updateJob(jobId, { phase: 'posting-comments', progress: 98 });
            try {
              await postMrCommentsForRepo(jobId, repoSlug);
            } catch (e: any) {
              jobManager.addLog(jobId, `[WARN] No se pudieron publicar comentarios en MR: ${e?.message || e}`);
            }
          }
          jobManager.setJobSucceeded(jobId);
          resolve();
        })().catch((e) => {
          // Even if posting comments fails unexpectedly, mark succeeded
          jobManager.addLog(jobId, `[WARN] Post-proceso falló: ${e?.message || e}`);
          jobManager.setJobSucceeded(jobId);
          resolve();
        });
      } else {
        const errorMsg = `Proceso terminó con código ${code}`;
        jobManager.addLog(jobId, `[ERROR] ${errorMsg}`);
        jobManager.setJobFailed(jobId, errorMsg);
        reject(new Error(errorMsg));
      }
    });
  });
}

// --- Cancellation support ---
const runningChildren = new Map<string, ChildProcessWithoutNullStreams>();

export function cancelAnalysis(jobId: string): boolean {
  const child = runningChildren.get(jobId);
  if (!child) return false;
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5000);
    runningChildren.delete(jobId);
    jobManager.updateJob(jobId, { status: 'failed', error: 'Cancelled by user', phase: 'cancelled' });
    return true;
  } catch {
    return false;
  }
}
