import { spawnSync } from 'child_process';
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';

export class GitleaksScanner extends BaseScanner {
    name = 'Gitleaks';
    version = '1.0.0';

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        const args = ['detect', '--no-git', '--redact', '--report-format', 'json', '--source', '.'];

        // Determine if we use local binary or docker
        // Note: In a cleaner architecture, this environment check might belong in a "ToolProvider"
        // but for now we keep it here to satisfy the "Abstraction Leak" concern by encapsulating it.
        const hasBin = spawnSync('gitleaks', ['version']).status === 0;
        const hasDocker = spawnSync('docker', ['--version']).status === 0;

        if (!hasBin && !hasDocker) {
            throw new Error('Gitleaks binary and Docker are not available in the system.');
        }

        let stdout = '';

        if (hasBin) {
            const res = spawnSync('gitleaks', args, {
                cwd: context.cwd,
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            stdout = res.stdout;
        } else {
            const image = process.env.GITLEAKS_IMAGE || 'zricethezav/gitleaks:latest';
            // We use the cwd as the volume mount
            const dockerArgs = ['run', '--rm', '-v', `${context.cwd}:/src`, '-w', '/src', image, ...args];
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
            const rawItems = Array.isArray(json) ? json : (json.findings || []);

            return rawItems.map((x: any) => ({
                tool: this.name,
                severity: 'high', // Gitleaks only finds secrets, which are always high/critical
                message: `Secret detected: ${x.RuleID || 'Unknown Rule'}`,
                file: x.File || x.file || 'unknown',
                line: parseInt(x.StartLine || x.startLine || x.Line || '1', 10),
                col: parseInt(x.StartColumn || x.startColumn || '0', 10),
                snippet: x.Match || x.match || '',
                code: x.RuleID || x.ruleID,
                context: {
                    commit: x.Commit,
                    author: x.Author
                }
            }));
        } catch (e: any) {
            context.logger.error(`[Gitleaks] Failed to parse output: ${e.message}`);
            return [];
        }
    }
}

