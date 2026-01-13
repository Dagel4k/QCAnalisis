const { spawnSync } = require('child_process');
const fs = require('fs');

class GitService {
    constructor(logger) {
        this.logger = logger;
    }

    _run(args, cwd, env = {}, timeoutMs = 300000) {
        // Merge process.env with custom env
        const finalEnv = { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' };

        // Log the command (masking token potentially? complex to do perfect masking, 
        // but at least we aren't concatenating shell strings blindly)
        // For debugging: this.logger.log(`[CMD] git ${args.join(' ')}`);

        const res = spawnSync('git', args, {
            cwd,
            env: finalEnv,
            encoding: 'utf-8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout/stderr
        });

        if (res.error) { // System error (e.g. spawn failed)
            throw res.error;
        }

        if (res.status !== 0) {
            const errorMsg = res.stderr || res.stdout || 'Unknown git error';
            throw new Error(`Git command failed (exit ${res.status}): git ${args[0]} ...\nOutput: ${errorMsg}`);
        }

        return res.stdout.trim();
    }

    clone(repoUrl, destination, branch, depth = 1) {
        if (fs.existsSync(destination)) {
            throw new Error(`Destination ${destination} already exists. Clean it up before cloning.`);
        }

        const args = [
            'clone',
            '--quiet',
            '--depth', depth.toString(),
            '--branch', branch,
            '--single-branch',
            repoUrl,
            destination
        ];

        // Optional optimization flags handled via ENV
        if (process.env.SPARSE_CHECKOUT === '1' || process.env.GIT_FILTER_BLOB_NONE === '1') {
            args.splice(1, 0, '--filter=blob:none');
        }

        const timeout = parseInt(process.env.CLONE_TIMEOUT_MS || '300000', 10);
        this.logger.log(`Cloning ${repoUrl} (branch: ${branch}) to ${destination}...`);
        this._run(args, process.cwd(), {}, timeout);
    }

    fetch(cwd, remote = 'origin', ref) {
        const args = ['fetch', '--quiet', remote, ref];
        if (process.env.FETCH_DEPTH) {
            args.push(`--depth=${process.env.FETCH_DEPTH}`);
        }
        const timeout = parseInt(process.env.FETCH_TIMEOUT_MS || '120000', 10);
        this._run(args, cwd, {}, timeout);
    }

    checkout(cwd, ref) {
        this._run(['checkout', '--force', ref], cwd);
    }

    clean(cwd) {
        this._run(['clean', '-fdx'], cwd);
    }

    diffNames(cwd, baseRef, headRef) {
        try {
            const out = this._run(['diff', '--name-only', `${baseRef}...${headRef}`], cwd);
            return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        } catch (e) {
            this.logger.log(`[WARN] Diff failed: ${e.message}`);
            return [];
        }
    }

    setRemoteUrl(cwd, remote, url) {
        this._run(['remote', 'set-url', remote, url], cwd);
    }

    revParse(cwd, ref) {
        return this._run(['rev-parse', '--verify', ref], cwd);
    }
}

module.exports = { GitService };
