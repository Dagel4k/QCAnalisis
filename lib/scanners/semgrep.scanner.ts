import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { Scanner, ScanResult, ScannerOptions, ScanFinding } from './scanner.interface';

export class SemgrepScanner implements Scanner {
    name = 'Semgrep';

    isEnabled(options: any): boolean {
        return !options.noSemgrep;
    }

    async run(options: ScannerOptions): Promise<ScanResult> {
        console.log('[Analyzer] Running Semgrep...');

        // config from env or default
        const cfg = (process.env.SEMGREP_CONFIG || 'p/ci').trim();
        const args = ['--quiet', '--json', '--timeout', '120', '--config', cfg];

        // We assume we can pass specific ignore patterns here if needed, 
        // but for now relying on .semgrepignore or default behavior is safer 
        // unless we want to parse the global ignore patterns again.
        // Simplified for this refactor to focus on the architecture.

        try {
            // Check if binary exists
            const hasBin = spawnSync('semgrep', ['--version']).status === 0;
            const hasDocker = spawnSync('docker', ['--version']).status === 0;

            if (!hasBin && !hasDocker) {
                return { tool: this.name, status: 'error', error: 'Binary and Docker not available', findings: [] };
            }

            let res;
            if (hasBin) {
                res = spawnSync('semgrep', args, {
                    cwd: options.cwd,
                    encoding: 'utf8',
                    maxBuffer: 20 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore']
                });
            } else {
                // Docker fallback
                const image = process.env.SEMGREP_IMAGE || 'returntocorp/semgrep:latest';
                const dockerArgs = ['run', '--rm', '-v', `${options.cwd}:/src`, '-w', '/src', image, 'semgrep', ...args];
                res = spawnSync('docker', dockerArgs, {
                    encoding: 'utf8',
                    maxBuffer: 20 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore']
                });
            }

            if (!res.stdout) return { tool: this.name, status: 'success', findings: [] };

            try {
                const json = JSON.parse(res.stdout);
                const findings: ScanFinding[] = [];

                if (json && Array.isArray(json.results)) {
                    findings.push(...json.results.map((r: any) => ({
                        tool: 'Semgrep',
                        rule: r.check_id,
                        file: r.path,
                        line: r.start ? (r.start.line || 1) : 1,
                        severity: (r.extra && r.extra.severity) || 'WARNING', // Preserve original severity
                        message: (r.extra && r.extra.message) || ''
                    })));
                }
                return { tool: this.name, status: 'success', findings };
            } catch (err: any) {
                return { tool: this.name, status: 'error', error: 'Invalid JSON: ' + err.message, findings: [] };
            }

        } catch (e: any) {
            console.warn(`[Analyzer] Semgrep failed: ${e.message}`);
            return { tool: this.name, status: 'error', error: e.message, findings: [] };
        }
    }
}
