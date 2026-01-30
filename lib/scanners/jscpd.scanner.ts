import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Scanner, ScanResult, ScannerOptions, ScanFinding } from './scanner.interface';

export class JscpdScanner implements Scanner {
    name = 'JSCPD';

    isEnabled(options: any): boolean {
        return !options.noJscpd;
    }

    async run(options: ScannerOptions): Promise<ScanResult> {
        console.log('[Analyzer] Running JSCPD...');
        
        // Ensure reports directory exists
        const reportsDir = path.join(options.cwd, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportFile = path.join(reportsDir, 'jscpd-report.json');
        
        // Construct command
        // Matches legacy behavior: "jscpd src --reporters json --output reports --threshold 100 --exitCode 0"
        // We prioritize local node_modules bin if available
        const localBin = path.join(options.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
        const target = 'src'; // Keeping strict legacy target

        const args = [
            target,
            '--reporters', 'json',
            '--output', 'reports',
            '--threshold', '100', // Don't fail the build, just report
            '--exitCode', '0',
            '--minLines', '15',   // Increase from default 5 to avoid boilerplate
            '--minTokens', '100', // Increase token count requirement
            '--skipComments', 'true', // Ignore comments (headers, license, JSDoc)
            '--ignore', '**/*.test.ts,**/*.spec.ts,**/*.d.ts,**/styles.ts,**/config.*.ts,**/locales/**' // Ignore common repetitive files
            // Ignore patterns would need to be passed here if we want to support them fully, 
            // but the legacy code handled them via string concatenation. 
            // We'll try to just run it as is for now.
        ];

        let cmd = 'npx';
        let finalArgs = ['jscpd', ...args];

        if (fs.existsSync(localBin)) {
            cmd = localBin;
            finalArgs = args;
        }

        try {
            spawnSync(cmd, finalArgs, { 
                cwd: options.cwd, 
                encoding: 'utf-8', 
                stdio: 'ignore' // jscpd can be noisy
            });

            if (fs.existsSync(reportFile)) {
                const content = fs.readFileSync(reportFile, 'utf-8');
                const result = JSON.parse(content);
                const rawDuplicates = result.duplicates || [];

                const findings: ScanFinding[] = rawDuplicates.map((d: any) => ({
                    tool: this.name,
                    file: d.firstFile?.name || 'unknown',
                    line: d.firstFile?.start || 1,
                    rule: 'duplication',
                    message: `Found ${d.lines} lines duplicated with ${d.secondFile?.name}:${d.secondFile?.start}`,
                    severity: 'warning',
                    match: d.fragment,
                    // Additional metadata if needed
                    type: 'duplication'
                }));

                // Add the second file as a separate finding or just rely on the first one?
                // Usually one finding per pair is enough to flag it.
                // However, the legacy "count * 2" implies we might want to flag both? 
                // For now, let's map 1 duplication = 1 finding. 
                // The aggregator in Analyzer can apply weighting if needed.
                
                return { 
                    tool: this.name, 
                    status: 'success', 
                    findings,
                    summary: {
                        percentage: result.statistics?.percentage || 0,
                        duplicates: rawDuplicates // Include raw duplicates for backward compatibility
                    }
                };
            }

            return { tool: this.name, status: 'success', findings: [] };

        } catch (e: any) {
            console.warn(`[Analyzer] JSCPD failed: ${e.message}`);
            return { tool: this.name, status: 'error', error: e.message, findings: [] };
        }
    }
}
