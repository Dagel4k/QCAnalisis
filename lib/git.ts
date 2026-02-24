import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { Logger } from './utils';

export class GitService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    private _run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}, timeoutMs: number = 300000): string {
        // Merge process.env with custom env
        const finalEnv = { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' };

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

    public clone(repoUrl: string, destination: string, branch: string, depth: number = 1): void {
        if (fs.existsSync(destination)) {
            throw new Error(`Destination ${destination} already exists. Clean it up before cloning.`);
        }

        const args = [
            'clone',
            '--config', 'credential.helper=',
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

    public fetch(cwd: string, remote: string = 'origin', ref: string): void {
        const args = ['fetch', '--quiet', remote, ref];
        if (process.env.FETCH_DEPTH) {
            args.push(`--depth=${process.env.FETCH_DEPTH}`);
        }
        const timeout = parseInt(process.env.FETCH_TIMEOUT_MS || '120000', 10);
        this._run(args, cwd, {}, timeout);
    }

    public checkout(cwd: string, ref: string): void {
        this._run(['checkout', '--force', ref], cwd);
    }

    public clean(cwd: string): void {
        this._run(['clean', '-fdx'], cwd);
    }

    public diffNames(cwd: string, baseRef: string, headRef: string): string[] {
        try {
            const out = this._run(['diff', '--name-only', `${baseRef}...${headRef}`], cwd);
            return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        } catch (e: any) {
            this.logger.log(`[WARN] Diff failed: ${e.message}`);
            return [];
        }
    }

    public setRemoteUrl(cwd: string, remote: string, url: string): void {
        this._run(['remote', 'set-url', remote, url], cwd);
    }

    public revParse(cwd: string, ref: string): string {
        return this._run(['rev-parse', '--verify', ref], cwd);
    }
}
