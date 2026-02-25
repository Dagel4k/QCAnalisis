import * as path from 'path';
import { SandboxManager } from './sandbox';
import { Logger } from './utils';

// Scanners
import { IScanner, AnalysisContext } from './scanners/scanner.interface';
import { ScannerRegistry } from './scanners/scanner.registry';
import { ScanResult, UnifiedAnalysisResult, Issue } from './scanners/scanner.types';

export interface AnalyzerOptions {
    cwd: string;
    sandbox: SandboxManager;
    logger: Logger;
    ignore?: string[];
    globs?: string[];
    forceInternalEslint?: boolean;
    noJscpd?: boolean;
    noSecretScan?: boolean;
    noOsv?: boolean;
    noSemgrep?: boolean;
    noGitleaks?: boolean;
    noKnip?: boolean;
    noDepCruiser?: boolean;
}

export class Analyzer {
    private cwd: string;
    private sandbox: SandboxManager;
    private logger: Logger;
    private ignorePatterns: string[];
    private globs: string[] | undefined;

    private options: AnalyzerOptions;
    private registry: ScannerRegistry;

    constructor(options: AnalyzerOptions, scanners: IScanner[]) {
        this.cwd = options.cwd;
        this.sandbox = options.sandbox;
        this.logger = options.logger;
        this.ignorePatterns = options.ignore || [];
        this.globs = options.globs;
        this.options = options;

        // Initialize Registry
        this.registry = new ScannerRegistry();

        // Register injected scanners
        scanners.forEach(scanner => {
            this.registry.register(scanner);
        });
    }

    async run(): Promise<UnifiedAnalysisResult> {
        const start = Date.now();

        // Prepare Context for Scanners
        const context: AnalysisContext = {
            cwd: this.cwd,
            config: {
                ...this.options,
                noOSVScanner: this.options.noOsv,
                noJSCPD: this.options.noJscpd,
                ignore: this.ignorePatterns,
                globs: this.globs
            },
            logger: this.logger,
            env: process.env
        };

        // Run Registry
        const scanResults = await this.registry.runAll(context);

        // Aggregate Results
        let totalErrors = 0;
        let totalWarnings = 0;
        const allFiles = new Set<string>();

        const sevMap: Record<string, number> = {
            'error': 2, 'err': 2, 'critical': 2, 'high': 2,
            'warning': 1, 'warn': 1, 'info': 1, 'medium': 1, 'low': 1
        };

        const seenIssues = new Set<string>();

        scanResults.forEach(result => {
            const uniqueIssues: Issue[] = [];

            result.issues.forEach(issue => {
                const s = String(issue.severity || '').toLowerCase();
                const sev = sevMap[s] || 1;

                // Deduplicate based on file, line, and rule code (or message as fallback)
                let ruleCode = issue.context?.code || issue.message || 'unknown';
                const issueHash = `${issue.file}:${issue.line}:${ruleCode}`;

                if (seenIssues.has(issueHash)) {
                    return; // Skip this duplicate issue
                }

                seenIssues.add(issueHash);
                uniqueIssues.push(issue);

                if (sev === 2) totalErrors++;
                else totalWarnings++;

                if (issue.file) allFiles.add(issue.file);
            });

            // Replace the result issues with the deduplicated array
            result.issues = uniqueIssues;
        });

        return {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            results: scanResults,
            summary: {
                totalFiles: allFiles.size,
                totalErrors: totalErrors,
                totalWarnings: totalWarnings
            }
        };
    }
}