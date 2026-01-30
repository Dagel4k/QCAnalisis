import * as fs from 'fs';
import * as path from 'path';
import { ESLint } from 'eslint';
const fg = require('fast-glob');
import { SandboxManager } from './sandbox';
import { Logger } from './utils';

// Scanners
import { Scanner, ScanResult } from './scanners/scanner.interface';
import { KnipScanner } from './scanners/knip.scanner';
import { SemgrepScanner } from './scanners/semgrep.scanner';
import { GitleaksScanner } from './scanners/gitleaks.scanner';
import { OsvScanner } from './scanners/osv.scanner';
import { JscpdScanner } from './scanners/jscpd.scanner';

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

export interface AnalysisResult {
    generatedAt: string;
    durationMs: number;
    summary: {
        errors: number;
        warnings: number;
        files: number;
    };
    results: ESLint.LintResult[];
    jscpd: any;
    semgrep: any;
    osv: any;
    gitleaks: any;
    knip: any;
    depCruiser: any;
}

export class Analyzer {
    private cwd: string;
    private sandbox: SandboxManager;
    private logger: Logger;
    private ignorePatterns: string[];
    private globs: string[] | undefined;

    private options: AnalyzerOptions;
    private scanners: Scanner[] = [];

    constructor(options: AnalyzerOptions) {
        this.cwd = options.cwd;
        this.sandbox = options.sandbox;
        this.logger = options.logger;
        this.ignorePatterns = options.ignore || [];
        this.globs = options.globs;
        this.options = options;

        // Register Scanners
        this.scanners = [
            new KnipScanner(),
            new SemgrepScanner(),
            new GitleaksScanner(),
            new OsvScanner(),
            new JscpdScanner()
        ];
    }

    private normalizeIgnorePattern(pat: string): string {
        let p = (pat || '').trim();
        if (!p) return '';
        if (p.startsWith('/')) p = `**${p}`;
        if (p.endsWith('/')) p = `${p}**`;
        if (!/[*?]/.test(p) && !/\.[a-zA-Z0-9]+$/.test(p)) {
            p = `**/${p}/**`;
        }
        return p;
    }

    private async runEslint(): Promise<ESLint.LintResult[]> {
        const patterns = this.globs ? (Array.isArray(this.globs) ? this.globs : [this.globs]) : ['src/**/*.{js,ts,tsx,jsx}'];
        const defaultIgnores = ['**/node_modules/**', '**/dist/**', '**/build/**'];
        const cliIgnores = this.ignorePatterns.map(p => this.normalizeIgnorePattern(p));

        let files = await fg(patterns, {
            cwd: this.cwd,
            absolute: true,
            ignore: [...defaultIgnores, ...cliIgnores],
            unique: true
        });

        if (files.length === 0) {
            // Fallback: If no files found with specific patterns, try general JS/TS files
            const fallback = ['**/*.{js,ts,tsx,jsx}'];
            files = await fg(fallback, {
                cwd: this.cwd,
                absolute: true,
                ignore: [...defaultIgnores, ...cliIgnores],
                unique: true
            });

            if (files.length === 0) {
                this.logger.log('[Analyzer] No source files found to lint.');
                return [];
            }
        }

        let useInternal = this.options.forceInternalEslint;
        if (!useInternal) {
            // Simple check for config
            try {
                const configs: string[] = await fg(['.eslintrc.*', 'eslint.config.js', 'package.json'], { cwd: this.cwd, deep: 1, absolute: true });
                const hasConfig = configs.some((c: string) => {
                    if (c.endsWith('package.json')) {
                        const pkg = JSON.parse(fs.readFileSync(c, 'utf-8'));
                        return !!pkg.eslintConfig;
                    }
                    return true;
                });
                if (!hasConfig) useInternal = true;
            } catch { useInternal = true; }
        }

        try {
            const eslintOpts: any = {
                cwd: this.cwd,
                fix: false,
                useEslintrc: !useInternal,
                baseConfig: useInternal ? this._buildEslintConfig() : undefined,
                errorOnUnmatchedPattern: false
            };
            const eslint = new ESLint(eslintOpts);

            // Filter out ignored files to prevent "File ignored by default" warnings
            const filesToLint: string[] = [];
            for (const file of files) {
                const isIgnored = await eslint.isPathIgnored(file);
                if (!isIgnored) {
                    filesToLint.push(file);
                }
            }

            if (filesToLint.length === 0) return [];
            return await eslint.lintFiles(filesToLint);
        } catch (e: any) {
            // If failed to load config, fallback to internal config
            if (!useInternal && (e.message.includes('Failed to load config') || e.message.includes('find the module') || e.code === 'MODULE_NOT_FOUND')) {
                this.logger.log(`[Analyzer] Project ESLint config failed (${e.message}). Falling back to internal config...`);
                try {
                    const fallbackOpts: any = {
                        cwd: this.cwd,
                        fix: false,
                        useEslintrc: false,
                        baseConfig: this._buildEslintConfig(),
                        errorOnUnmatchedPattern: false
                    };
                    const eslint = new ESLint(fallbackOpts);
                    return await eslint.lintFiles(files);
                } catch (e2: any) {
                    this.logger.error(`[Analyzer] ESLint fallback also failed: ${e2.message}`);
                    return [];
                }
            }
            this.logger.error(`[Analyzer] ESLint failed: ${e.message}`);
            return [];
        }
    }

    private _buildEslintConfig(): any {
        return {
            ignorePatterns: ['node_modules/**', 'dist/**', 'build/**'],
            env: { es2021: true, browser: true, node: true },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true }
            },
            plugins: ['@typescript-eslint', 'unicorn', 'sonarjs', 'security'],
            extends: [
                'eslint:recommended',
                'plugin:unicorn/recommended',
                'plugin:sonarjs/recommended',
                'plugin:security/recommended'
            ],
            overrides: [
                {
                    files: ['**/*.ts', '**/*.tsx'],
                    parser: '@typescript-eslint/parser',
                    plugins: ['@typescript-eslint'],
                    extends: ['plugin:@typescript-eslint/recommended']
                }
            ]
        };
    }

    private async runDepCruiser(): Promise<any> {
        if (this.options.noDepCruiser) return { status: 'skipped', findings: [] };
        return { status: 'skipped', findings: [] };
    }


    async run(): Promise<AnalysisResult> {
        const start = Date.now();

        // 1. Run Legacy Tools
        const eslintPromise = this.runEslint();
        // const depCruiserPromise = this.runDepCruiser();

        // 2. Run Strategy Scanners
        const scanPromises = this.scanners.map(scanner => {
            if (scanner.isEnabled(this.options)) {
                return scanner.run({ cwd: this.cwd });
            }
            return Promise.resolve({ tool: scanner.name, status: 'skipped', findings: [] } as ScanResult);
        });

        // 3. Await All
        const [eslintResults, ...scanResults] = await Promise.all([
            eslintPromise,
            ...scanPromises
        ]);

        // 4. Aggregate Results
        const knipResult = scanResults.find(r => r.tool === 'Knip');
        const semgrepResult = scanResults.find(r => r.tool === 'Semgrep');
        const gitleaksResult = scanResults.find(r => r.tool === 'Gitleaks');
        const osvResult = scanResults.find(r => r.tool === 'OSV-Scanner');
        const jscpdResult = scanResults.find(r => r.tool === 'JSCPD');

        // Calculate total errors and warnings including all scanners
        let totalErrors = eslintResults.reduce((a, b) => a + b.errorCount, 0);
        let totalWarnings = eslintResults.reduce((a, b) => a + b.warningCount, 0);

        const sevMap: Record<string, number> = {
            'error': 2, 'err': 2, 'critical': 2, 'high': 2,
            'warning': 1, 'warn': 1, 'info': 1, 'medium': 1, 'low': 1
        };

        const addFindingsToSummary = (findings: any[]) => {
            if (!findings) return;
            findings.forEach(f => {
                const s = String(f.severity || '').toLowerCase();
                const sev = sevMap[s] || 1; // Default to warning for scanners if not explicit error
                if (sev === 2) totalErrors++;
                else totalWarnings++;
            });
        };

        if (knipResult?.findings) addFindingsToSummary(knipResult.findings);
        if (semgrepResult?.findings) addFindingsToSummary(semgrepResult.findings);
        if (gitleaksResult?.findings) addFindingsToSummary(gitleaksResult.findings);
        if (osvResult?.findings) addFindingsToSummary(osvResult.findings);

        // JSCPD Legacy Object Reconstruction
        let jscpdLegacy = { count: 0, percentage: 0, duplicates: [] };
        if (jscpdResult && jscpdResult.summary && jscpdResult.summary.duplicates) {
            jscpdLegacy = {
                count: jscpdResult.summary.duplicates.length,
                percentage: jscpdResult.summary.percentage || 0,
                duplicates: jscpdResult.summary.duplicates
            };
        }

        // JSCPD duplicates are counted as warnings in the report (2 warnings per duplicate)
        if (jscpdLegacy.count) {
            totalWarnings += (jscpdLegacy.count * 2);
        }

        return {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            summary: {
                errors: totalErrors,
                warnings: totalWarnings,
                files: eslintResults.length
            },
            results: eslintResults,
            jscpd: jscpdLegacy,
            semgrep: semgrepResult ? { findings: semgrepResult.findings } : { findings: [] },
            osv: osvResult ? { findings: osvResult.findings } : { findings: [] },
            gitleaks: gitleaksResult ? { findings: gitleaksResult.findings } : { findings: [] },
            knip: knipResult ? { findings: knipResult.findings } : { findings: [] },
            depCruiser: { findings: [] }
        };
    }
}