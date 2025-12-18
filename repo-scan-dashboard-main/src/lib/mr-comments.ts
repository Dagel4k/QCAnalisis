import fs from 'fs';
import path from 'path';
import { config, getRepository } from './config';
import { getProjectIdFromRepoUrl, postMrCommentDirect } from './gitlab';
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
      jobManager.addLog(jobId, '[WARN] GitLab no configurado vía config; intentaré inferir base desde repoUrl y token desde env');
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
    jobManager.addLog(jobId, `[INFO] MR-comments: summary tiene ${mrs.length} MRs`);
    if (mrs.length === 0) {
      jobManager.addLog(jobId, '[INFO] MR-comments: No hay MRs en summary para comentar');
      return;
    }

    const job = jobManager.getJob(jobId);
    const startedAt = job?.startedAt ? new Date(job.startedAt).getTime() : undefined;
    const finishedAt = job?.finishedAt ? new Date(job.finishedAt).getTime() : undefined;
    const windowStart = startedAt ? startedAt - 5 * 60 * 1000 : undefined; // 5 min before start

    // Reunir candidatos por MR y elegir el run más reciente por iid
    type Candidate = {
      iid: number | string;
      runDir: string;
      genAt: number;
      lint: LintSummary;
    };
    const byMr = new Map<number | string, Candidate>();
    for (const mr of mrs) {
      const iid = mr.iid;
      const reportRel: string | undefined = mr.report;
      if (!iid || !reportRel) continue;
      const reportAbs = path.isAbsolute(reportRel) ? reportRel : path.resolve(config.storageDir, '..', reportRel);
      const runDir = path.dirname(reportAbs);
      const lintSummaryPath = path.join(runDir, 'lint-summary.json');
      const lint: LintSummary | null = readJsonSafe<LintSummary>(lintSummaryPath);
      if (!lint || !lint.generatedAt) continue;
      const gen = new Date(lint.generatedAt).getTime();
      if (Number.isFinite(gen)) {
        if (windowStart && finishedAt && (gen < windowStart || gen > finishedAt + 5 * 60 * 1000)) {
          continue;
        }
        const prev = byMr.get(iid);
        if (!prev || gen > prev.genAt) {
          byMr.set(iid, { iid, runDir, genAt: gen, lint });
        }
      }
    }
    jobManager.addLog(jobId, `[INFO] MR-comments: ${byMr.size} MR(s) seleccionados para comentar (último run)`);

    let attempted = 0;
    let posted = 0;
    for (const c of byMr.values()) {
      const commentedFlag = path.join(c.runDir, '.mr-commented');
      if (fs.existsSync(commentedFlag)) {
        jobManager.addLog(jobId, `[INFO] MR !${c.iid}: ya comentado para run ${path.basename(c.runDir)}`);
        continue;
      }
      attempted++;
      const id = path.basename(c.runDir);
      const reportUrl = `${config.publicBaseUrl}/api/repos/${encodeURIComponent(repoSlug)}/reports/${encodeURIComponent(id)}`;
      const logsUrl = `${config.publicBaseUrl}/api/repos/${encodeURIComponent(repoSlug)}/reports/${encodeURIComponent(id)}/logs`;
      const lint = c.lint;
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
        const base = (process.env.GITLAB_BASE || '').trim() || new URL(repo.repoUrl).origin;
        const token = (process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '').trim();
        if (!token) {
          jobManager.addLog(jobId, '[ERROR] No hay token de GitLab (GITLAB_TOKEN/GITLAB_PRIVATE_TOKEN) para comentar');
          continue;
        }
        await postMrCommentDirect(base, token, projectId, c.iid, body);
        const stamp = new Date().toISOString();
        fs.writeFileSync(commentedFlag, `commented by job ${jobId} at ${stamp}\n`);
        // Append summary of comment to run's analysis.log so file logs reflect comments
        try {
          const logPath = path.join(c.runDir, 'analysis.log');
          const lines = [
            '',
            `[INFO] MR-comments: comentario publicado en MR !${c.iid} (${stamp})`,
          ].join('\n');
          fs.appendFileSync(logPath, `${lines}\n`, 'utf8');
        } catch {}
        posted++;
        jobManager.addLog(jobId, `✓ Comentario publicado en MR !${c.iid}`);
      } catch (e: any) {
        jobManager.addLog(jobId, `[ERROR] No se pudo comentar en MR !${c.iid}: ${e?.message || e}`);
        try {
          const logPath = path.join(c.runDir, 'analysis.log');
          fs.appendFileSync(logPath, `\n[ERROR] MR-comments: fallo al comentar en MR !${c.iid}: ${e?.message || e}\n`, 'utf8');
        } catch {}
      }
    }
    jobManager.addLog(jobId, `[INFO] MR-comments resumen: intentados ${attempted}, publicados ${posted}`);
  } catch (err: any) {
    jobManager.addLog(jobId, `[ERROR] Fallo al publicar comentarios en MRs: ${err?.message || err}`);
  }
}
