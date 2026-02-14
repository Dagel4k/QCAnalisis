import { spawnSync } from 'child_process';
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';

export class OsvScanner extends BaseScanner {
    name = 'OSV-Scanner';
    version = '1.0.0';

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        const args = ['--format', 'json', '-r', '.'];

        const hasBin = spawnSync('osv-scanner', ['--version']).status === 0;
        const hasDocker = spawnSync('docker', ['--version']).status === 0;

        if (!hasBin && !hasDocker) {
            // OSV Scanner is often optional or tricky, so we might want to just skip or warn?
            // But strict architect says: if it's enabled, it should run. Fail fast or skip if configured?
            // BaseScanner wraps this in try-catch so throwing is fine.
            throw new Error('OSV-Scanner binary and Docker are not available.');
        }

        let stdout = '';

        if (hasBin) {
            const res = spawnSync('osv-scanner', args, {
                cwd: context.cwd,
                encoding: 'utf8',
                maxBuffer: 50 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            stdout = res.stdout;
        } else {
            const image = process.env.OSV_IMAGE || 'ghcr.io/google/osv-scanner:latest';
            const dockerArgs = ['run', '--rm', '-v', `${context.cwd}:/src`, '-w', '/src', image, ...args];
            const res = spawnSync('docker', dockerArgs, {
                encoding: 'utf8',
                maxBuffer: 50 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            stdout = res.stdout;
        }

        if (!stdout) return [];

        try {
            const json = JSON.parse(stdout);
            const issues: Issue[] = [];

            if (json.results && Array.isArray(json.results)) {
                for (const result of json.results) {
                    const filePath = result.source?.path || 'unknown';

                    if (result.packages && Array.isArray(result.packages)) {
                        for (const pkg of result.packages) {
                            if (pkg.vulnerabilities && Array.isArray(pkg.vulnerabilities)) {
                                for (const vul of pkg.vulnerabilities) {
                                    issues.push(this.createIssue(
                                        'high', // Vulnerabilities are high by default
                                        vul.summary || vul.details || `Vulnerability in ${pkg.package.name}`,
                                        filePath,
                                        1,
                                        {
                                            code: vul.id, // CVE-XXX
                                            context: {
                                                package: pkg.package.name,
                                                version: pkg.package.version,
                                                fixedVersion: vul.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed
                                            }
                                        }
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            return issues;
        } catch (parseError: any) {
            throw new Error(`JSON parse error: ${parseError.message}`);
        }
    }
}

