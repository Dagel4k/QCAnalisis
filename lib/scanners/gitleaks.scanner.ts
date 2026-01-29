import { spawnSync } from 'child_process';
import { Scanner, ScanResult, ScannerOptions, ScanFinding } from './scanner.interface';

export class GitleaksScanner implements Scanner {
    name = 'Gitleaks';

    isEnabled(options: any): boolean {
        return !options.noGitleaks;
    }

    async run(options: ScannerOptions): Promise<ScanResult> {
        console.log('[Analyzer] Running Gitleaks...');

        const args = ['detect', '--no-git', '--redact', '--report-format', 'json', '--source', '.'];

        try {
            const hasBin = spawnSync('gitleaks', ['version']).status === 0; // exit code 0 usually
            const hasDocker = spawnSync('docker', ['--version']).status === 0;

            if (!hasBin && !hasDocker) {
                return { tool: this.name, status: 'error', error: 'Binary and Docker not available', findings: [] };
            }

            let res;
            if (hasBin) {
                res = spawnSync('gitleaks', args, {
                    cwd: options.cwd,
                    encoding: 'utf8',
                    maxBuffer: 20 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore']
                });
            } else {
                const image = process.env.GITLEAKS_IMAGE || 'zricethezav/gitleaks:latest';
                const dockerArgs = ['run', '--rm', '-v', `${options.cwd}:/src`, '-w', '/src', image, ...args];
                res = spawnSync('docker', dockerArgs, {
                    encoding: 'utf8',
                    maxBuffer: 20 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore']
                });
            }

            if (!res.stdout) return { tool: this.name, status: 'success', findings: [] };

            try {
                const json = JSON.parse(res.stdout);
                const raw = Array.isArray(json) ? json : (json.findings || []);
                const findings: ScanFinding[] = raw.map((x: any) => ({
                    tool: 'Gitleaks',
                    file: x.File || x.file || 'unknown',
                    line: x.StartLine || x.startLine || x.Line || 1,
                    rule: x.RuleID || x.ruleID || x.Rule || 'gitleaks',
                    message: `Secret detected: ${x.RuleID}`,
                    match: x.Match || x.match || '',
                    severity: 'error'
                }));
                return { tool: this.name, status: 'success', findings };
            } catch { return { tool: this.name, status: 'success', findings: [] }; }

        } catch (e: any) {
            console.warn(`[Analyzer] Gitleaks failed: ${e.message}`);
            return { tool: this.name, status: 'error', error: e.message, findings: [] };
        }
    }
}
