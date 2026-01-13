const https = require('https');
const { URL } = require('url');

class GitLabService {
    constructor(token, baseUrl) {
        this.token = token;
        this.baseUrl = baseUrl;
    }

    _parseRepoUrl(repoUrl) {
        try {
            const u = new URL(repoUrl);
            let p = u.pathname.replace(/^\//, ''); // trim leading /
            p = p.replace(/\.git$/i, ''); // drop .git
            return { host: `${u.protocol}//${u.host}`, projectPath: p };
        } catch {
            throw new Error(`Invalid repo URL: ${repoUrl}`);
        }
    }

    /**
     * Determine the API base URL. PREFER the explicit CLI arg if given,
     * otherwise fallback to deducing from repo URL.
     */
    resolveApiBase(repoUrl) {
        if (this.baseUrl) return this.baseUrl;
        const { host } = this._parseRepoUrl(repoUrl);
        if (!host) throw new Error('Could not determine GitLab host from repo URL.');
        return `${host}/api/v4`;
    }

    async _get(urlStr, query = {}) {
        const urlObj = new URL(urlStr);
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined && v !== null && `${v}`.length) urlObj.searchParams.set(k, v);
        });

        const headers = this.token ? { 'PRIVATE-TOKEN': this.token } : {};

        return new Promise((resolve, reject) => {
            const req = https.get(urlObj, { headers }, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const body = Buffer.concat(chunks).toString('utf8');
                            const json = JSON.parse(body);
                            resolve(json);
                        } catch (e) {
                            reject(new Error(`Invalid JSON response from ${urlObj.href}`));
                        }
                    } else {
                        reject(new Error(`GitLab API error: ${res.statusCode} ${res.statusMessage} (${urlObj.href})`));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async fetchOpenMergeRequests(repoUrl, opts = {}) {
        const { projectPath } = this._parseRepoUrl(repoUrl);
        // URL Encode project path (e.g. group/subgroup/project)
        const pid = encodeURIComponent(projectPath);
        const apiBase = this.resolveApiBase(repoUrl);

        const endpoint = `${apiBase}/projects/${pid}/merge_requests`;
        const query = {
            state: opts.state || 'opened',
            per_page: 100,
            target_branch: opts.targetBranch,
            labels: opts.labels ? opts.labels.join(',') : undefined
        };

        const mrs = await this._get(endpoint, query);
        if (!Array.isArray(mrs)) return [];

        // Enrich with source project info (for forks)
        const result = [];
        const projectCache = {}; // pid -> http_url_to_repo

        for (const mr of mrs) {
            const sourcePid = mr.source_project_id;
            let sourceRepoUrl = repoUrl;

            // If fork (source proj != target proj)
            if (sourcePid !== mr.target_project_id) {
                if (projectCache[sourcePid]) {
                    sourceRepoUrl = projectCache[sourcePid];
                } else {
                    try {
                        const pInfo = await this._get(`${apiBase}/projects/${sourcePid}`);
                        sourceRepoUrl = pInfo.http_url_to_repo || pInfo.ssh_url_to_repo;
                        projectCache[sourcePid] = sourceRepoUrl;
                    } catch (e) {
                        console.warn(`[WARN] Could not fetch info for source project ${sourcePid}, assuming same repo.`);
                    }
                }
            }

            result.push({
                type: 'mr',
                iid: mr.iid,
                title: mr.title,
                sourceBranch: mr.source_branch,
                targetBranch: mr.target_branch,
                repoUrl: sourceRepoUrl,
                slug: `mr-${mr.iid}-${mr.source_branch.replace(/[^a-zA-Z0-9._-]/g, '-')}`
            });
        }

        return result;
    }

    async fetchBranches(repoUrl, filterRegexStr) {
        const { projectPath } = this._parseRepoUrl(repoUrl);
        const pid = encodeURIComponent(projectPath);
        const apiBase = this.resolveApiBase(repoUrl);

        const branches = await this._get(`${apiBase}/projects/${pid}/repository/branches`, { per_page: 100 });
        let list = branches.map(b => b.name);

        if (filterRegexStr) {
            try {
                const re = new RegExp(filterRegexStr);
                list = list.filter(n => re.test(n));
            } catch (e) {
                console.warn('[WARN] Invalid branch filter regex, ignoring.');
            }
        }

        return list.map(name => ({
            type: 'branch',
            branch: name,
            repoUrl,
            slug: `branch-${name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
        }));
    }
}

module.exports = { GitLabService };
