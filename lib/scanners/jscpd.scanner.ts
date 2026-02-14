import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';

export class JscpdScanner extends BaseScanner {
    name = 'JSCPD';
    version = '1.0.0';

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        // Ensure reports directory exists
        const reportsDir = path.join(context.cwd, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportFile = path.join(reportsDir, 'jscpd-report.json');

        const localBin = path.join(context.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
        const target = 'src';

        const args = [
            target,
            '--reporters', 'json',
            '--output', 'reports',
            '--threshold', '100',
            '--exitCode', '0',
            '--minLines', '15',
            '--minTokens', '100',
            '--skipComments', 'true',
            '--ignore', '**/*.test.ts,**/*.spec.ts,**/*.d.ts,**/styles.ts,**/config.*.ts,**/locales/**'
        ];

        let cmd = 'npx';
        let finalArgs = ['jscpd', ...args];

        if (fs.existsSync(localBin)) {
            cmd = localBin;
            finalArgs = args;
        }

        spawnSync(cmd, finalArgs, {
            cwd: context.cwd,
            encoding: 'utf-8',
            stdio: 'ignore'
        });

        if (fs.existsSync(reportFile)) {
            const content = fs.readFileSync(reportFile, 'utf-8');
            const result = JSON.parse(content);
            const rawDuplicates = result.duplicates || [];

            return rawDuplicates.map((d: any) => this.createIssue(
                'medium', // Duplication is usually valid but not critical
                `Found ${d.lines} lines duplicated with ${d.secondFile?.name}:${d.secondFile?.start}`,
                d.firstFile?.name || 'unknown',
                d.firstFile?.start || 1,
                {
                    code: 'duplication',
                    snippet: d.fragment,
                    context: {
                        secondFile: d.secondFile?.name,
                        secondStart: d.secondFile?.start,
                        lines: d.lines
                    }
                }
            ));
        }

        return [];
    }
}

