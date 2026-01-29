import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Scanner, ScanResult, ScannerOptions, ScanFinding } from './scanner.interface';

export class KnipScanner implements Scanner {
    name = 'Knip';

    isEnabled(options: { noKnip?: boolean }): boolean {
        return !options.noKnip;
    }

    async run(options: ScannerOptions): Promise<ScanResult> {
        console.log('[Analyzer] Running Knip (Deep Unused Code Scan)...');

        const localBin = path.join(options.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'knip.cmd' : 'knip');

        let cmd = 'npx';
        let args = ['knip', '--reporter', 'json', '--no-exit-code'];

        if (fs.existsSync(localBin)) {
            cmd = localBin;
            args = ['--reporter', 'json', '--no-exit-code'];
        } else {
            args = ['--yes', 'knip', '--reporter', 'json', '--no-exit-code'];
        }

        const configFiles = ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.ts', 'knip.js', 'package.json'];
        const hasConfig = configFiles.some(f => {
            if (f === 'package.json') {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(options.cwd, f), 'utf-8'));
                    return !!pkg.knip;
                } catch { return false; }
            }
            return fs.existsSync(path.join(options.cwd, f));
        });

        const tempConfigPath = path.join(options.cwd, 'knip.json');
        let createdTempConfig = false;

        if (!hasConfig) {
            // Inject a temporary config to disable plugins that cause issues due to missing dependencies
            // (eslint, vite, etc. load config files that require project devDependencies not in sandbox)
            try {
                const effectiveConfig = {
                    eslint: false,
                    vite: false,
                    vitest: false,
                    // Since we disable vite, we must manually ensure common entry points are covered
                    entry: [
                        'index.ts', 'index.js', 'index.tsx', 'index.jsx',
                        'src/index.ts', 'src/index.js', 'src/index.tsx', 'src/index.jsx',
                        'src/main.ts', 'src/main.js', 'src/main.tsx', 'src/main.jsx',
                        'index.html'
                    ]
                };
                fs.writeFileSync(tempConfigPath, JSON.stringify(effectiveConfig, null, 2));
                createdTempConfig = true;
            } catch (e: unknown) {
                console.warn(`[Analyzer] Failed to create temp knip.json: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        try {
            const res = spawnSync(cmd, args, {
                cwd: options.cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 20 * 1024 * 1024
            });

            if (!res.stdout) {
                if (res.stderr) {
                    console.warn(`[Analyzer] Knip produced no output but wrote to stderr: ${res.stderr}`);
                    return { tool: this.name, status: 'error', error: res.stderr, findings: [] };
                }
                return { tool: this.name, status: 'success', findings: [] };
            }

            try {
                const json = JSON.parse(res.stdout);
                const findings: ScanFinding[] = [];

                // 1. Handle unused files (Top-level array of strings)
                if (Array.isArray(json.files)) {
                    for (const file of json.files) {
                        findings.push({
                            tool: 'Knip',
                            type: 'knip-unused-file',
                            file: String(file),
                            message: 'Unused file',
                            rule: 'knip/unused-file',
                            line: 1,
                            col: 1,
                            severity: 'warning'
                        });
                    }
                }

                // 2. Handle grouped issues
                if (Array.isArray(json.issues)) {
                    for (const group of json.issues) {
                        const file = group.file || 'unknown';
                        const categories = [
                            'dependencies', 'devDependencies', 'optionalPeerDependencies',
                            'unlisted', 'binaries', 'unresolved', 'exports', 'types',
                            'enumMembers', 'classMembers', 'duplicates'
                        ];

                        for (const cat of categories) {
                            if (Array.isArray(group[cat])) {
                                for (const item of group[cat]) {
                                    findings.push({
                                        tool: 'Knip',
                                        type: `knip-${cat}`,
                                        file: file,
                                        message: `${cat}: ${item.name || item.symbol || 'issue'}`,
                                        rule: `knip/${cat}`,
                                        line: item.line || 1,
                                        col: item.col || 1,
                                        severity: 'warning'
                                    });
                                }
                            }
                        }
                    }
                } else {
                    // 3. Fallback for legacy top-level arrays
                    const types = ['dependencies', 'devDependencies', 'unlisted', 'exports', 'types'];

                    for (const type of types) {
                        if (Array.isArray(json[type])) {
                            for (const issue of json[type]) {
                                findings.push({
                                    tool: 'Knip',
                                    type: `knip-${type}`,
                                    file: issue.file || 'unknown',
                                    message: `${type}: ${issue.name || issue.file}`,
                                    rule: `knip/${type}`,
                                    line: issue.line || 1,
                                    col: issue.col || 1,
                                    severity: 'warning'
                                });
                            }
                        }
                    }
                }

                return { tool: this.name, status: 'success', findings };
            } catch (parseErr: unknown) {
                // Determine the actual error message
                let errorMsg = 'Invalid JSON output';
                const stderr = res.stderr ? res.stderr.trim() : '';
                const stdout = res.stdout ? res.stdout.trim() : '';

                if (stderr) {
                    errorMsg = stderr;
                } else if (stdout.startsWith('Module loading failed') || stdout.startsWith('Error:')) {
                    errorMsg = stdout.split('\n')[0]; // Take the first line
                }

                console.warn(`[Analyzer] Failed to parse Knip JSON. Output start: "${stdout.slice(0, 50)}..."`);
                if (stderr) console.warn(`[Analyzer] Knip Stderr: ${stderr}`);

                // Keep original error message if no better one found
                if (errorMsg === 'Invalid JSON output' && parseErr instanceof Error) {
                    errorMsg += `: ${parseErr.message}`;
                }

                return { tool: this.name, status: 'error', error: errorMsg, findings: [] };
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[Analyzer] Knip failed: ${msg}`);
            return { tool: this.name, status: 'error', error: msg, findings: [] };
        } finally {
            if (createdTempConfig && fs.existsSync(tempConfigPath)) {
                try {
                    fs.unlinkSync(tempConfigPath);
                } catch (e) { /* ignore cleanup error */ }
            }
        }
    }
}
