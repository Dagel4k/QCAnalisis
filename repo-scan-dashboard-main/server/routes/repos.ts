import { Router } from 'express';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getRepositories, config } from '../../src/lib/config';
import { ReportSummary, RepositoryWithStatus, HistoryEntry, Repository } from '../../src/types';

export const reposRouter = Router();

// Define interfaces for the raw, untrusted data read from summary.json
interface RawBranchItem {
  report?: string;
  reportPath?: string;
  branch?: string;
  name?: string;
}

interface RawMrItem extends RawBranchItem {
  sourceBranch?: string;
  iid?: number | string;
}

interface RawReportSummary {
  branches?: RawBranchItem[];
  mrs?: RawMrItem[];
  generatedAt?: string;
  history?: HistoryEntry[];
  repo?: string;
}


function normalizeSummary(summary: RawReportSummary): ReportSummary {
  if (summary.branches && Array.isArray(summary.branches)) {
    const normalizedBranches = summary.branches.map((item: RawBranchItem) => {
      const reportPath = item.report || item.reportPath || '';
      const name = item.branch || item.name || '';
      const reportDir = path.dirname(reportPath);
      const id = path.basename(reportDir) || name;
      
      return {
        name,
        reportPath,
        isMr: false,
        id,
      };
    });

    const normalizedMrs = (summary.mrs || []).map((item: RawMrItem) => {
      const reportPath = item.report || item.reportPath || '';
      const name = item.sourceBranch || item.branch || item.name || '';
      const reportDir = path.dirname(reportPath);
      const id = path.basename(reportDir) || `mr-${item.iid}-${name}`;
      
      return {
        name,
        reportPath,
        isMr: true,
        mrNumber: item.iid?.toString() || '',
        id,
      };
    });

    const history: HistoryEntry[] = Array.isArray(summary.history) ? summary.history : [];
    return {
      branches: [...normalizedBranches, ...normalizedMrs],
      generatedAt: summary.generatedAt || new Date().toISOString(),
      history,
    };
  }
  return summary as ReportSummary;
}

function findSummaryForRepo(repoSlug: string, repoUrl?: string): ReportSummary | null {
  const repoSummaryPath = path.join(config.storageDir, repoSlug, 'summary.json');
  if (fs.existsSync(repoSummaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(repoSummaryPath, 'utf8')) as RawReportSummary;
      return normalizeSummary(summary);
    } catch (error) {
      console.error(`Error reading repo summary:`, error);
    }
  }

  const summaryPath = path.join(config.storageDir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as RawReportSummary;
      if (summary.repo) {
        if (repoUrl && summary.repo === repoUrl) {
          return normalizeSummary(summary);
        }
        if (!repoUrl) {
          return normalizeSummary(summary);
        }
      }
    } catch (error) {
      console.error(`Error reading summary:`, error);
    }
  }

  return null;
}

function reposWithStatusFrom(repos: Repository[]): RepositoryWithStatus[] {
  const out: RepositoryWithStatus[] = [];
  for (const repo of repos) {
    try {
      const summary = findSummaryForRepo(repo.slug, repo.repoUrl);
      if (summary) {
        let lastDate = summary.generatedAt;
        let count = summary.branches.length;
        if (summary.history && summary.history.length > 0) {
          const latest = [...summary.history].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
          if (latest?.generatedAt) lastDate = latest.generatedAt;
          count = summary.history.length;
        }
        out.push({
          ...repo,
          lastAnalysis: {
            date: lastDate,
            status: 'succeeded' as const,
            branchCount: count,
          },
        });
        continue;
      }
      out.push(repo as RepositoryWithStatus);
    } catch (error) {
      console.warn('Failed to enrich repo summary:', repo.slug, error);
      out.push(repo as RepositoryWithStatus);
    }
  }
  return out;
}

// GET /api/repos - List all repos with status
reposRouter.get('/', (req, res) => {
  try {
    const repos = getRepositories();
    const enriched = reposWithStatusFrom(repos);
    res.json(enriched);
  } catch (error) {
    console.error('Error getting repos:', error);
    res.status(500).json({ error: 'Failed to get repositories' });
  }
});

// GET /api/repos/:slug/reports - Get reports for a repo
reposRouter.get('/:slug/reports', (req, res) => {
  try {
    const { slug } = req.params;
    const repos = getRepositories();
    const repo = repos.find(r => r.slug === slug);
    const summary = findSummaryForRepo(slug, repo?.repoUrl);
    
    if (!summary) {
      return res.json({ branches: [], generatedAt: new Date().toISOString(), history: [] });
    }
    
    res.json(summary);
  } catch (error) {
    console.error('Error getting reports:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

// GET /api/repos/:slug/reports/:id - Serve a specific report HTML
reposRouter.get('/:slug/reports/:id', (req, res) => {
  try {
    const { slug, id } = req.params;
    const repos = getRepositories();
    const repo = repos.find(r => r.slug === slug);
    
    let reportPath = path.join(config.storageDir, slug, id, 'lint-report.html');
    if (!fs.existsSync(reportPath)) {
      reportPath = path.join(config.storageDir, id, 'lint-report.html');
    }
    if (!fs.existsSync(reportPath)) {
      const summary = findSummaryForRepo(slug, repo?.repoUrl);
      if (summary) {
        // Preferir history si existe
        if (summary.history && summary.history.length > 0) {
          const found = summary.history.find(h => h.id === id || (h.report && h.report.includes(id)));
          if (found?.report) {
            const candidate = path.isAbsolute(found.report)
              ? found.report
              : path.resolve(config.storageDir, found.report);
            if (fs.existsSync(candidate)) reportPath = candidate;
          }
        }
        if (!fs.existsSync(reportPath)) {
          const branch = summary.branches.find(b => {
            const branchName = b.name || '';
            const rpath = b.reportPath || '';
            return branchName === id || rpath.includes(id) || rpath.includes(id.replaceAll('/', '-'));
          });
          if (branch && branch.reportPath) {
            let relativePath: string;
            if (path.isAbsolute(branch.reportPath)) {
              relativePath = branch.reportPath;
            } else {
              relativePath = path.resolve(config.storageDir, branch.reportPath);
              if (!fs.existsSync(relativePath)) {
                relativePath = path.resolve(config.storageDir, '..', branch.reportPath);
              }
            }
            if (fs.existsSync(relativePath)) {
              reportPath = relativePath;
            }
          }
        }
      }
    }
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.sendFile(path.resolve(reportPath));
  } catch (error) {
    console.error('Error serving report:', error);
    res.status(500).json({ error: 'Failed to serve report' });
  }
});

// GET /api/repos/:slug/reports/:id/lint-summary.json - Serve JSON summary alongside the report
reposRouter.get('/:slug/reports/:id/lint-summary.json', (req, res) => {
  try {
    const { slug, id } = req.params;
    const repos = getRepositories();
    const repo = repos.find(r => r.slug === slug);

    // Try standard locations
    const primary = path.join(config.storageDir, slug, id, 'lint-summary.json');
    const secondary = path.join(config.storageDir, id, 'lint-summary.json');
    const candidates: string[] = [];
    if (fs.existsSync(primary)) candidates.push(primary);
    if (fs.existsSync(secondary)) candidates.push(secondary);

    if (candidates.length === 0) {
      const summary = findSummaryForRepo(slug, repo?.repoUrl);
      if (summary) {
        // Prefer history
        if (summary.history && summary.history.length > 0) {
          const found = summary.history.find(h => h.id === id || (h.report && h.report.includes(id)));
          if (found?.report) {
            const dir = path.dirname(found.report);
            const candidate = path.isAbsolute(dir)
              ? path.join(dir, 'lint-summary.json')
              : path.resolve(config.storageDir, dir, 'lint-summary.json');
            if (fs.existsSync(candidate)) candidates.push(candidate);
          }
        }
        if (candidates.length === 0) {
          const branch = summary.branches.find(b => {
            const branchName = b.name || '';
            const rpath = b.reportPath || '';
            return branchName === id || rpath.includes(id) || rpath.includes(id.replaceAll('/', '-'));
          });
          if (branch && branch.reportPath) {
            const rel = path.isAbsolute(branch.reportPath)
              ? path.join(path.dirname(branch.reportPath), 'lint-summary.json')
              : path.resolve(config.storageDir, path.dirname(branch.reportPath), 'lint-summary.json');
            if (fs.existsSync(rel)) candidates.push(rel);
          }
        }
      }
    }

    const resolved = candidates.find(p => fs.existsSync(p));
    if (!resolved) return res.status(404).json({ error: 'Summary not found' });
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.resolve(resolved));
  } catch (error) {
    console.error('Error serving summary json:', error);
    res.status(500).json({ error: 'Failed to serve summary' });
  }
});

// GET /api/repos/:slug/reports/:id/logs - Serve analysis log if available
reposRouter.get('/:slug/reports/:id/logs', (req, res) => {
  try {
    const { slug, id } = req.params;
    const repos = getRepositories();
    const repo = repos.find(r => r.slug === slug);

    // Try to locate the corresponding report directory first
    const primaryReport = path.join(config.storageDir, slug, id, 'lint-report.html');
    const secondaryReport = path.join(config.storageDir, id, 'lint-report.html');
    let reportDir: string | undefined;
    if (fs.existsSync(primaryReport)) reportDir = path.dirname(primaryReport);
    else if (fs.existsSync(secondaryReport)) reportDir = path.dirname(secondaryReport);

    if (!reportDir) {
      const summary = findSummaryForRepo(slug, repo?.repoUrl);
      if (summary) {
        // Prefer history
        if (summary.history && summary.history.length > 0) {
          const found = summary.history.find(h => h.id === id || (h.report && h.report.includes(id)));
          if (found?.report) {
            const candidatePath = path.isAbsolute(found.report) ? found.report : path.resolve(config.storageDir, found.report);
            if (fs.existsSync(candidatePath)) {
              reportDir = path.dirname(candidatePath);
            }
          }
        }
        if (!reportDir) {
          const branch = summary.branches.find(b => (b.name === id) || (b.reportPath || '').includes(id));
          if (branch && branch.reportPath) {
            const p = path.isAbsolute(branch.reportPath) ? branch.reportPath : path.resolve(config.storageDir, branch.reportPath);
            if (fs.existsSync(p)) reportDir = path.dirname(p);
          }
        }
      }
    }

    if (!reportDir) return res.status(404).json({ error: 'Log not found' });
    const logPath = path.join(reportDir, 'analysis.log');
    if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Log not found' });

    res.setHeader('Content-Type', 'text/plain; charset=utf8');
    return res.sendFile(path.resolve(logPath));
  } catch (error) {
    console.error('Error serving logs:', error);
    return res.status(500).json({ error: 'Failed to serve logs' });
  }
});

// POST /api/repos/import-default - Import repos from a fixed local path
// NOTE: This is intended for local usage to quickly load repos.json.
reposRouter.post('/import-default', (req, res) => {
  try {
    const sourcePath = '/Users/daniel/Downloads/scriptCCode/repos.json';
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: `repos.json not found at ${sourcePath}` });
    }

    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw);

    // Optionally, try to write/ensure destination exists where getRepositories reads from
    try {
      const targetPath = path.join(config.storageDir, '..', 'repos.json');
      // Ensure dir exists (it should), then write
      fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), 'utf8');
    } catch (writeErr) {
      // Non-fatal: still return parsed content so UI can use it
      console.warn('Could not write repos.json to project root:', writeErr);
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error importing default repos.json:', error);
    res.status(500).json({ error: 'Failed to import repos.json' });
  }
});

// Helper to resolve writable repos.json path (project root)
function resolveReposJsonPath(): string {
  // Prefer sibling of storageDir (which defaults to <projectRoot>/reports)
  const candidate = path.join(config.storageDir, '..', 'repos.json');
  return candidate;
}

// -------- Validation helpers ---------
function isValidHttpsGitUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Must have at least /owner/repo
    const parts = u.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

function isValidSshGitUrl(url: string): boolean {
  // git@host:owner/repo(.git)
  return /^git@[^:]+:[^\s]+\/(?:[^\s]+?)(?:\.git)?$/i.test(url.trim());
}

function buildCloneUrlWithTokenIfAvailable(original: string): string {
  try {
    const token = process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '';
    if (!token) return original;
    const u = new URL(original);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      u.username = 'oauth2';
      u.password = token;
      return u.toString();
    }
  } catch {
    // ignore
  }
  return original;
}

function verifyRepoReachable(repoUrl: string): { ok: boolean; reason?: string } {
  const isHttps = isValidHttpsGitUrl(repoUrl);
  const isSsh = isValidSshGitUrl(repoUrl);
  if (!isHttps && !isSsh) {
    return { ok: false, reason: 'URL no tiene formato válido (https o SSH)' };
  }

  // Prefer HTTPS verification; SSH verification may fail without configured keys
  if (isSsh) {
    // Without SSH keys, we can't reliably verify; ask to use HTTPS
    return { ok: false, reason: 'No se puede verificar repos SSH. Usa URL HTTPS o configura verificación con token.' };
  }

  const testUrl = buildCloneUrlWithTokenIfAvailable(repoUrl);
  try {
    const res = spawnSync('git', ['ls-remote', '--heads', '--exit-code', testUrl], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: 'ignore',
      timeout: 15000,
    });
    if (res.status === 0) return { ok: true };
    return { ok: false, reason: 'Repositorio inexistente o sin acceso con las credenciales actuales' };
  } catch (error) {
    return { ok: false, reason: 'Fallo al verificar el repositorio' };
  }
}

// POST /api/repos/validate - Validate repo URL and existence
reposRouter.post('/validate', (req, res) => {
  try {
    const { repoUrl } = req.body || {};
    if (!repoUrl || typeof repoUrl !== 'string') {
      return res.status(400).json({ ok: false, reason: 'repoUrl es requerido' });
    }
    const result = verifyRepoReachable(String(repoUrl).trim());
    return res.json(result);
  } catch (error) {
    console.error('Error validating repository:', error);
    return res.status(500).json({ ok: false, reason: 'Error interno al validar' });
  }
});

// POST /api/repos - Append a repository to repos.json
reposRouter.post('/', (req, res) => {
  try {
    const { slug, name, repoUrl, imageUrl, description } = req.body || {};
    if (!slug || !name || !repoUrl) {
      return res.status(400).json({ error: 'slug, name y repoUrl son requeridos' });
    }
    // Basic format validations
    const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug));
    if (!slugOk) {
      return res.status(400).json({ error: 'slug inválido (solo minúsculas, números y guiones medios)' });
    }
    const urlStr = String(repoUrl).trim();
    const httpsOk = isValidHttpsGitUrl(urlStr);
    const sshOk = isValidSshGitUrl(urlStr);
    if (!httpsOk && !sshOk) {
      return res.status(400).json({ error: 'repoUrl debe ser HTTPS (recomendado) o SSH válido' });
    }
    if (imageUrl) {
      try { new URL(String(imageUrl)); } catch { return res.status(400).json({ error: 'imageUrl inválida' }); }
    }

    const repos = getRepositories();
    if (repos.some(r => r.slug === slug)) {
      return res.status(409).json({ error: `Ya existe un repo con slug '${slug}'` });
    }

    // Existence verification (strict by default)
    const allowUnverified = process.env.ALLOW_UNVERIFIED_REPOS === 'true';
    const ver = verifyRepoReachable(urlStr);
    if (!ver.ok && !allowUnverified) {
      return res.status(400).json({ error: ver.reason || 'Repositorio no verificable' });
    }

    const newRepo = { slug, name, repoUrl, imageUrl, description };
    const updated = [...repos, newRepo];

    const targetPath = resolveReposJsonPath();
    // Ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(updated, null, 2), 'utf8');

    const enriched = reposWithStatusFrom(updated);
    return res.status(201).json(enriched);
  } catch (error) {
    console.error('Error adding repository:', error);
    return res.status(500).json({ error: 'Failed to add repository' });
  }
});

// PATCH /api/repos/:slug - Update repository fields (name, repoUrl, imageUrl, description)
reposRouter.patch('/:slug', (req, res) => {
  try {
    const { slug: paramSlug } = req.params;
    const { name, slug, repoUrl, imageUrl, description } = req.body || {};

    const repos = getRepositories();
    const idx = repos.findIndex(r => r.slug === paramSlug);
    if (idx === -1) {
      return res.status(404).json({ error: `Repositorio '${paramSlug}' no encontrado` });
    }

    const current = repos[idx];
    // Build next object (do not allow slug change here to avoid breaking report paths)
    const next = {
      ...current,
      name: typeof name === 'string' && name.trim() ? String(name).trim() : current.name,
      repoUrl: typeof repoUrl === 'string' && repoUrl.trim() ? String(repoUrl).trim() : current.repoUrl,
      imageUrl: typeof imageUrl === 'string' ? (imageUrl.trim() || undefined) : current.imageUrl,
      description: typeof description === 'string' ? (description.trim() || undefined) : current.description,
    };

    // Validate basic formats
    const isValidHttpsGitUrl = (url: string) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const parts = u.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
        return parts.length >= 2;
      } catch { return false; }
    };
    const isValidSshGitUrl = (url: string) => /^git@[^:]+:[^\s]+\/(?:[^\s]+?)(?:\.git)?$/i.test(url.trim());
    if (!isValidHttpsGitUrl(next.repoUrl) && !isValidSshGitUrl(next.repoUrl)) {
      return res.status(400).json({ error: 'repoUrl debe ser HTTPS (recomendado) o SSH válido' });
    }
    if (next.imageUrl) {
      try { new URL(String(next.imageUrl)); } catch { return res.status(400).json({ error: 'imageUrl inválida' }); }
    }

    // Duplicate checks (excluding current)
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const normUrl = (s: string) => norm(s).replace(/\.git$/i, '').replace(/\/+$/g, '');
    const conflict = repos.some(r => r.slug !== current.slug && (
      norm(r.name) === norm(next.name) ||
      normUrl(r.repoUrl) === normUrl(next.repoUrl) ||
      (!!next.imageUrl && norm(r.imageUrl || '') === norm(next.imageUrl))
    ));
    if (conflict) {
      return res.status(409).json({ error: 'Conflicto: ya existe un repo con los mismos datos (nombre/URL/imagen)' });
    }

    const updated = [...repos];
    updated[idx] = { ...current, ...next };

    const targetPath = resolveReposJsonPath();
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(updated, null, 2), 'utf8');

    const enriched = reposWithStatusFrom(updated);
    return res.json(enriched);
  } catch (error) {
    console.error('Error updating repository:', error);
    return res.status(500).json({ error: 'Failed to update repository' });
  }
});

// DELETE /api/repos/:slug - Remove repository
reposRouter.delete('/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const repos = getRepositories();
    const idx = repos.findIndex(r => r.slug === slug);
    if (idx === -1) {
      return res.status(404).json({ error: `Repositorio '${slug}' no encontrado` });
    }
    const updated = repos.filter(r => r.slug !== slug);
    const targetPath = resolveReposJsonPath();
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(updated, null, 2), 'utf8');
    const enriched = reposWithStatusFrom(updated);
    return res.json(enriched);
  } catch (error) {
    console.error('Error deleting repository:', error);
    return res.status(500).json({ error: 'Failed to delete repository' });
  }
});
