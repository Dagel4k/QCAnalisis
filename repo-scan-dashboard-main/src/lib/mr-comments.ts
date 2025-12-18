import fs from 'fs';
import path from 'path';
import { config, getRepository } from './config';
import { getProjectIdFromRepoUrl, postMrComment } from './gitlab';
import { jobManager } from './jobs';

type LintSummary = {
  generatedAt?: string;
  filesAnalyzed?: number;
  totalIssues?: number;
  errorCount?: number;
  warningCount?: number;
  tsPrune?: { count: number };
  jscpd?: { count: number; percentage?: number };
  security?: { count: number };
  dependencies?: { count: number };
  qualityGate?: { passed: boolean; failures?: string[] };
};

function readJsonSafe<T = any>(p: string): T | null {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function postMrCommentsForRepo(jobId: string, repoSlug: string): Promise<void> {
  try {
    if (!config.gitlabBase || !config.gitlabToken) {
      jobManager.addLog(jobId, '[WARN] GitLab no configurado; omitiendo comentario en MR');
      return;
    }

    const repo = getRepository(repoSlug);
    if (!repo) {
      jobManager.addLog(jobId, `[WARN] Repo no encontrado para slug ${repoSlug}`);
      return;
    }
    const projectId = await getProjectIdFromRepoUrl(repo.repoUrl);
    const repoDir = path.join(config.storageDir, repoSlug);
    const summaryPath = path.join(repoDir, 'summary.json');
    const summary = readJsonSafe<any>(summaryPath);
    if (!summary) {
      jobManager.addLog(jobId, '[WARN] summary.json no encontrado para generar comentarios');
      return;
    }

    const mrs = Array.isArray(summary.mrs) ? summary.mrs : [];
    if (mrs.length === 0) {
      jobManager.addLog(jobId, '[INFO] No hay MRs en summary para comentar');
      return;
    }

    const job = jobManager.getJob(jobId);
    const startedAt = job?.startedAt ? new Date(job.startedAt).getTime() : undefined;
    const finishedAt = job?.finishedAt ? new Date(job.finishedAt).getTime() : undefined;
    const windowStart = startedAt ? startedAt - 5 * 60 * 1000 : undefined; // 5 min before start

    // Iterate over MR entries with a report
    for (const mr of mrs) {
      const iid = mr.iid;
      const reportRel: string | undefined = mr.report;
      if (!iid || !reportRel) continue;
      const reportAbs = path.isAbsolute(reportRel) ? reportRel : path.resolve(config.storageDir, '..', reportRel);
      const runDir = path.dirname(reportAbs);
      const commentedFlag = path.join(runDir, '.mr-commented');
      if (fs.existsSync(commentedFlag)) {
        continue; // already commented for this run
      }
      const lintSummaryPath = path.join(runDir, 'lint-summary.json');
      const lint: LintSummary | null = readJsonSafe<LintSummary>(lintSummaryPath);
      if (!lint) {
        continue;
      }
      // Filter by job time window to avoid commenting on older runs
      if (lint.generatedAt) {
        const gen = new Date(lint.generatedAt).getTime();
        if (windowStart && finishedAt && (gen < windowStart || gen > finishedAt + 5 * 60 * 1000)) {
          continue;
        }
      }
      const id = path.basename(runDir);
      const reportUrl = `${config.publicBaseUrl}/api/repos/${encodeURIComponent(repoSlug)}/reports/${encodeURIComponent(id)}`;
      const logsUrl = `${config.publicBaseUrl}/api/repos/${encodeURIComponent(repoSlug)}/reports/${encodeURIComponent(id)}/logs`;

      const errors = lint.errorCount ?? 0;
      const warnings = lint.warningCount ?? 0;
      const total = lint.totalIssues ?? (errors + warnings);
      const dup = (lint.jscpd?.percentage ?? 0).toFixed(2);
      const unused = lint.tsPrune?.count ?? 0;
      const sec = lint.security?.count ?? 0;
      const deps = lint.dependencies?.count ?? 0;
      const qg = lint.qualityGate?.passed === false ? `FAIL (${(lint.qualityGate?.failures || []).join('; ')})` : 'OK';

      const body = [
        `Analizador de Repositorios — resultado del análisis`,
        '',
        `- Issues: ${total} (E: ${errors}, W: ${warnings})`,
        `- Duplicación: ${dup}%`,
        `- Unused exports: ${unused}`,
        `- Seguridad: ${sec}, Dependencias: ${deps}`,
        `- Quality Gate: ${qg}`,
        '',
        `- Logs: ${logsUrl}`,
        `- Reporte: ${reportUrl}`,
      ].join('\n');

      try {
        await postMrComment(projectId, iid, body);
        fs.writeFileSync(commentedFlag, `commented by job ${jobId} at ${new Date().toISOString()}\n`);
        jobManager.addLog(jobId, `✓ Comentario publicado en MR !${iid}`);
      } catch (e: any) {
        jobManager.addLog(jobId, `[ERROR] No se pudo comentar en MR !${iid}: ${e?.message || e}`);
      }
    }
  } catch (err: any) {
    jobManager.addLog(jobId, `[ERROR] Fallo al publicar comentarios en MRs: ${err?.message || err}`);
  }
}
