const { ESLint } = require('eslint');
const fg = require('fast-glob');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

/**
 * Helper to check if a module can be resolved
 */
function canResolve(mod) {
    try {
        const searchPaths = [
            process.cwd(),
            path.join(process.cwd(), 'node_modules'),
            path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
            path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules'),
            __dirname,
            path.join(__dirname, '..', 'node_modules'),
        ];
        require.resolve(mod, { paths: searchPaths });
        return true;
    } catch {
        return false;
    }
}

/**
 * Helper to check if binary exists
 */
function hasBin(cmd) {
    try {
        const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
        return res.status === 0 || res.status === 1;
    } catch { return false; }
}

function hasDocker() {
    try {
        const res = spawnSync('docker', ['--version'], { stdio: 'ignore' });
        return res.status === 0;
    } catch { return false; }
}

/**
 * Normalizes ignore patterns for globs
 */
function normalizeIgnorePattern(pat) {
    let p = (pat || '').trim();
    if (!p) return '';
    if (p.startsWith('/')) p = `**${p}`;
    if (p.endsWith('/')) p = `${p}**`;
    if (!/[*?]/.test(p) && !/\.[a-zA-Z0-9]+$/.test(p)) {
        p = `**/${p}/**`;
    }
    return p;
}

// Convert a glob-like pattern into a loose regex string for CLI tools that accept regex (ts-prune)
function globToRegexString(glob) {
    const g = normalizeIgnorePattern(glob)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex specials first
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
    return g;
}

/**
 * Analyzer Class
 */
class Analyzer {
    constructor(options = {}) {
        this.cwd = options.cwd || process.cwd();
        this.ignorePatterns = options.ignore || [];
        this.globs = options.globs;

        // Flags
        this.forceInternalEslint = options.forceInternalEslint;
        this.noTsPrune = options.noTsPrune;
        this.noJscpd = options.noJscpd;
        this.noSecretScan = options.noSecretScan;
        this.noOsv = options.noOsv;
        this.noSemgrep = options.noSemgrep;
        this.noGitleaks = options.noGitleaks;
    }

    _buildEslintConfig() {
        const {
            noUnicorn = false,
            noImport = false,
            noSonar = false,
            noSecurity = false,
        } = {}; // Could assume options passed if needed

        // Environment overrides (simplifying for this class, but keeping core logic)
        const hasTsParserOld = canResolve('@typescript-eslint/parser');
        const hasTsParserNew = canResolve('typescript-eslint/parser');
        const tsParserPath = hasTsParserOld ? '@typescript-eslint/parser' : (hasTsParserNew ? 'typescript-eslint/parser' : null);
        const hasTsParser = !!tsParserPath;
        const hasTsPlugin = canResolve('@typescript-eslint/eslint-plugin') || canResolve('typescript-eslint');
        const hasImport = !noImport && canResolve('eslint-plugin-import');
        const hasSonar = !noSonar && canResolve('eslint-plugin-sonarjs');
        const hasUnicorn = !noUnicorn && canResolve('eslint-plugin-unicorn');
        const hasSecurity = !noSecurity && canResolve('eslint-plugin-security');

        const hasImportResolverTs = canResolve('eslint-import-resolver-typescript');

        const base = {
            ignorePatterns: ['node_modules/**', 'dist/**', 'build/**'],
            env: { es2021: true, browser: true, node: true },
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
            extends: ['eslint:recommended'],
            plugins: [],
            overrides: [],
            rules: {},
            settings: {
                ...(hasImport ? {
                    'import/resolver': hasImportResolverTs
                        ? {
                            typescript: {
                                project: [
                                    path.join(this.cwd, 'repo-scan-dashboard-main', 'tsconfig.json'),
                                    path.join(this.cwd, 'tsconfig.json')
                                ],
                                alwaysTryTypes: true,
                            },
                            node: {
                                extensions: ['.ts', '.tsx', '.js', '.jsx'],
                                paths: [path.join(this.cwd, 'node_modules')],
                            },
                        }
                        : {
                            node: {
                                extensions: ['.ts', '.tsx', '.js', '.jsx'],
                                paths: [path.join(this.cwd, 'node_modules')],
                            },
                        },
                } : {}),
            },
        };

        if (hasSecurity) {
            base.plugins.push('security');
            base.extends.push('plugin:security/recommended');
        }

        if (hasTsParser) {
            base.overrides.push({
                files: ['**/*.ts', '**/*.tsx'],
                parser: tsParserPath,
                parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
                plugins: [
                    ...(hasTsPlugin ? ['@typescript-eslint'] : []),
                    ...(hasImport ? ['import'] : []),
                    ...(hasSonar ? ['sonarjs'] : []),
                    ...(hasUnicorn ? ['unicorn'] : []),
                    ...(hasSecurity ? ['security'] : []),
                ],
                extends: [
                    ...(hasTsPlugin ? ['plugin:@typescript-eslint/recommended'] : []),
                    ...(hasImport ? ['plugin:import/recommended', 'plugin:import/typescript'] : []),
                    ...(hasSonar ? ['plugin:sonarjs/recommended'] : []),
                    ...(hasUnicorn ? ['plugin:unicorn/recommended'] : []),
                    ...(hasSecurity ? ['plugin:security/recommended'] : []),
                ],
                settings: base.settings,
                rules: {
                    'import/no-unresolved': 'off', // simplified to reduce noise
                },
            });
        }
        return base;
    }

    async runEslint() {
        const patterns = this.globs ? (Array.isArray(this.globs) ? this.globs : [this.globs]) : ['src/**/*.{js,ts,tsx,jsx}'];
        const defaultIgnores = ['**/node_modules/**', '**/dist/**', '**/build/**'];
        const cliIgnores = this.ignorePatterns.map(normalizeIgnorePattern);

        // We need fallback logic if files are not found, similar to the original script
        let files = await fg(patterns, {
            cwd: this.cwd,
            absolute: true,
            ignore: [...defaultIgnores, ...cliIgnores],
            unique: true
        });

        if (files.length === 0) {
            const fallback = ['**/*.{js,ts,tsx,jsx}'];
            files = await fg(fallback, {
                cwd: this.cwd,
                absolute: true,
                ignore: [...defaultIgnores, ...cliIgnores],
                unique: true
            });
            if (files.length === 0) return [];
        }

        // Create tmp package.json if needed to avoid ESLint internal conflicts
        const tmpCwd = path.join(this.cwd, 'reports', '.eslint-tmp');
        try { fs.mkdirSync(tmpCwd, { recursive: true }); } catch (e) { (void e); }
        try {
            const pkgPath = path.join(tmpCwd, 'package.json');
            if (!fs.existsSync(pkgPath)) {
                fs.writeFileSync(pkgPath, JSON.stringify({ name: 'eslint-tmp', private: true }, null, 2), 'utf8');
            }
        } catch (e) { (void e); }

        const config = this._buildEslintConfig();

        try {
            const eslint = new ESLint({
                cwd: this.cwd,
                fix: false,
                useEslintrc: false, // We force our config for consistency in this tool
                baseConfig: config,
                errorOnUnmatchedPattern: false
            });
            return await eslint.lintFiles(files);
        } catch (e) {
            console.warn(`[WARN] ESLint failed: ${e.message}. return empty results.`);
            // Attempt fallback without unicorn if that was the issue? 
            // For now, simpler error handling.
            return [];
        }
    }

    runTsPrune() {
        if (this.noTsPrune) return { count: 0, items: [] };
        const tsconfigPath = path.join(this.cwd, 'tsconfig.json');
        if (!fs.existsSync(tsconfigPath)) return { count: 0, items: [] };

        try {
            console.log('[Analyzer] Running ts-prune...');
            const localBin = path.join(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');
            const nestedBin = path.join(this.cwd, 'node_modules', '@scriptc', 'dev-tools', 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');

            const extraIgnores = this.ignorePatterns.map(globToRegexString).filter(Boolean);
            const ignoreRegex = ['\\.pb\\.ts$', '/proto/', '/protos/', ...extraIgnores].filter(Boolean).join('|');

            let cmd = `npx ts-prune src --ignore "${ignoreRegex}"`;
            if (fs.existsSync(localBin)) cmd = `"${localBin}" src --ignore "${ignoreRegex}"`;
            else if (fs.existsSync(nestedBin)) cmd = `"${nestedBin}" src --ignore "${ignoreRegex}"`;

            const output = execSync(cmd, { cwd: this.cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

            const lines = output.split('\n').filter(line => line.trim());
            const unusedExports = lines.map(line => {
                const match = line.match(/^(.+?):(\d+)\s*-\s*(.+)$/);
                if (!match) return null;
                return {
                    file: match[1],
                    line: parseInt(match[2], 10),
                    export: match[3],
                };
            }).filter(Boolean);
            return { count: unusedExports.length, items: unusedExports };
        } catch (e) {
            return { count: 0, items: [] };
        }
    }

    runJscpd() {
        if (this.noJscpd) return { count: 0, percentage: 0, duplicates: [] };
        try {
            console.log('[Analyzer] Running jscpd...');
            const tempFile = path.join(this.cwd, 'reports', 'jscpd-report.json');

            const localBin = path.join(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
            const ignoreArg = this.ignorePatterns.length
                ? ` --ignore "${this.ignorePatterns.map(normalizeIgnorePattern).join(',')}"`
                : '';

            // We use spawnSync mostly to hide/manage output better, or execSync with stdio pipe
            // Defaulting to generic npx if local bin missing
            let baseCmd = `npx jscpd src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`;
            if (fs.existsSync(localBin)) {
                baseCmd = `"${localBin}" src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`;
            }

            try { execSync(baseCmd, { cwd: this.cwd, encoding: 'utf-8', stdio: 'pipe' }); } catch (e) { /* ignore non-zero exit */ }

            if (fs.existsSync(tempFile)) {
                const content = fs.readFileSync(tempFile, 'utf-8');
                const result = JSON.parse(content);
                return {
                    count: (result.duplicates || []).length,
                    percentage: result.statistics?.percentage || 0,
                    duplicates: (result.duplicates || []).slice(0, 50)
                };
            }
            return { count: 0, percentage: 0, duplicates: [] };
        } catch (e) {
            return { count: 0, percentage: 0, duplicates: [] };
        }
    }

    /**
     * Generic helper to run external security tools (Binary or Docker)
     */
    _runTool({ bin, dockerImage, args, parseOutput, name, dockerCommand }) {
        if (this[`no${name}`]) return [];
        if (!hasBin(bin) && !hasDocker()) return [];

        console.log(`[Analyzer] Running ${name}...`);
        try {
            const runViaDocker = !hasBin(bin) && hasDocker();
            let res;

            if (runViaDocker) {
                const image = process.env[`${name.toUpperCase()}_IMAGE`] || dockerImage;
                const cmd = dockerCommand || [];
                const dockerArgs = ['run', '--rm', '-v', `${this.cwd}:/src`, '-w', '/src', image, ...cmd, ...args];
                res = spawnSync('docker', dockerArgs, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
            } else {
                res = spawnSync(bin, args, { cwd: this.cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
            }

            if (!res.stdout) return [];
            return parseOutput(res.stdout);
        } catch (e) {
            console.warn(`[Analyzer] ${name} failed: ${e.message}`);
            return [];
        }
    }

    runSemgrep() {
        const cfg = (process.env.SEMGREP_CONFIG || 'p/ci').trim();
        const args = ['--quiet', '--json', '--timeout', '120', '--config', cfg];

        for (const pat of this.ignorePatterns) {
            if (pat.includes('node_modules') || pat.endsWith('/**') || !pat.includes('*')) {
                args.push('--exclude', pat.replace('/**', ''));
            }
        }

        return this._runTool({
            name: 'Semgrep',
            bin: 'semgrep',
            dockerImage: 'returntocorp/semgrep:latest',
            args: args,
            dockerCommand: ['semgrep'],
            parseOutput: (stdout) => {
                try {
                    const json = JSON.parse(stdout);
                    if (json && Array.isArray(json.results)) {
                        return json.results.map(r => ({
                            check_id: r.check_id,
                            path: r.path,
                            start: r.start ? (r.start.line || 1) : 1,
                            severity: (r.extra && r.extra.severity) || 'WARNING',
                            message: (r.extra && r.extra.message) || '',
                        }));
                    }
                    return [];
                } catch { return []; }
            }
        });
    }

    runOsvScanner() {
        return this._runTool({
            name: 'Osv',
            bin: 'osv-scanner',
            dockerImage: 'ghcr.io/google/osv-scanner:latest',
            args: ['--format', 'json', '--recursive', '.'],
            parseOutput: (stdout) => {
                try {
                    const json = JSON.parse(stdout);
                    const findings = [];
                    if (json && Array.isArray(json.results)) {
                        for (const r of json.results) {
                            const source = r.source && (r.source.path || r.source);
                            for (const p of (r.packages || [])) {
                                const pkg = p.package || {};
                                const version = (pkg.version || p.version || 'unknown');
                                for (const vuln of (p.vulnerabilities || [])) {
                                    findings.push({
                                        id: vuln.id || 'OSV',
                                        package: pkg.name || 'unknown',
                                        version,
                                        source: String(source || ''),
                                        summary: vuln.summary || '',
                                    });
                                }
                            }
                        }
                    }
                    return findings;
                } catch { return []; }
            }
        });
    }

    runGitleaks() {
        return this._runTool({
            name: 'Gitleaks',
            bin: 'gitleaks',
            dockerImage: 'zricethezav/gitleaks:latest',
            args: ['detect', '--no-git', '--redact', '--report-format', 'json', '--source', '.'],
            parseOutput: (stdout) => {
                try {
                    const json = JSON.parse(stdout);
                    const raw = Array.isArray(json) ? json : (json.findings || []);
                    return raw.map(x => ({
                        file: x.File || x.file || 'unknown',
                        line: x.StartLine || x.startLine || x.Line || 1,
                        rule: x.RuleID || x.ruleID || x.Rule || 'gitleaks',
                        match: x.Match || x.match || '',
                    }));
                } catch { return []; }
            }
        });
    }

    async run() {
        const start = Date.now();

        // Execute tools in parallel
        // Note: runEslint is natively async. Others are synchronous but wrapped in Promise.resolve by Promise.all implicitly or explicitly for consistency.
        const [eslintResults, tsPrune, jscpd, semgrep, osv, gitleaks] = await Promise.all([
            this.runEslint(),
            Promise.resolve(this.runTsPrune()),
            Promise.resolve(this.runJscpd()),
            Promise.resolve(this.runSemgrep()),
            Promise.resolve(this.runOsvScanner()),
            Promise.resolve(this.runGitleaks())
        ]);

        // Calculate derived things
        const errorCount = eslintResults.reduce((s, r) => s + r.errorCount, 0);
        const warningCount = eslintResults.reduce((s, r) => s + r.warningCount, 0);

        return {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            summary: {
                errors: errorCount,
                warnings: warningCount,
                files: eslintResults.length
            },
            results: eslintResults,
            tsPrune,
            jscpd,
            semgrep,
            osv,
            gitleaks
        };
    }
}

module.exports = { Analyzer };
