import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue, ScanResult } from './scanner.types';

export class KnipScanner extends BaseScanner {
    name = 'Knip';
    version = '1.0.0';

    isEnabled(context: AnalysisContext): boolean {
        if (!super.isEnabled(context)) return false;
        // Detect JS/TS project
        return fs.existsSync(path.join(context.cwd, 'package.json'));
    }

    /**
     * Filter out common false positives from Knip findings.
     * Many legitimate binaries and dependencies are flagged incorrectly.
     */
    private filterFalsePositives(findings: Issue[], projectRoot: string): Issue[] {
        // Common binaries that are typically false positives
        const COMMON_BINARIES_WHITELIST = [
            'react-scripts', 'serve', 'vite', 'webpack-dev-server', 'webpack',
            'eslint', 'prettier', 'stylelint', 'tsc', 'tslint',
            'husky', 'lint-staged', 'plop', 'hygen',
            'snyk', 'i18next-scanner', 'babel', 'esbuild',
            'jest', 'vitest', 'mocha', 'ava', 'cypress', 'playwright',
            'next', 'nuxt', 'remix', 'astro',
            'rollup', 'parcel', 'turbo', 'nx'
        ];

        // Specific packages that are commonly false positives (exact match)
        // These are development/build tools that Knip often incorrectly flags
        const COMMON_DEV_DEPENDENCIES = [
            'husky', 'lint-staged', 'prettier', 'stylelint',
            'plop', 'hygen', 'serve', 'i18next-scanner',
            'react-is', 'react-test-renderer', 'jest-styled-components',
            'less', 'sass', 'node-sass', 'semver',
            'inquirer', 'inquirer-directory', 'shelljs', 'chalk',
            'cross-env', 'dotenv', 'rimraf', 'ts-node',
            'subscriptions-transport-ws', 'graphql-subscriptions'
        ];

        // Dependency patterns that are commonly false positives
        const DEPENDENCY_PATTERNS_WHITELIST = [
            /^@types\//,                    // TypeScript type definitions
            /^@testing-library\//,          // Testing libraries
            /^@emotion\/(react|styled)$/,   // Emotion React core packages
            /^@mui\/styled-engine/,         // MUI styled engine packages
            /^styled-components$/,          // Styled components
            /^babel-plugin-/,               // Babel plugins
            /^babel-preset-/,               // Babel presets
            /^eslint-(config|plugin)-/,     // ESLint configs and plugins
            /^stylelint-(config|plugin|processor)-/,  // Stylelint configs, plugins, and processors
            /^prettier-plugin-/,            // Prettier plugins
            /^postcss-/,                    // PostCSS plugins
            /^@babel\/plugin-/,             // Scoped Babel plugins
            /^@babel\/preset-/,             // Scoped Babel presets
            /^@typescript-eslint\//,        // TypeScript ESLint
            /@hookform\/resolvers$/,        // React Hook Form resolvers
            /^webpack-/,                    // Webpack loaders/plugins
            /^vite-plugin-/,                // Vite plugins
            /^react-app-/,                  // React App utilities
            /^i18next-/,                    // i18next plugins
        ];

        // Read custom ignore patterns from package.json if they exist
        let customIgnorePatterns: string[] = [];
        try {
            const pkgPath = path.join(projectRoot, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                customIgnorePatterns = pkg.knipConfig?.ignorePatterns || [];
            }
        } catch (e) {
            // Silently ignore errors reading package.json
        }

        return findings.filter(f => {
            const type = f.context?.type;
            const message = f.message;

            // Filter known false positive binaries
            if (type === 'knip-binaries') {
                const binaryName = this.extractName(message);
                if (COMMON_BINARIES_WHITELIST.includes(binaryName)) {
                    return false; // Exclude this false positive
                }
            }

            // Filter known false positive dependencies
            if (type === 'knip-dependencies' || type === 'knip-devDependencies') {
                const depName = this.extractName(message);

                // Check exact match against common dev dependencies
                if (COMMON_DEV_DEPENDENCIES.includes(depName)) {
                    return false;
                }

                // Check against whitelist patterns
                if (DEPENDENCY_PATTERNS_WHITELIST.some(pattern => pattern.test(depName))) {
                    return false;
                }

                // Check against custom ignore patterns
                if (customIgnorePatterns.includes(depName)) {
                    return false;
                }
            }

            return true; // Keep this finding
        });
    }

    /**
     * Extract the name from a Knip message.
     * Examples:
     *   "binaries: react-scripts" -> "react-scripts"
     *   "dependencies: @emotion/react" -> "@emotion/react"
     */
    private extractName(message: string): string {
        const match = message.match(/^(?:binaries|dependencies|devDependencies|optionalPeerDependencies|unlisted|unresolved|exports|types|enumMembers|classMembers|duplicates):\s*(.+)$/);
        return match ? match[1].trim() : '';
    }

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        const localBin = path.join(context.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'knip.cmd' : 'knip');

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
                    const pkg = JSON.parse(fs.readFileSync(path.join(context.cwd, f), 'utf-8'));
                    return !!pkg.knip;
                } catch { return false; }
            }
            return fs.existsSync(path.join(context.cwd, f));
        });

        const tempConfigPath = path.join(context.cwd, 'knip.json');
        let createdTempConfig = false;

        if (!hasConfig) {
            // Inject a temporary config to disable plugins that cause issues due to missing dependencies
            try {
                const effectiveConfig = {
                    eslint: false,
                    vite: false,
                    vitest: false,
                    ignore: [
                        '**/*.test.{js,ts,jsx,tsx}',
                        '**/*.spec.{js,ts,jsx,tsx}',
                        '**/*.mock.{js,ts,jsx,tsx}',
                        '**/__tests__/**',
                        '**/__mocks__/**',
                        'internals/**',
                        'setupTests.ts',
                        'jest.setup.ts',
                        '.*rc.js',
                        '*.config.{js,ts,cjs,mjs}',
                        'docs/**'
                    ],
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
                context.logger.log(`[Knip] Failed to create temp knip.json: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        try {
            const res = spawnSync(cmd, args, {
                cwd: context.cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 20 * 1024 * 1024
            });

            if (!res.stdout) {
                if (res.stderr) {
                    throw new Error(`Knip produced no output but wrote to stderr: ${res.stderr}`);
                }
                return [];
            }

            try {
                const json = JSON.parse(res.stdout);
                const findings: Issue[] = [];

                // 1. Handle unused files (Top-level array of strings)
                if (Array.isArray(json.files)) {
                    for (const file of json.files) {
                        findings.push(this.createIssue(
                            'low',
                            'Unused file',
                            String(file),
                            1,
                            {
                                code: 'knip/unused-file',
                                context: { type: 'knip-unused-file' }
                            }
                        ));
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
                                    findings.push(this.createIssue(
                                        'medium',
                                        `${cat}: ${item.name || item.symbol || 'issue'}`,
                                        file,
                                        item.line || 1,
                                        {
                                            col: item.col || 1,
                                            code: `knip/${cat}`,
                                            context: { type: `knip-${cat}` }
                                        }
                                    ));
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
                                findings.push(this.createIssue(
                                    'medium',
                                    `${type}: ${issue.name || issue.file}`,
                                    issue.file || 'unknown',
                                    issue.line || 1,
                                    {
                                        col: issue.col || 1,
                                        code: `knip/${type}`,
                                        context: { type: `knip-${type}` }
                                    }
                                ));
                            }
                        }
                    }
                }

                return this.filterFalsePositives(findings, context.cwd);

            } catch (parseErr: unknown) {
                // ... Error handling logic for JSON parse ...
                let errorMsg = 'Invalid JSON output';
                const stderr = res.stderr ? res.stderr.trim() : '';
                const stdout = res.stdout ? res.stdout.trim() : '';

                if (stderr) errorMsg = stderr;
                else if (stdout.startsWith('Module loading failed') || stdout.startsWith('Error:')) errorMsg = stdout.split('\n')[0];

                context.logger.log(`[Knip] WARN: Failed to parse output. Start: "${stdout.slice(0, 50)}..."`);
                throw new Error(errorMsg);
            }
        } finally {
            if (createdTempConfig && fs.existsSync(tempConfigPath)) {
                try { fs.unlinkSync(tempConfigPath); } catch (e) { }
            }
        }
    }
}

