import { Router } from 'express';
import { getRepositories } from '../../src/lib/config.js';
import { getProjectIdFromRepoUrl, gitlabRequestDirect } from '../../src/lib/gitlab.js';

export const mrsRouter = Router();

type GitLabMr = {
  iid: number;
  title: string;
  source_branch: string;
  target_branch: string;
  web_url?: string;
  state?: string;
};

// GET /api/mrs/:slug?state=opened
mrsRouter.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const state = String((req.query.state as string) || 'opened');
    const repos = getRepositories();
    const repo = repos.find((r) => r.slug === slug);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    // Get project id and list MRs
    const projectId = await getProjectIdFromRepoUrl(repo.repoUrl);
    const base = (process.env.GITLAB_BASE || '').trim() || new URL(repo.repoUrl).origin;
    const token = (process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '').trim();
    const items = await gitlabRequestDirect<GitLabMr[]>(base, token, `/api/v4/projects/${projectId}/merge_requests?state=${encodeURIComponent(state)}&per_page=100`);

    const mapped = items.map((m) => ({
      iid: m.iid,
      title: m.title,
      sourceBranch: m.source_branch,
      targetBranch: m.target_branch,
      webUrl: m.web_url,
      state: m.state,
    }));
    res.json({ mrs: mapped });
  } catch (error) {
    console.error('Error fetching MRs:', error);
    res.status(500).json({ error: 'Failed to fetch merge requests' });
  }
});
