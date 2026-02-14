import * as fs from 'fs';
import { ESLint } from 'eslint';
const fg = require('fast-glob');
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';

export class EslintScanner extends BaseScanner {
    name = 'ESLint';
    version = '8.x';

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        const globs = context.config?.globs;
        const patterns = globs ? (Array.isArray(globs) ? globs : [globs]) : ['src/**/*.{js,ts,tsx,jsx}'];
        const defaultIgnores = ['**/node_modules/**', '**/dist/**', '**/build/**'];

        let ignorePatterns: string[] = context.config?.ignore || [];
        const cliIgnores = ignorePatterns.map(p => this.normalizeIgnorePattern(p));

        // File discovery
        let files = await fg(patterns, {
            cwd: context.cwd,
            absolute: true,
            ignore: [...defaultIgnores, ...cliIgnores],
            unique: true
        });

        if (files.length === 0) {
            // Fallback
            const fallback = ['**/*.{js,ts,tsx,jsx}'];
            files = await fg(fallback, {
                cwd: context.cwd,
                absolute: true,
                ignore: [...defaultIgnores, ...cliIgnores],
                unique: true
            });
        }

        if (files.length === 0) {
            return [];
        }

        let useInternal = context.config?.forceInternalEslint;
        if (!useInternal) {
            try {
                const configs: string[] = await fg(['.eslintrc.*', 'eslint.config.js', 'package.json'], { cwd: context.cwd, deep: 1, absolute: true });
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

        let results: ESLint.LintResult[] = [];

        try {
            const eslintOpts: any = {
                cwd: context.cwd,
                fix: false,
                useEslintrc: !useInternal,
                baseConfig: useInternal ? this._buildEslintConfig() : undefined,
                errorOnUnmatchedPattern: false
            };
            const eslint = new ESLint(eslintOpts);

            const filesToLint: string[] = [];
            for (const file of files) {
                const isIgnored = await eslint.isPathIgnored(file);
                if (!isIgnored) {
                    filesToLint.push(file);
                }
            }

            if (filesToLint.length > 0) {
                results = await eslint.lintFiles(filesToLint);
            }
        } catch (e: any) {
            // Fallback logic for config failure
            if (!useInternal && (e.message.includes('Failed to load config') || e.message.includes('find the module') || e.code === 'MODULE_NOT_FOUND')) {
                context.logger.log(`[ESLint] Project config failed (${e.message}). Falling back to internal config...`);
                try {
                    const fallbackOpts: any = {
                        cwd: context.cwd,
                        fix: false,
                        useEslintrc: false,
                        baseConfig: this._buildEslintConfig(),
                        errorOnUnmatchedPattern: false
                    };
                    const eslint = new ESLint(fallbackOpts);
                    results = await eslint.lintFiles(files);
                } catch (e2: any) {
                    throw new Error(`ESLint fallback failed: ${e2.message}`);
                }
            } else {
                throw e;
            }
        }

        return this.mapResults(results, context.cwd);
    }

    private mapResults(results: ESLint.LintResult[], cwd: string): Issue[] {
        const issues: Issue[] = [];
        for (const res of results) {
            const filePath = res.filePath; // Absolute path usually
            // We want relative path for reporting usually, or we keep absolute and let report generator handle it.
            // But ScanFinding usually had 'file' as relative or absolute? 
            // In Analyzer before: `results: ESLint.LintResult[]`.
            // HtmlGenerator did `path.relative(this.cwd, res.filePath)`.
            // Let's store absolute path in 'file' to be safe, or relative?
            // The new Issue interface says 'file: string;'.

            for (const msg of res.messages) {
                issues.push(this.createIssue(
                    msg.severity === 2 ? 'high' : 'medium', // 2=error, 1=warning
                    msg.message,
                    filePath,
                    msg.line,
                    {
                        col: msg.column,
                        code: msg.ruleId || 'unknown',
                        context: {
                            source: res.source, // Might be undefined
                            errorCount: res.errorCount,
                            warningCount: res.warningCount
                        }
                    }
                ));
            }
        }
        return issues;
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
}
