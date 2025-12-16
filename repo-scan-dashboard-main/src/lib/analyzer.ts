import { spawn } from 'child_process';
import path from 'path';
import { config, ensureDirectories } from './config';
import { AnalysisOptions } from '@/types';
import { jobManager } from './jobs';

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
  if (options.mode === 'mrs') {
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
    jobManager.addLog(jobId, `Iniciando análisis: node ${args.join(' ')}`);
    jobManager.setJobRunning(jobId);

    const projectRoot = path.dirname(path.dirname(config.reviewScriptPath));
    
    const envExtras: Record<string, string | undefined> = {
      REPORT_STRICT: options.qualityGates?.strict ? '1' : undefined,
      REPORT_MAX_ERRORS: typeof options.qualityGates?.maxErrors === 'number' ? String(options.qualityGates!.maxErrors) : undefined,
      REPORT_MAX_WARNINGS: typeof options.qualityGates?.maxWarnings === 'number' ? String(options.qualityGates!.maxWarnings) : undefined,
      REPORT_MAX_UNUSED_EXPORTS: typeof options.qualityGates?.maxUnusedExports === 'number' ? String(options.qualityGates!.maxUnusedExports) : undefined,
      REPORT_MAX_DUP_PERCENT: typeof options.qualityGates?.maxDupPercent === 'number' ? String(options.qualityGates!.maxDupPercent) : undefined,
    };

    const child = spawn('node', args, {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ANALYZE_OFFLINE_MODE: config.analyzeOfflineMode ? 'true' : undefined,
        GITLAB_BASE: config.gitlabBase || undefined,
        GITLAB_TOKEN: config.gitlabToken || undefined,
        GITLAB_PRIVATE_TOKEN: config.gitlabToken || undefined,
        REPORT_USE_INTERNAL_ESLINT_CONFIG: config.forceEslintConfig ? '1' : undefined,
        ...envExtras,
      },
      cwd: projectRoot,
    });

    child.stdout.on('data', (data) => {
      const log = data.toString();
      jobManager.addLog(jobId, log);
    });

    child.stderr.on('data', (data) => {
      const log = `[ERROR] ${data.toString()}`;
      jobManager.addLog(jobId, log);
    });

    child.on('error', (error) => {
      jobManager.addLog(jobId, `[ERROR] ${error.message}`);
      jobManager.setJobFailed(jobId, error.message);
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        jobManager.addLog(jobId, '✓ Análisis completado exitosamente');
        jobManager.setJobSucceeded(jobId);
        resolve();
      } else {
        const errorMsg = `Proceso terminó con código ${code}`;
        jobManager.addLog(jobId, `[ERROR] ${errorMsg}`);
        jobManager.setJobFailed(jobId, errorMsg);
        reject(new Error(errorMsg));
      }
    });
  });
}
