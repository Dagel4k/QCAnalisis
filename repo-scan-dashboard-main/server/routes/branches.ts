import { Router } from 'express';
import https from 'https';
import { getRepository, config } from '../../src/lib/config';

export const branchesRouter = Router();

function parseProjectPathFromRepoUrl(repoUrl: string): { host: string | undefined; projectPath: string | undefined } {
  try {
    const u = new URL(repoUrl);
    let p = u.pathname.replace(/^\//, '');
    p = p.replace(/\.git$/i, '');
    return { host: `${u.protocol}//${u.host}`, projectPath: p };
  } catch {
    return { host: undefined, projectPath: undefined };
  }
}

function gitlabApiGetJson(baseUrl: string, token: string, pathname: string, query: Record<string, any> = {}): Promise<{ json: any }> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const pathNoLead = pathname.replace(/^\//, '');
  const urlObj = new URL(base + pathNoLead);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}`.length) {
      urlObj.searchParams.set(k, v);
    }
  });

  const headers = token ? { 'PRIVATE-TOKEN': token } : {};

  return new Promise((resolve, reject) => {
    const req = https.get(urlObj, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({ json });
          } catch (e) {
            reject(new Error(`Respuesta no JSON de ${urlObj.href}`));
          }
        } else {
          reject(new Error(`GitLab API ${urlObj.href} -> ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// GET /api/branches/:slug - Get branches for a repo
branchesRouter.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const repo = getRepository(slug);
    
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    const { host: repoHost, projectPath } = parseProjectPathFromRepoUrl(repo.repoUrl);
    const gitlabBase = config.gitlabBase || (repoHost ? `${repoHost}/api/v4` : undefined);
    
    if (!gitlabBase) {
      return res.status(400).json({ error: 'No se pudo determinar GitLab base URL' });
    }

    if (!config.gitlabToken) {
      return res.status(401).json({ error: 'GitLab token no configurado' });
    }

    const projectIdEnc = encodeURIComponent(projectPath || '');
    const { json: branches } = await gitlabApiGetJson(
      gitlabBase,
      config.gitlabToken,
      `/projects/${projectIdEnc}/repository/branches`,
      { per_page: 100 }
    );

    const branchList = branches.map((b: any) => ({
      name: b.name,
      default: b.default || false,
    }));

    res.json({ branches: branchList });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ 
      error: 'Failed to fetch branches',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

