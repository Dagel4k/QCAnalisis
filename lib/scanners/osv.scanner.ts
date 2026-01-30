import { spawnSync } from 'child_process';
import { Scanner, ScanResult, ScannerOptions, ScanFinding } from './scanner.interface';

export class OsvScanner implements Scanner {
    name = 'OSV-Scanner';

    isEnabled(options: any): boolean {
        return !options.noOsv;
    }

    async run(options: ScannerOptions): Promise<ScanResult> {
        console.log('[Analyzer] Running OSV-Scanner...');

        // Scan recursively by default to find all lockfiles
        const args = ['--format', 'json', '-r', '.'];

        try {
            const hasBin = spawnSync('osv-scanner', ['--version']).status === 0;
            const hasDocker = spawnSync('docker', ['--version']).status === 0;

            if (!hasBin && !hasDocker) {
                return { tool: this.name, status: 'skipped', error: 'Binary and Docker not available', findings: [] };
            }

            let res;
            if (hasBin) {
                res = spawnSync('osv-scanner', args, {
                    cwd: options.cwd,
                    encoding: 'utf8',
                    maxBuffer: 50 * 1024 * 1024, // 50MB buffer just in case
                    stdio: ['ignore', 'pipe', 'ignore'] // Ignore stderr to avoid noise
                });
            } else {
                const image = process.env.OSV_IMAGE || 'ghcr.io/google/osv-scanner:latest';
                const dockerArgs = ['run', '--rm', '-v', `${options.cwd}:/src`, '-w', '/src', image, ...args];
                res = spawnSync('docker', dockerArgs, {
                    encoding: 'utf8',
                    maxBuffer: 50 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore']
                });
            }

            if (!res.stdout) {
                // If no output but exit code 0, it means no vulnerabilities found usually. 
                // However OSV outputs JSON even on success if requested.
                // If strict failure, maybe stderr had something. But we ignored it.
                return { tool: this.name, status: 'success', findings: [] };
            }

            try {
                const json = JSON.parse(res.stdout);
                const findings: ScanFinding[] = [];

                if (json.results && Array.isArray(json.results)) {
                    for (const result of json.results) {
                        const filePath = result.source?.path || 'unknown';
                        
                        if (result.packages && Array.isArray(result.packages)) {
                            for (const pkg of result.packages) {
                                if (pkg.vulnerabilities && Array.isArray(pkg.vulnerabilities)) {
                                    for (const vul of pkg.vulnerabilities) {
                                        findings.push({
                                            tool: this.name,
                                            file: filePath,
                                            line: 1, // Lockfiles usually don't give exact lines easily via OSV
                                            rule: vul.id, // CVE-XXX or GHSA-XXX
                                            message: vul.summary || vul.details || `Vulnerability in ${pkg.package.name}`,
                                            severity: 'error', // OSV findings are usually high/critical if reported
                                            package: pkg.package.name,
                                            version: pkg.package.version,
                                            type: 'vulnerability'
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                return { tool: this.name, status: 'success', findings };
            } catch (parseError: any) {
                console.warn(`[Analyzer] OSV-Scanner JSON parse error: ${parseError.message}`);
                return { tool: this.name, status: 'error', error: parseError.message, findings: [] };
            }

        } catch (e: any) {
            console.warn(`[Analyzer] OSV-Scanner failed: ${e.message}`);
            return { tool: this.name, status: 'error', error: e.message, findings: [] };
        }
    }
}
