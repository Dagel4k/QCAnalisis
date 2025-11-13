import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getRepositories, config } from '../../src/lib/config';
import { ReportSummary, RepositoryWithStatus, HistoryEntry } from '../../src/types';

export const reposRouter = Router();

function normalizeSummary(summary: any): ReportSummary {
  if (summary.branches && Array.isArray(summary.branches)) {
    const normalizedBranches = summary.branches.map((item: any) => {
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

    const normalizedMrs = (summary.mrs || []).map((item: any) => {
      const reportPath = item.report || item.reportPath || '';
      const name = item.sourceBranch || item.branch || '';
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
  return summary;
}

function findSummaryForRepo(repoSlug: string, repoUrl?: string): ReportSummary | null {
  const repoSummaryPath = path.join(config.storageDir, repoSlug, 'summary.json');
  if (fs.existsSync(repoSummaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(repoSummaryPath, 'utf-8'));
      return normalizeSummary(summary);
    } catch (error) {
      console.error(`Error reading repo summary:`, error);
    }
  }

  const summaryPath = path.join(config.storageDir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
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

// GET /api/repos - List all repos with status
reposRouter.get('/', (req, res) => {
  try {
    const repos = getRepositories();
    const reposWithStatus: RepositoryWithStatus[] = repos.map(repo => {
      const summary = findSummaryForRepo(repo.slug, repo.repoUrl);

      if (summary) {
        // Derivar último análisis desde history si está disponible, si no, usar branches
        let lastDate = summary.generatedAt;
        let count = summary.branches.length;
        if (summary.history && summary.history.length > 0) {
          const latest = [...summary.history].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
          if (latest?.generatedAt) lastDate = latest.generatedAt;
          count = summary.history.length;
        }
        return {
          ...repo,
          lastAnalysis: {
            date: lastDate,
            status: 'succeeded' as const,
            branchCount: count,
          },
        };
      }
      
      return repo;
    });
    
    res.json(reposWithStatus);
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
            return branchName === id || rpath.includes(id) || rpath.includes(id.replace(/\//g, '-'));
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
