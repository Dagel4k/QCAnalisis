import { spawnSync } from 'child_process';
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';

export class SemgrepScanner extends BaseScanner {
    name = 'Semgrep';
    version = '1.0.0';

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        const cfg = (process.env.SEMGREP_CONFIG || 'p/ci').trim();
        const args = ['--quiet', '--json', '--timeout', '120', '--config', cfg];

        const hasBin = spawnSync('semgrep', ['--version']).status === 0;
        const hasDocker = spawnSync('docker', ['--version']).status === 0;

        if (!hasBin && !hasDocker) {
            throw new Error('Semgrep binary and Docker are not available.');
        }

        let stdout = '';

        if (hasBin) {
            const res = spawnSync('semgrep', args, {
                cwd: context.cwd,
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            stdout = res.stdout;
        } else {
            const image = process.env.SEMGREP_IMAGE || 'returntocorp/semgrep:latest';
            const dockerArgs = ['run', '--rm', '-v', `${context.cwd}:/src`, '-w', '/src', image, 'semgrep', ...args];
            const res = spawnSync('docker', dockerArgs, {
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            stdout = res.stdout;
        }

        if (!stdout) return [];

        try {
            const json = JSON.parse(stdout);
            const issues: Issue[] = [];

            if (json && Array.isArray(json.results)) {
                issues.push(...json.results.map((r: any) => this.createIssue(
                    (r.extra?.severity === 'ERROR') ? 'high' : 'medium',
                    r.extra?.message || r.check_id,
                    r.path,
                    r.start?.line || 1,
                    {
                        col: r.start?.col || 1,
                        code: r.check_id,
                        snippet: r.extra?.lines,
                        context: { metadata: r.extra?.metadata }
                    }
                )));
            }
            return issues;
        } catch (err: any) {
            throw new Error(`Invalid JSON output: ${err.message}`);
        }
    }
}

