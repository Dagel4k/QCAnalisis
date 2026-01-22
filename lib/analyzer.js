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
        this.noJscpd = options.noJscpd;
        this.noSecretScan = options.noSecretScan;
        this.noOsv = options.noOsv;
        this.noSemgrep = options.noSemgrep;
        this.noGitleaks = options.noGitleaks;
        this.noKnip = options.noKnip;
        this.noDepCruiser = options.noDepCruiser;
    }

    _buildEslintConfig() {
        const {
            noUnicorn = false,
            noImport = false,
            noSonar = false,
            noSecurity = false,
        } = {}; // Could assume options passed if needed

        // Environment overrides
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
                useEslintrc: false,
                baseConfig: config,
                errorOnUnmatchedPattern: false
            });
            return await eslint.lintFiles(files);
        } catch (e) {
            console.warn(`[WARN] ESLint failed: ${e.message}`);
            return [];
        }
    }

    runJscpd() {
        if (this.noJscpd) return { status: 'skipped', count: 0, percentage: 0, duplicates: [] };
        try {
            console.log('[Analyzer] Running jscpd...');
            const tempFile = path.join(this.cwd, 'reports', 'jscpd-report.json');

            const localBin = path.join(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
            const ignoreArg = this.ignorePatterns.length
                ? ` --ignore "${this.ignorePatterns.map(normalizeIgnorePattern).join(',')}"`
                : '';

            let baseCmd = `npx jscpd src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`;
            if (fs.existsSync(localBin)) {
                baseCmd = `"${localBin}" src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`;
            }

            try { execSync(baseCmd, { cwd: this.cwd, encoding: 'utf-8', stdio: 'pipe' }); } catch (e) { /* ignore non-zero exit */ }

            if (fs.existsSync(tempFile)) {
                const content = fs.readFileSync(tempFile, 'utf-8');
                const result = JSON.parse(content);
                return {
                    status: 'success',
                    count: (result.duplicates || []).length,
                    percentage: result.statistics?.percentage || 0,
                    duplicates: (result.duplicates || []).slice(0, 50)
                };
            }
            return { status: 'success', count: 0, percentage: 0, duplicates: [] };
        } catch (e) {
            console.warn(`[Analyzer] FSCPD failed: ${e.message}`);
            return { status: 'error', error: e.message, count: 0, percentage: 0, duplicates: [] };
        }
    }

    /**
     * Generic helper to run external security tools (Binary or Docker)
     */
    _runTool({ bin, dockerImage, args, parseOutput, name, dockerCommand }) {
        if (this[`no${name}`]) return { status: 'skipped', findings: [] };
        if (!hasBin(bin) && !hasDocker()) return { status: 'error', error: 'Binary and Docker not available', findings: [] };

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

            if (!res.stdout) return { status: 'success', findings: [] };
            return { status: 'success', findings: parseOutput(res.stdout) };
        } catch (e) {
            console.warn(`[Analyzer] ${name} failed: ${e.message}`);
            return { status: 'error', error: e.message, findings: [] };
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

    async runKnip() {
        if (this.noKnip) return { status: 'skipped', findings: [] };
        console.log('[Analyzer] Running Knip (Deep Unused Code Scan)...');

        const localBin = path.join(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'knip.cmd' : 'knip');

        let cmd = 'npx';
        let args = ['knip', '--reporter', 'json', '--no-exit-code'];

        if (fs.existsSync(localBin)) {
            cmd = localBin;
            args = ['--reporter', 'json', '--no-exit-code'];
        } else {
            args = ['--yes', 'knip', '--reporter', 'json', '--no-exit-code'];
        }

        try {
            const res = spawnSync(cmd, args, {
                cwd: this.cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 20 * 1024 * 1024
            });

            if (!res.stdout) return { status: 'success', findings: [] };

            try {
                const json = JSON.parse(res.stdout);
                const findings = [];
                const types = ['files', 'dependencies', 'devDependencies', 'unlisted', 'exports', 'types'];

                for (const type of types) {
                    if (Array.isArray(json[type])) {
                        for (const issue of json[type]) {
                            findings.push({
                                type: `knip-${type}`,
                                file: issue.file || 'unknown',
                                message: `${type}: ${issue.name || issue.file}`,
                                rule: `knip/${type}`,
                                line: issue.line || 1,
                                col: issue.col || 1
                            });
                        }
                    }
                }

                if (Array.isArray(json.issues)) {
                    for (const issue of json.issues) {
                        findings.push({
                            type: 'knip-issue',
                            file: issue.file || 'unknown',
                            message: issue.message || `Unused ${issue.type}`,
                            rule: `knip/${issue.type}`,
                            line: issue.line || 1,
                            col: issue.col || 1
                        });
                    }
                }

                return { status: 'success', findings };
            } catch (parseErr) {
                console.warn('[Analyzer] Failed to parse Knip JSON:', parseErr.message);
                return { status: 'error', error: 'Invalid JSON output', findings: [] };
            }
        } catch (e) {
            console.warn(`[Analyzer] Knip failed: ${e.message}`);
            return { status: 'error', error: e.message, findings: [] };
        }
    }

    async runDepCruiser() {
        if (this.noDepCruiser) return { status: 'skipped', findings: [] };
        console.log('[Analyzer] Running Dependency Cruiser (Architecture)...');

        // Check for config, if not exists, create a temp one
        const configPath = path.join(this.cwd, '.dependency-cruiser.js');
        const jsonConfigPath = path.join(this.cwd, '.dependency-cruiser.json');
        let needsConfig = !fs.existsSync(configPath) && !fs.existsSync(jsonConfigPath);

        let tempConfigPath = null;
        if (needsConfig) {
            tempConfigPath = path.join(this.cwd, '.tmp-dep-cruiser-config.json');
            // Minimal config to detect circulars and orphans
            const minConfig = {
                options: {
                    doNotFollow: { path: "node_modules" },
                    tsPreCompilationDeps: true,
                    tsConfig: { fileName: "tsconfig.json" }
                },
                forbidden: [
                    {
                        name: "no-circular",
                        severity: "error",
                        comment: "This module is part of a circular dependency",
                        from: {},
                        to: { circular: true }
                    }
                ]
            };
            try {
                fs.writeFileSync(tempConfigPath, JSON.stringify(minConfig, null, 2));
            } catch (e) {
                console.warn('Failed to write temp dep-cruise config', e);
            }
        }

        const localBin = path.join(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise');
        let cmd = 'npx';
        // Scan src directory
        let args = ['depcruise', 'src', '--output-type', 'json'];

        if (tempConfigPath) {
            args.push('--config', '.tmp-dep-cruiser-config.json');
        } else {
            args.push('--validate'); // Use existing config
        }

        if (fs.existsSync(localBin)) {
            cmd = localBin;
            args = ['src', '--output-type', 'json'];
            if (tempConfigPath) args.push('--config', '.tmp-dep-cruiser-config.json');
            else args.push('--validate');
        } else {
            args = ['--yes', ...args];
        }

        try {
            const res = spawnSync(cmd, args, {
                cwd: this.cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 20 * 1024 * 1024
            });

            // Cleanup temp config
            if (tempConfigPath && fs.existsSync(tempConfigPath)) {
                try { fs.unlinkSync(tempConfigPath); } catch (e) { }
            }

            if (!res.stdout) return { status: 'success', findings: [] };

            try {
                const json = JSON.parse(res.stdout);
                const findings = [];
                // Dep cruiser output: { summary: { violations: [] } }
                if (json.summary && Array.isArray(json.summary.violations)) {
                    for (const v of json.summary.violations) {
                        findings.push({
                            type: 'architecture',
                            rule: v.rule.name,
                            file: v.from,
                            message: `${v.rule.name}: ${v.from} -> ${v.to}`,
                            severity: v.severity
                        });
                    }
                }
                return { status: 'success', findings, summary: json.summary };
            } catch (parseErr) {
                return { status: 'error', error: 'Invalid JSON output' + parseErr.message, findings: [] };
            }

        } catch (e) {
            return { status: 'error', error: e.message, findings: [] };
        }
    }

    async run() {
        const start = Date.now();

        const [eslintResults, jscpd, semgrep, osv, gitleaks, knip, depCruiser] = await Promise.all([
            this.runEslint(),
            Promise.resolve(this.runJscpd()),
            Promise.resolve(this.runSemgrep()),
            Promise.resolve(this.runOsvScanner()),
            Promise.resolve(this.runGitleaks()),
            Promise.resolve(this.runKnip()),
            Promise.resolve(this.runDepCruiser())
        ]);

        const errorCount = (eslintResults || []).reduce((s, r) => s + r.errorCount, 0);
        const warningCount = (eslintResults || []).reduce((s, r) => s + r.warningCount, 0);

        return {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            summary: {
                errors: errorCount,
                warnings: warningCount,
                files: (eslintResults || []).length
            },
            results: eslintResults || [],
            jscpd,
            semgrep,
            osv,
            gitleaks,
            knip,
            depCruiser
        };
    }
}

module.exports = { Analyzer };
