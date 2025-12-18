import { config } from './config';

type GitLabProject = { id: number; path_with_namespace: string };

function getProjectPathFromRepoUrl(repoUrl: string): string {
  try {
    if (repoUrl.startsWith('git@')) {
      // git@host:group/subgroup/project(.git)
      const afterColon = repoUrl.split(':', 2)[1] || '';
      return afterColon.replace(/\.git$/i, '').replace(/^\//, '');
    }
    const u = new URL(repoUrl);
    return u.pathname.replace(/\.git$/i, '').replace(/^\//, '');
  } catch {
    return '';
  }
}

async function gitlabRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!config.gitlabBase || !config.gitlabToken) {
    throw new Error('GitLab base or token not configured');
  }
  const url = `${config.gitlabBase.replace(/\/$/, '')}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': config.gitlabToken,
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch {}
    throw new Error(`GitLab request failed: ${resp.status} ${resp.statusText} ${detail}`);
  }
  return resp.json() as Promise<T>;
}

export async function getProjectIdFromRepoUrl(repoUrl: string): Promise<number> {
  const path = getProjectPathFromRepoUrl(repoUrl);
  if (!path) throw new Error('Cannot derive project path from repoUrl');
  // GET /api/v4/projects/:urlencoded_path
  const enc = encodeURIComponent(path);
  const proj = await gitlabRequest<GitLabProject>(`/api/v4/projects/${enc}`);
  return proj.id;
}

export async function postMrComment(projectId: number, mrIid: number | string, body: string): Promise<void> {
  await gitlabRequest(`/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function createMergeRequest(
  projectId: number,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description?: string
): Promise<{ iid: number; web_url: string }> {
  const mr = await gitlabRequest<{ iid: number; web_url: string }>(
    `/api/v4/projects/${projectId}/merge_requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description: description || '',
      }),
    }
  );
  return mr;
}

