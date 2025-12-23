const { ESLint } = require('eslint');
const fg = require('fast-glob');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

let codeToHtml;
let lintGlobs;
let forceInternalEslint = process.env.REPORT_USE_INTERNAL_ESLINT_CONFIG === '1';
let noTsPrune = process.env.REPORT_NO_TSPRUNE === '1';
let noJscpd = process.env.REPORT_NO_JSCPD === '1';
let noSecretScan = process.env.REPORT_NO_SECRET_SCAN === '1';
let noOsv = process.env.REPORT_NO_OSV === '1';
let noSemgrep = process.env.REPORT_NO_SEMGREP === '1';
let noGitleaks = process.env.REPORT_NO_GITLEAKS === '1';
let maxIssuesPerFile = parseInt(process.env.REPORT_MAX_ISSUES_PER_FILE || '', 10);
if (!Number.isFinite(maxIssuesPerFile) || maxIssuesPerFile <= 0) maxIssuesPerFile = 100;
let strictMode = process.env.REPORT_STRICT === '1';
let maxErrorsGate = parseInt(process.env.REPORT_MAX_ERRORS || '', 10);
let maxWarningsGate = parseInt(process.env.REPORT_MAX_WARNINGS || '', 10);
let maxUnusedExportsGate = parseInt(process.env.REPORT_MAX_UNUSED_EXPORTS || '', 10);
let maxDupPercentGate = parseFloat(process.env.REPORT_MAX_DUP_PERCENT || '');
let maxSecretsGate = parseInt(process.env.REPORT_MAX_SECRETS || '', 10);
let maxSastGate = parseInt(process.env.REPORT_MAX_SAST || '', 10);
let maxDepVulnsGate = parseInt(process.env.REPORT_MAX_DEP_VULNS || '', 10);
if (!Number.isFinite(maxErrorsGate)) maxErrorsGate = undefined;
if (!Number.isFinite(maxWarningsGate)) maxWarningsGate = undefined;
if (!Number.isFinite(maxUnusedExportsGate)) maxUnusedExportsGate = undefined;
if (!Number.isFinite(maxDupPercentGate)) maxDupPercentGate = undefined;
if (!Number.isFinite(maxSecretsGate)) maxSecretsGate = undefined;
if (!Number.isFinite(maxSastGate)) maxSastGate = undefined;
if (!Number.isFinite(maxDepVulnsGate)) maxDepVulnsGate = undefined;

function canResolve(mod) {
  try {
    const searchPaths = [
      process.cwd(),
      path.join(process.cwd(), 'node_modules'),
      path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
      path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules'),
      __dirname,
      path.join(__dirname, 'node_modules'),
    ];
    require.resolve(mod, { paths: searchPaths });
    return true;
  } catch {
    return false;
  }
}

function hasBin(cmd) {
  try {
    const res = require('child_process').spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return res.status === 0 || res.status === 1; // some tools return 1 on non-zero but exist
  } catch {
    return false;
  }
}

function hasDocker() {
  try {
    const res = require('child_process').spawnSync('docker', ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Parse command line arguments for ignored patterns
 * Usage: --ignore=pattern1,pattern2 or --ignore pattern1,pattern2
 */
function parseIgnorePatterns() {
  const args = process.argv.slice(2);
  const ignorePatterns = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--ignore=')) {
      const patterns = args[i].substring(9).split(',');
      ignorePatterns.push(...patterns);
    } else if (args[i] === '--ignore' && i + 1 < args.length) {
      const patterns = args[i + 1].split(',');
      ignorePatterns.push(...patterns);
      i++; // Skip next argument as we've consumed it
    }
  }

  return ignorePatterns.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseGlobs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--globs=')) {
      let v = args[i].substring(8).trim();
      if (v.startsWith('/')) v = `**${v}`; // normaliza '/*.ts' -> '**/*.ts'
      return v;
    } else if (args[i] === '--globs' && i + 1 < args.length) {
      let v = (args[i + 1] || '').trim();
      if (v.startsWith('/')) v = `**${v}`;
      return v;
    }
  }
  return undefined;
}

function parseExtraFlags() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-ts-prune') noTsPrune = true;
    else if (a === '--no-jscpd') noJscpd = true;
    else if (a === '--no-secret-scan') noSecretScan = true;
    else if (a === '--max-issues-per-file' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isFinite(n) && n > 0) maxIssuesPerFile = n;
      i++;
    } else if (a.startsWith('--max-issues-per-file=')) {
      const n = parseInt(a.slice('--max-issues-per-file='.length), 10);
      if (Number.isFinite(n) && n > 0) maxIssuesPerFile = n;
    } else if (a === '--strict') {
      strictMode = true;
    } else if (a === '--max-errors' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10); if (Number.isFinite(n)) maxErrorsGate = n; i++;
    } else if (a.startsWith('--max-errors=')) {
      const n = parseInt(a.split('=')[1], 10); if (Number.isFinite(n)) maxErrorsGate = n;
    } else if (a === '--max-warnings' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10); if (Number.isFinite(n)) maxWarningsGate = n; i++;
    } else if (a.startsWith('--max-warnings=')) {
      const n = parseInt(a.split('=')[1], 10); if (Number.isFinite(n)) maxWarningsGate = n;
    } else if (a === '--max-unused-exports' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10); if (Number.isFinite(n)) maxUnusedExportsGate = n; i++;
    } else if (a.startsWith('--max-unused-exports=')) {
      const n = parseInt(a.split('=')[1], 10); if (Number.isFinite(n)) maxUnusedExportsGate = n;
    } else if (a === '--max-dup-percent' && i + 1 < args.length) {
      const n = parseFloat(args[i + 1]); if (Number.isFinite(n)) maxDupPercentGate = n; i++;
    } else if (a.startsWith('--max-dup-percent=')) {
      const n = parseFloat(a.split('=')[1]); if (Number.isFinite(n)) maxDupPercentGate = n;
    } else if (a === '--max-secrets' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10); if (Number.isFinite(n)) maxSecretsGate = n; i++;
    } else if (a.startsWith('--max-secrets=')) {
      const n = parseInt(a.split('=')[1], 10); if (Number.isFinite(n)) maxSecretsGate = n;
    } else if (a === '--max-sast' && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10); if (Number.isFinite(n)) maxSastGate = n; i++;
    } else if (a.startsWith('--max-sast=')) {
      const n = parseInt(a.split('=')[1], 10); if (Number.isFinite(n)) maxSastGate = n;
    }
  }
}

/**
 * Read source code with context lines around the error
 * Returns both visible context and expandable context
 */
async function getCodeSnippet(filePath, line, visibleContext = 2, expandableContext = 10) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Visible context (always shown)
    const visibleStart = Math.max(0, line - visibleContext - 1);
    const visibleEnd = Math.min(lines.length, line + visibleContext);

    // Expandable context (shown when expanded)
    const expandableStartTop = Math.max(0, line - expandableContext - 1);
    const expandableEndTop = visibleStart;

    const expandableStartBottom = visibleEnd;
    const expandableEndBottom = Math.min(lines.length, line + expandableContext);

    const snippet = {
      expandableTop: [],
      visible: [],
      expandableBottom: [],
    };

    // Helper to get highlighted HTML for a line
    const highlightLine = async (lineContent) => {
      try {
        const highlighted = await codeToHtml(lineContent, {
          lang: 'typescript',
          theme: 'github-dark',
        });
        // Extract just the code content from the pre/code tags
        const match = highlighted.match(/<code[^>]*>(.*?)<\/code>/s);
        return match ? match[1] : escapeHtml(lineContent);
      } catch (e) {
        return escapeHtml(lineContent);
      }
    };

    // Top expandable lines
    for (let i = expandableStartTop; i < expandableEndTop; i++) {
      snippet.expandableTop.push({
        number: i + 1,
        content: lines[i] || '',
        highlightedContent: await highlightLine(lines[i] || ''),
        isError: false,
      });
    }

    // Visible lines
    for (let i = visibleStart; i < visibleEnd; i++) {
      const lineNumber = i + 1;
      const isErrorLine = lineNumber === line;
      snippet.visible.push({
        number: lineNumber,
        content: lines[i] || '',
        highlightedContent: await highlightLine(lines[i] || ''),
        isError: isErrorLine,
      });
    }

    // Bottom expandable lines
    for (let i = expandableStartBottom; i < expandableEndBottom; i++) {
      snippet.expandableBottom.push({
        number: i + 1,
        content: lines[i] || '',
        highlightedContent: await highlightLine(lines[i] || ''),
        isError: false,
      });
    }

    return snippet;
  } catch (error) {
    return { expandableTop: [], visible: [], expandableBottom: [] };
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function docUrlForRule(ruleId) {
  if (!ruleId) return '';
  try {
    if (ruleId.includes('/')) {
      const [plugin, rule] = ruleId.split('/', 2);
      if (plugin === '@typescript-eslint') {
        return `https://typescript-eslint.io/rules/${rule}/`;
      }
      if (plugin === 'import') {
        return `https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/${rule}.md`;
      }
      if (plugin === 'unicorn') {
        return `https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/${rule}.md`;
      }
      if (plugin === 'sonarjs') {
        return `https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/docs/rules/${rule}.md`;
      }
      // Fallback to searching plugin rule docs on GitHub by convention
      return `https://www.google.com/search?q=${encodeURIComponent(ruleId + ' eslint rule')}`;
    }
    // Core rule
    return `https://eslint.org/docs/latest/rules/${ruleId}`;
  } catch {
    return '';
  }
}

/**
 * Check if a file path should be ignored based on patterns
 */
function normalizeIgnorePattern(pat) {
  let p = (pat || '').trim();
  if (!p) return '';
  if (p.startsWith('/')) p = `**${p}`; // '/proto/' -> '**/proto/' ; '/*.pb.ts' -> '**/*.pb.ts'
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

function shouldIgnoreFile(filePath, ignorePatterns) {
  if (ignorePatterns.length === 0) return false;

  const relativePath = path.relative(process.cwd(), filePath);

  return ignorePatterns.some((raw) => {
    const pattern = normalizeIgnorePattern(raw);
    // Support glob-like patterns
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    const regex = new RegExp(regexPattern);
    return regex.test(relativePath);
  });
}

/**
 * Build a folder tree structure from file paths
 */
function buildFileTree(results) {
  const tree = {};

  results.forEach((result) => {
    const relativePath = path.relative(process.cwd(), result.filePath);
    const parts = relativePath.split(path.sep);

    let currentLevel = tree;
    parts.forEach((part, index) => {
      if (!currentLevel[part]) {
        if (index === parts.length - 1) {
          // It's a file
          currentLevel[part] = {
            type: 'file',
            path: relativePath,
            errorCount: result.errorCount,
            warningCount: result.warningCount,
          };
        } else {
          // It's a folder
          currentLevel[part] = {
            type: 'folder',
            children: {},
            errorCount: 0,
            warningCount: 0,
          };
        }
      }

      // Accumulate error/warning counts for folders
      if (currentLevel[part].type === 'folder') {
        currentLevel[part].errorCount += result.errorCount;
        currentLevel[part].warningCount += result.warningCount;
        currentLevel = currentLevel[part].children;
      }
    });
  });

  return tree;
}

/**
 * Render the file tree as HTML
 */
function renderFileTree(tree, level = 0) {
  let html = '';

  const entries = Object.entries(tree).sort(([nameA, nodeA], [nameB, nodeB]) => {
    // Folders first, then files
    if (nodeA.type !== nodeB.type) {
      return nodeA.type === 'folder' ? -1 : 1;
    }
    return nameA.localeCompare(nameB);
  });

  entries.forEach(([name, node]) => {
    if (node.type === 'folder') {
      const hasIssues = node.errorCount > 0 || node.warningCount > 0;
      if (!hasIssues) return; // Skip folders with no issues

      html += `
        <div class="tree-folder" style="margin-left: ${level * 4}px;">
          <div class="tree-folder-header" onclick="toggleFolder(this)">
            <span class="tree-icon folder-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-folder" /></svg></span>
            <span class="tree-name">${escapeHtml(name)}</span>
            <span class="tree-stats">
              ${node.errorCount > 0 ? `<span class="tree-badge tree-badge-error">${node.errorCount}</span>` : ''}
              ${node.warningCount > 0 ? `<span class="tree-badge tree-badge-warning">${node.warningCount}</span>` : ''}
            </span>
          </div>
          <div class="tree-folder-content">
            ${renderFileTree(node.children, level + 1)}
          </div>
        </div>
      `;
    } else {
      const fileId = `file-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
      html += `
        <div class="tree-file" style="margin-left: ${level * 4}px;" onclick="scrollToFile('${fileId}')">
          <span class="tree-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-file" /></svg></span>
          <span class="tree-name">${escapeHtml(name)}</span>
          <span class="tree-stats">
            ${node.errorCount > 0 ? `<span class="tree-badge tree-badge-error">${node.errorCount}</span>` : ''}
            ${node.warningCount > 0 ? `<span class="tree-badge tree-badge-warning">${node.warningCount}</span>` : ''}
          </span>
        </div>
      `;
    }
  });

  return html;
}

/**
 * Run ts-prune to find unused exports
 */
function runTsPrune(ignorePatternsExt = []) {
  try {
    if (noTsPrune) {
      console.log('[INFO] Skipping ts-prune by flag');
      return { count: 0, items: [] };
    }
    // Requiere tsconfig.json. Si no existe, lo omitimos silenciosamente (con aviso breve).
    const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      console.log('[WARN] Skipping ts-prune (no tsconfig.json)');
      return { count: 0, items: [] };
    }

    console.log('[RUN] Running ts-prune...');
    // Prefer local binary if available to avoid network
    const localBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');
    const nestedBin = path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');
    const extraIgnores = (Array.isArray(ignorePatternsExt) ? ignorePatternsExt : [])
      .map(globToRegexString)
      .filter(Boolean);
    const ignoreRegex = ['\\.pb\\.ts$', '/proto/', '/protos/', ...extraIgnores]
      .filter(Boolean)
      .join('|');
    const cmd = fs.existsSync(localBin)
      ? `"${localBin}" src --ignore "${ignoreRegex}"`
      : fs.existsSync(nestedBin)
        ? `"${nestedBin}" src --ignore "${ignoreRegex}"`
        : `npx ts-prune src --ignore "${ignoreRegex}"`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    const lines = output.split('\n').filter(line => line.trim());

    const unusedExports = lines
      .map(line => {
        const match = line.match(/^(.+?):(\d+)\s*-\s*(.+)$/);
        if (!match) return null;
        return {
          file: match[1],
          line: parseInt(match[2], 10),
          export: match[3],
        };
      })
      .filter(Boolean);

    return { count: unusedExports.length, items: unusedExports };
  } catch (error) {
    console.warn('[WARN] ts-prune failed:', error.message);
    return { count: 0, items: [] };
  }
}

/**
 * Run jscpd to find code duplicates
 */
function runJscpd(ignorePatternsExt = []) {
  try {
    if (noJscpd) {
      console.log('[INFO] Skipping jscpd by flag');
      return { count: 0, percentage: 0, duplicates: [] };
    }
    console.log('[RUN] Running jscpd...');
    const tempFile = path.join(process.cwd(), 'reports', 'jscpd-report.json');

    // Run jscpd with reporters option to generate JSON file, ignore exit code
    try {
      const localBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
      const nestedBin = path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
      const ignoreArg = (Array.isArray(ignorePatternsExt) && ignorePatternsExt.length)
        ? ` --ignore "${ignorePatternsExt.map(normalizeIgnorePattern).join(',')}"`
        : '';
      const baseCmd = fs.existsSync(localBin)
        ? `"${localBin}" src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`
        : fs.existsSync(nestedBin)
          ? `"${nestedBin}" src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`
          : `npx jscpd src --reporters json --output reports --threshold 100 --exitCode 0${ignoreArg}`;
      execSync(baseCmd, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (execError) {
      // jscpd might fail with non-zero exit code, but still generate the file
      console.log('[WARN] jscpd finished with warnings (this is normal)');
    }

    // Read the generated JSON file
    if (fs.existsSync(tempFile)) {
      const content = fs.readFileSync(tempFile, 'utf-8');
      const result = JSON.parse(content);

      const duplicates = result.duplicates || [];
      const stats = result.statistics || {};

      return {
        count: duplicates.length,
        percentage: stats.percentage || 0,
        duplicates: duplicates.slice(0, 50), // Limit to 50 for performance
      };
    }

    return { count: 0, percentage: 0, duplicates: [] };
  } catch (error) {
    console.warn('[WARN] jscpd failed:', error.message);
    return { count: 0, percentage: 0, duplicates: [] };
  }
}

/**
 * Generate SonarQube-style HTML report
 */
async function generateHtmlLintReport() {
  // Cargar Shiki (ESM) con resolución robusta (soporta nested node_modules)
  let shiki;
  try {
    const searchPaths = [
      process.cwd(),
      path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules'),
    ];
    try {
      const resolved = require.resolve('shiki', { paths: searchPaths });
      shiki = await import(pathToFileURL(resolved).href);
    } catch {
      shiki = await import('shiki');
    }
  } catch (e) {
    console.error('No se pudo cargar shiki:', e.message);
    throw e;
  }
  codeToHtml = shiki.codeToHtml;

  const ignorePatterns = parseIgnorePatterns();
  lintGlobs = parseGlobs();
  parseExtraFlags();

  const eslintTarget = lintGlobs ? lintGlobs : 'src/ directory';
  console.log(`[RUN] Running ESLint on ${eslintTarget}...`);
  if (ignorePatterns.length > 0) {
    // Mostrar patrones normalizados para mayor claridad
    const shown = ignorePatterns.map(normalizeIgnorePattern);
    console.log(`[INFO] Ignoring patterns: ${shown.join(', ')}`);
  }

  const buildBaseConfig = (opts = {}) => {
    const {
      noUnicorn = false,
      noImport = false,
      noSonar = false,
      noSecurity = false,
    } = opts || {};
    const envNoUnicorn = process.env.REPORT_NO_UNICORN === '1';
    const envNoUnicornPreventAbbr = process.env.REPORT_NO_UNICORN_PREVENT_ABBR === '1';
    const envDisabledRules = process.env.REPORT_DISABLED_RULES;
    let disabledRulesConfig = {};
    if (envDisabledRules) {
        envDisabledRules.split(',').forEach(r => {
            const rule = r.trim();
            if (rule) disabledRulesConfig[rule] = 'off';
        });
    }

    // Construir una config mínima dinámica según paquetes disponibles
    const hasTsParserOld = canResolve('@typescript-eslint/parser');
    const hasTsParserNew = canResolve('typescript-eslint/parser');
    const tsParserPath = hasTsParserOld ? '@typescript-eslint/parser' : (hasTsParserNew ? 'typescript-eslint/parser' : null);
    const hasTsParser = !!tsParserPath;
    const hasTsPlugin = canResolve('@typescript-eslint/eslint-plugin') || canResolve('typescript-eslint');
    const hasImport = !noImport && canResolve('eslint-plugin-import');
    const hasSonar = !noSonar && canResolve('eslint-plugin-sonarjs');
    const hasUnicorn = !(noUnicorn || envNoUnicorn) && canResolve('eslint-plugin-unicorn');
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
                    path.join(process.cwd(), 'repo-scan-dashboard-main', 'tsconfig.json'),
                  ],
                  alwaysTryTypes: true,
                },
                node: {
                  extensions: ['.ts', '.tsx', '.js', '.jsx'],
                  // Ensure resolver can find nested project deps
                  paths: [
                    path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
                    path.join(process.cwd(), 'node_modules'),
                  ],
                  moduleDirectory: [
                    path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
                    'node_modules',
                  ],
                },
              }
            : {
                node: {
                  extensions: ['.ts', '.tsx', '.js', '.jsx'],
                  // Ensure resolver can find nested project deps
                  paths: [
                    path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
                    path.join(process.cwd(), 'node_modules'),
                  ],
                  moduleDirectory: [
                    path.join(process.cwd(), 'repo-scan-dashboard-main', 'node_modules'),
                    'node_modules',
                  ],
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
          ...(hasImport ? (() => {
            // Configurar import/no-unresolved más tolerante para evitar falsos positivos por
            // diferencias de mayúsculas/minúsculas y alias '@/' sin resolver TS.
            const baseOpts = { caseSensitive: false, commonjs: true };
            const opts = hasImportResolverTs ? baseOpts : { ...baseOpts, ignore: ['^@/'] };
            return { 'import/no-unresolved': ['error', opts] };
          })() : {}),
          ...(envNoUnicornPreventAbbr ? { 'unicorn/prevent-abbreviations': 'off' } : {}),
          ...disabledRulesConfig,
        },
      });
      // Suavizar reglas en el servidor (TS ESM con extensiones .js en imports y alias) para evitar falsos positivos y ruido de estilo
      base.overrides.push({
        files: ['repo-scan-dashboard-main/server/**/*.ts'],
        rules: {
          'import/no-unresolved': 'off',
          'unicorn/prefer-node-protocol': 'off',
          'unicorn/prevent-abbreviations': 'off',
          'unicorn/no-array-for-each': 'off',
          'unicorn/no-null': 'off',
        },
      });

      // Relax rules for tool/config files which often rely on devDeps and Node ESM quirks
      base.overrides.push({
        files: [
          '**/*.config.{js,cjs,mjs,ts,mts}',
          '**/vite.config.{js,cjs,mjs,ts,mts}',
          '**/tailwind.config.{js,ts}',
          '**/postcss.config.{js,ts}',
        ],
        rules: {
          'import/no-unresolved': 'off',
          'unicorn/prefer-node-protocol': 'off',
          'unicorn/prefer-module': 'off',
        },
      });
    }
    return base;
  };

  let patterns;
  if (lintGlobs) {
    const globStr = String(lintGlobs).trim();
    if (globStr.includes('{') && globStr.includes('}')) {
      patterns = [globStr];
    } else {
      patterns = globStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else {
    patterns = ['src/**/*.ts'];
  }

  // Collect files via fast-glob to avoid ESLint touching invalid package.json in CWD
  const defaultIgnores = ['**/node_modules/**', '**/dist/**', '**/build/**'];
  const cliIgnores = (ignorePatterns || []).map(normalizeIgnorePattern);
  const globbedFiles = await fg(patterns, {
    cwd: process.cwd(),
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: [...defaultIgnores, ...cliIgnores],
    unique: true,
    followSymbolicLinks: false,
  });

  // If no files found, attempt a broader fallback
  let filesToLint = globbedFiles;
  if (!filesToLint.length) {
    const hasSrc = fs.existsSync(path.join(process.cwd(), 'src'));
    const fallback = hasSrc
      ? ['src/**/*.{ts,tsx,js,jsx}']
      : ['**/*.{ts,tsx,js,jsx}'];
    filesToLint = await fg(fallback, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true,
      dot: false,
      ignore: [...defaultIgnores, ...cliIgnores],
      unique: true,
      followSymbolicLinks: false,
    });
    if (!filesToLint.length) {
      console.warn('[WARN] No files found to lint.');
    }
  }

  // Use a temporary CWD with a valid package.json to prevent ESLint from parsing the project's package.json
  const tmpCwd = path.join(process.cwd(), 'reports', '.eslint-tmp');
  try { fs.mkdirSync(tmpCwd, { recursive: true }); } catch (e) { (void e); }
  try {
    const pkgPath = path.join(tmpCwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'eslint-tmp', private: true }, null, 2), 'utf8');
    }
  } catch (e) { (void e); }

  let results;
  try {
    const eslint = new ESLint({
      cwd: process.cwd(),
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      fix: false,
      useEslintrc: false,
      baseConfig: buildBaseConfig(),
      errorOnUnmatchedPattern: false,
    });
    results = await eslint.lintFiles(filesToLint);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const needFallback = /Failed to load config|extend-config-missing|Cannot find module 'eslint-config/.test(msg);
    const unicornFail = /plugin ['"]unicorn['"]|eslint-plugin-unicorn/.test(msg);
    const noFiles = /No files matching/.test(msg) || (err && err.name === 'NoFilesFoundError');
    if (noFiles) {
      const hasSrc = fs.existsSync(path.join(process.cwd(), 'src'));
      const fallback = hasSrc
        ? ['src/**/*.{ts,tsx,js,jsx}']
        : ['**/*.{ts,tsx,js,jsx}'];
      console.warn(`[WARN] No se encontraron archivos con los globs proporcionados. Reintentando con: ${fallback.join(', ')}`);
      const files = await fg(fallback, {
        cwd: process.cwd(),
        absolute: true,
        onlyFiles: true,
        dot: false,
        ignore: [...defaultIgnores, ...cliIgnores],
        unique: true,
        followSymbolicLinks: false,
      });
      const eslint = new ESLint({
        cwd: process.cwd(),
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        fix: false,
        useEslintrc: false,
        baseConfig: buildBaseConfig(),
        errorOnUnmatchedPattern: false,
      });
      results = await eslint.lintFiles(files);
    } else if (!forceInternalEslint && needFallback) {
      console.warn('[WARN] ESLint config del proyecto no disponible. Usando configuración interna mínima.');
      const eslint = new ESLint({
        cwd: process.cwd(),
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        fix: false,
        useEslintrc: false,
        baseConfig: buildBaseConfig(),
        errorOnUnmatchedPattern: false,
      });
      results = await eslint.lintFiles(filesToLint);
    } else if (unicornFail) {
      console.warn('[WARN] Falling back without eslint-plugin-unicorn due to plugin error.');
      const eslint = new ESLint({
        cwd: process.cwd(),
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        fix: false,
        useEslintrc: false,
        baseConfig: buildBaseConfig({ noUnicorn: true }),
        errorOnUnmatchedPattern: false,
      });
      results = await eslint.lintFiles(filesToLint);
    } else {
      throw err;
    }
  }

  // Filter out ignored files
  const filteredResults = results
    .map((result) => {
      if (shouldIgnoreFile(result.filePath, ignorePatterns)) {
        return null;
      }
      return result;
    })
    .filter((result) => result !== null);

  const errorCount = filteredResults.reduce(
    (sum, result) => sum + result.errorCount,
    0,
  );
  const warningCount = filteredResults.reduce(
    (sum, result) => sum + result.warningCount,
    0,
  );
  const totalIssues = errorCount + warningCount;

  console.log(
    `[SUMMARY] Found ${totalIssues} issues (${errorCount} errors, ${warningCount} warnings)`,
  );

  // Count issues by rule
  const ruleStats = {};
  filteredResults.forEach((result) => {
    result.messages.forEach((message) => {
      if (message.ruleId) {
        if (!ruleStats[message.ruleId]) {
          ruleStats[message.ruleId] = { count: 0, errors: 0, warnings: 0 };
        }
        ruleStats[message.ruleId].count++;
        if (message.severity === 2) {
          ruleStats[message.ruleId].errors++;
        } else {
          ruleStats[message.ruleId].warnings++;
        }
      }
    });
  });

  const sortedRules = Object.entries(ruleStats).sort(
    (a, b) => b[1].count - a[1].count,
  );

  // Pre-process code snippets with syntax highlighting
  console.log('[FORMAT] Applying syntax highlighting...');
  const resultsWithSnippets = await Promise.all(
    filteredResults.map(async (result) => {
      // Prioritize errors over warnings, then by line number
      const sortedMsgs = [...result.messages].sort((a, b) => {
        const sevDiff = (b.severity || 0) - (a.severity || 0);
        if (sevDiff !== 0) return sevDiff; // severity 2 first
        return (a.line || 0) - (b.line || 0);
      });
      const messagesToShow = sortedMsgs.slice(0, maxIssuesPerFile);
      const messagesWithSnippets = await Promise.all(
        messagesToShow.map(async (message) => ({
          ...message,
          snippet: await getCodeSnippet(result.filePath, message.line),
        })),
      );
      return {
        ...result,
        messagesWithSnippets,
      };
    }),
  );

  // Run additional tools
  const tsPruneData = runTsPrune(ignorePatterns);
  const jscpdData = runJscpd(ignorePatterns);

  // SAST with Semgrep (optional)
  let semgrepFindings = [];
  if (!noSemgrep) {
    const runViaDocker = !hasBin('semgrep') && hasDocker();
    if (!hasBin('semgrep') && !runViaDocker) {
      console.warn('[WARN] Semgrep not found in PATH and Docker is unavailable; skipping SAST');
    } else {
      console.log(`[RUN] Running Semgrep (SAST) via ${runViaDocker ? 'Docker' : 'local binary'}...`);
      try {
        const cfg = (process.env.SEMGREP_CONFIG || 'p/ci').trim();
        const args = ['--quiet', '--json', '--timeout', '120', '--config', cfg];
        // map ignore patterns to --exclude when possible (directories only)
        for (const pat of (ignorePatterns || [])) {
          if (pat.includes('node_modules') || pat.endsWith('/**') || !pat.includes('*')) {
            args.push('--exclude', pat.replace('/**', ''));
          }
        }
        const { spawnSync } = require('child_process');
        let res;
        if (runViaDocker) {
          const image = process.env.SEMGREP_IMAGE || 'returntocorp/semgrep:latest';
          res = spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/src`, '-w', '/src', image, 'semgrep', ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } else {
          res = spawnSync('semgrep', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        }
      // Semgrep returns exit code 1 when findings found; treat 0/1 as success
        if (res.error) throw res.error;
        const stdout = String(res.stdout || '');
        try {
          const json = JSON.parse(stdout);
          if (json && Array.isArray(json.results)) {
            semgrepFindings = json.results.map((r) => ({
              check_id: r.check_id,
              path: r.path,
              start: r.start ? (r.start.line || 1) : 1,
              end: r.end ? (r.end.line || r.start?.line || 1) : (r.start?.line || 1),
              severity: (r.extra && r.extra.severity) || 'WARNING',
              message: (r.extra && r.extra.message) || '',
            }));
          }
          console.log(`[OK] Semgrep found ${semgrepFindings.length} findings`);
        } catch (e) {
          console.warn('[WARN] Semgrep output not JSON; skipping parse');
        }
      } catch (e) {
        console.warn('[WARN] Semgrep failed:', e?.message || e);
      }
    }
  }
  if (noSemgrep) {
    console.log('[INFO] Skipping Semgrep by configuration (REPORT_NO_SEMGREP=1)');
  }

  // Dependency vulnerabilities with OSV-Scanner (optional)
  let osvFindings = [];
  if (!noOsv) {
    const runViaDocker = !hasBin('osv-scanner') && hasDocker();
    if (!hasBin('osv-scanner') && !runViaDocker) {
      console.warn('[WARN] OSV-Scanner not found in PATH and Docker is unavailable; skipping dependency scan');
    } else {
      console.log(`[RUN] Running OSV-Scanner (dependencies) via ${runViaDocker ? 'Docker' : 'local binary'}...`);
      try {
        const { spawnSync } = require('child_process');
        const args = ['--format', 'json', '--recursive', '.'];
        let res;
        if (runViaDocker) {
          const image = process.env.OSV_IMAGE || 'ghcr.io/google/osv-scanner:latest';
          res = spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/src`, '-w', '/src', image, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
        } else {
          res = spawnSync('osv-scanner', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
        }
        const stdout = String(res.stdout || '');
        try {
          const json = JSON.parse(stdout);
          // Flatten results
          if (json && Array.isArray(json.results)) {
            for (const r of json.results) {
              const source = r.source && (r.source.path || r.source);
              for (const p of (r.packages || [])) {
                const pkg = p.package || {};
                const version = (pkg.version || p.version || 'unknown');
                for (const vuln of (p.vulnerabilities || [])) {
                  let sev = 'UNKNOWN';
                  if (Array.isArray(vuln.severity) && vuln.severity.length > 0) {
                    // choose the highest severity based on CVSS score
                    const scores = vuln.severity.map(s => parseFloat(s.score || '0')).filter(Number.isFinite);
                    const maxScore = scores.length ? Math.max(...scores) : 0;
                    if (maxScore >= 9.0) sev = 'CRITICAL';
                    else if (maxScore >= 7.0) sev = 'HIGH';
                    else if (maxScore >= 4.0) sev = 'MEDIUM';
                    else if (maxScore > 0) sev = 'LOW';
                  }
                  osvFindings.push({
                    id: vuln.id || (vuln.aliases && vuln.aliases[0]) || 'OSV',
                    package: pkg.name || 'unknown',
                    version,
                    severity: sev,
                    source: String(source || ''),
                    summary: vuln.summary || (vuln.details ? String(vuln.details).slice(0, 120) : ''),
                  });
                }
              }
            }
          }
          console.log(`[OK] OSV-Scanner found ${osvFindings.length} findings`);
        } catch (e) {
          console.warn('[WARN] OSV-Scanner output not JSON; skipping parse');
        }
      } catch (e) {
        console.warn('[WARN] OSV-Scanner failed:', e?.message || e);
      }
    }
  }
  if (noOsv) {
    console.log('[INFO] Skipping OSV-Scanner by configuration (REPORT_NO_OSV=1)');
  }

  // Secret scanning with Gitleaks (optional)
  let gitleaksFindings = [];
  if (!noGitleaks) {
    const runViaDocker = !hasBin('gitleaks') && hasDocker();
    if (!hasBin('gitleaks') && !runViaDocker) {
      console.warn('[WARN] Gitleaks not found in PATH and Docker is unavailable; skipping secret scan');
    } else {
      console.log(`[RUN] Running Gitleaks (secrets) via ${runViaDocker ? 'Docker' : 'local binary'}...`);
      try {
        const { spawnSync } = require('child_process');
        // Prefer stdout JSON. Some versions require --report-path; capture stdout anyway
        const args = ['detect', '--no-git', '--redact', '--report-format', 'json', '--source', '.'];
        let res;
        if (runViaDocker) {
          const image = process.env.GITLEAKS_IMAGE || 'zricethezav/gitleaks:latest';
          res = spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/src`, '-w', '/src', image, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } else {
          res = spawnSync('gitleaks', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        }
      // gitleaks returns exit code 1 when leaks found; treat 0/1 as success
        const stdout = String(res.stdout || '');
        try {
          const json = JSON.parse(stdout || '[]');
          // v8 prints array of leaks; map
          if (Array.isArray(json)) {
            gitleaksFindings = json.map((x) => ({
              file: x.File || x.file || 'unknown',
              line: x.StartLine || x.startLine || x.Line || 1,
              rule: x.RuleID || x.ruleID || x.Rule || 'gitleaks',
              match: x.Match || x.match || '',
            }));
          } else if (json && Array.isArray(json.findings)) {
            gitleaksFindings = json.findings.map((x) => ({
              file: x.File || x.file || 'unknown',
              line: x.StartLine || x.startLine || x.Line || 1,
              rule: x.RuleID || x.ruleID || x.Rule || 'gitleaks',
              match: x.Match || x.match || '',
            }));
          }
          console.log(`[OK] Gitleaks found ${gitleaksFindings.length} findings`);
        } catch (e) {
          console.warn('[WARN] Gitleaks output not JSON; skipping parse');
        }
      } catch (e) {
        console.warn('[WARN] Gitleaks failed:', e?.message || e);
      }
    }
  }
  if (noGitleaks) {
    console.log('[INFO] Skipping Gitleaks by configuration (REPORT_NO_GITLEAKS=1)');
  }

  // Security findings (rules from eslint-plugin-security)
  const securityFindings = [];
  for (const result of filteredResults) {
    for (const message of (result.messages || [])) {
      if (message.ruleId && typeof message.ruleId === 'string' && message.ruleId.startsWith('security/')) {
        securityFindings.push({
          file: path.relative(process.cwd(), result.filePath),
          line: message.line || 0,
          column: message.column || 0,
          ruleId: message.ruleId,
          message: message.message || '',
          severity: message.severity === 2 ? 'error' : 'warning',
          source: 'eslint-security',
        });
      }
    }
  }
  // Secret scanning (regex heuristics) + Gitleaks findings
  const secretFindings = [];
  if (!noSecretScan) {
    const SECRET_PATTERNS = [
      { key: 'AWS Access Key ID', re: /AKIA[0-9A-Z]{16}/g },
      { key: 'AWS Secret Access Key', re: /aws(.{0,20})?['"][0-9a-zA-Z/+]{40}['"]/i },
      { key: 'Google API Key', re: /AIza[0-9A-Za-z\-_]{35}/g },
      { key: 'GitHub Token', re: /ghp_[0-9A-Za-z]{36}/g },
      { key: 'Slack Token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
      { key: 'Private Key Block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
      { key: 'JWT-like Token', re: /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g },
      { key: 'Generic Secret Assignment', re: /(password|passwd|pwd|secret|api[-_]?key|token)\s*[:=]\s*['"][^'"\n]{6,}['"]/gi },
    ];
    for (const res of filteredResults) {
      const file = path.relative(process.cwd(), res.filePath);
      try {
        const content = fs.readFileSync(res.filePath, 'utf-8');
        const linesArr = content.split('\n');
        for (let i = 0; i < linesArr.length; i++) {
          const line = linesArr[i];
          for (const pat of SECRET_PATTERNS) {
            pat.re.lastIndex = 0; // reset
            const matches = line.match(pat.re);
            if (matches && matches.length) {
              secretFindings.push({
                file,
                line: i + 1,
                type: pat.key,
                match: matches[0].slice(0, 120),
                source: 'heuristic',
              });
            }
          }
        }
      } catch (e) { (void e); }
    }
  }
  if (noSecretScan) {
    console.log('[INFO] Skipping heuristic secret scan by configuration (REPORT_NO_SECRET_SCAN=1)');
  }
  // Merge Gitleaks
  for (const leak of gitleaksFindings) {
    secretFindings.push({
      file: leak.file,
      line: leak.line || 1,
      type: leak.rule || 'gitleaks',
      match: String(leak.match || '').slice(0, 120),
      source: 'gitleaks',
    });
  }
  // Merge Semgrep into security findings list and counts
  for (const s of semgrepFindings) {
    securityFindings.push({
      file: s.path,
      line: s.start || 1,
      column: 1,
      ruleId: `semgrep/${s.check_id}`,
      message: s.message,
      severity: s.severity === 'ERROR' ? 'error' : 'warning',
      source: 'semgrep',
    });
  }
  const securityCount = securityFindings.length + secretFindings.length;
  const depVulnCount = Array.isArray(osvFindings) ? osvFindings.length : 0;

  // Build file tree
  const filesWithIssues = resultsWithSnippets.filter(
    (result) => result.errorCount > 0 || result.warningCount > 0,
  );
  const fileTree = buildFileTree(filesWithIssues);
  const fileTreeHtml = renderFileTree(fileTree);

  // Aggregate: issues by top-level directory and by type
  const issueCountsByDir = {};
  filteredResults.forEach((result) => {
    const rel = path.relative(process.cwd(), result.filePath);
    const parts = rel.split(path.sep).filter(Boolean);
    // Prefer grouping by folder inside src/, else top-level folder, else root
    let bucket = 'root';
    if (parts.length > 1 && parts[0] === 'src') bucket = parts[1];
    else if (parts.length > 0) bucket = parts[0];

    const issuesInFile = (result.messages || []).length;
    if (!issueCountsByDir[bucket]) issueCountsByDir[bucket] = 0;
    issueCountsByDir[bucket] += issuesInFile;
  });
  const topDirs = Object.entries(issueCountsByDir)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 10);
  const maxDirIssues = topDirs.reduce((m, [, c]) => Math.max(m, c), 0) || 1;
  const barColorVars = ['--primary', '--warning', '--success', '--destructive', '--accent'];

  // Donut data (combine ESLint + extras when available)
  const donutData = [
    { key: 'Errors', count: errorCount, color: 'hsl(var(--destructive))' },
    { key: 'Warnings', count: warningCount, color: 'hsl(var(--warning))' },
    { key: 'Unused Exports', count: (tsPruneData && tsPruneData.count) || 0, color: 'hsl(var(--success))' },
    { key: 'Code Duplicates', count: (jscpdData && jscpdData.count) || 0, color: 'hsl(var(--primary))' },
    { key: 'Security', count: securityCount, color: 'hsl(var(--accent))' },
    { key: 'Dep Vulns', count: depVulnCount, color: 'hsl(12 85% 60%)' },
  ];
  const donutTotal = donutData.reduce((s, d) => s + d.count, 0) || 1;
  // Build a conic-gradient string for the donut
  let acc = 0;
  const donutStops = donutData
    .filter((d) => d.count > 0)
    .map((d) => {
      const start = (acc / donutTotal) * 100;
      acc += d.count;
      const end = (acc / donutTotal) * 100;
      return `${d.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    })
    .join(', ');

  // Read favicon
  const faviconPath = path.join(__dirname, 'favicon.ico');
  let faviconData = '';
  try {
      if (fs.existsSync(faviconPath)) {
          faviconData = fs.readFileSync(faviconPath).toString('base64');
      }
  } catch (e) {
      console.warn('Could not read favicon.ico', e.message);
  }

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${faviconData ? `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconData}" />` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ESLint Report - SonarQube Style</title>
    <style>
        :root {
            --background: 0 0% 3%;
            --foreground: 0 0% 98%;
            --card: 0 0% 5%;
            --card-foreground: 0 0% 98%;
            --popover: 0 0% 5%;
            --popover-foreground: 0 0% 98%;
            --primary: 217 91% 60%;
            --primary-foreground: 0 0% 3%;
            --secondary: 0 0% 10%;
            --secondary-foreground: 0 0% 98%;
            --muted: 0 0% 10%;
            --muted-foreground: 0 0% 65%;
            --accent: 217 91% 60%;
            --accent-foreground: 0 0% 3%;
            --success: 142 76% 36%;
            --success-foreground: 0 0% 98%;
            --warning: 38 92% 50%;
            --warning-foreground: 0 0% 3%;
            --destructive: 0 84% 60%;
            --destructive-foreground: 0 0% 98%;
            --border: 0 0% 15%;
            --input: 0 0% 15%;
            --ring: 217 91% 60%;
            --radius: 0.75rem;
            --code-bg: 0 0% 2%;
            --code-text: 0 0% 98%;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: hsl(var(--background));
            color: hsl(var(--foreground));
            line-height: 1.6;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        .header {
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            padding: 1.25rem 2rem 1rem 2rem;
            box-shadow: 0 4px 12px hsl(var(--background) / 0.6);
            flex-shrink: 0;
        }

        .header h1 {
            font-size: 1.75rem;
            margin-bottom: 0.25rem;
        }

        .header .subtitle {
            opacity: 0.9;
            font-size: 0.9rem;
        }

        .main-content {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .sidebar {
            width: 350px;
            background: hsl(var(--card));
            border-right: 1px solid hsl(var(--border));
            overflow-y: auto;
            flex-shrink: 0;
        }

        .sidebar-header {
            padding: 1rem 1.5rem;
            background: hsl(var(--secondary));
            border-bottom: 2px solid hsl(var(--border));
            font-weight: 600;
            color: hsl(var(--foreground));
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .sidebar-search { padding: 0.75rem 1rem; border-bottom: 1px solid hsl(var(--border)); }
        .sidebar-search input {
            width: 100%;
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            background: hsl(var(--secondary));
            color: hsl(var(--foreground));
            border: 1px solid hsl(var(--border));
        }

        .tree-container {
            padding: 0.5rem;
        }

        .container {
            flex: 1;
            overflow-y: auto;
            padding: 1.25rem 2rem 2rem 2rem;
        }

        /* Filters toolbar to match screenshot */
        .filters-toolbar {
            position: sticky;
            top: 0;
            z-index: 8;
            background: hsl(var(--secondary));
            backdrop-filter: blur(4px);
            padding: .75rem 1rem;
            border: 1px solid hsl(var(--border));
            border-radius: 10px;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: .75rem;
        }
        .filters-title { font-weight: 600; color: hsl(var(--foreground)); display: inline-flex; align-items: center; gap:.4rem; }
        .chip-filter { display:inline-flex; align-items:center; gap:.35rem; background: hsl(var(--primary) / .12); color:hsl(var(--foreground)); border:1px solid hsl(var(--primary)); padding:.25rem .5rem; border-radius:999px; font-size:.8rem; }
        .chip-toggle { display:inline-flex; align-items:center; gap:.35rem; background:hsl(var(--secondary)); color:hsl(var(--foreground)); border:1px solid hsl(var(--border)); padding:.25rem .6rem; border-radius:999px; font-size:.8rem; cursor:pointer; }
        .chip-toggle.active { background:hsl(var(--primary) / .15); color:hsl(var(--foreground)); border-color:hsl(var(--primary)); }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .summary-card { background: hsl(var(--card)); padding: 1.25rem 1.5rem; border-radius: 12px; box-shadow: 0 4px 12px hsl(var(--background) / 0.6); border: 1px solid hsl(var(--border)); border-left: 4px solid hsl(var(--primary)); transition: transform 0.2s, box-shadow 0.2s; display:flex; gap:.75rem; align-items:center; }

        .summary-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px hsl(var(--background) / 0.7); }

        .summary-card.errors { border-left-color: hsl(var(--destructive)); }

        .summary-card.warnings { border-left-color: hsl(var(--warning)); }

        .summary-card.files { border-left-color: hsl(var(--primary)); }

        .summary-card .label { font-size: 0.85rem; color: hsl(var(--muted-foreground));
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }

        .summary-card .value { font-size: 2.5rem; font-weight: bold; color: hsl(var(--foreground)); }

        .section {
            background: hsl(var(--card));
            border-radius: 12px;
            box-shadow: 0 4px 12px hsl(var(--background) / 0.6);
            border: 1px solid hsl(var(--border));
            margin-bottom: 2rem;
            overflow: hidden;
        }

        .section-header {
            background: hsl(var(--secondary));
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid hsl(var(--border));
            font-weight: 600;
            font-size: 1.1rem;
            color: hsl(var(--foreground));
        }

        .section-content {
            padding: 1.5rem;
        }

        /* Charts */
        .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
        .chart-card { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 12px; padding: 1rem; }
        .chart-title { font-weight: 600; margin-bottom: 0.75rem; color: hsl(var(--foreground)); display: flex; align-items: center; gap: .5rem; }
        .bar-chart { display: flex; align-items: flex-end; gap: .75rem; height: 180px; padding: .5rem 0; border-bottom: 1px dashed hsl(var(--border)); }
        .bar { width: 28px; background: hsl(var(--bar-color-hsl, var(--primary))); border-radius: 4px 4px 0 0; position: relative; }
        .bar:hover { filter: brightness(1.1); }
        .bar-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: .75rem; color: hsl(var(--muted-foreground)); text-align: center; margin-top: .5rem; max-height: 48px; overflow: hidden; }
        .bar-wrap { display: flex; flex-direction: column; align-items: center; gap: .5rem; }
        .bar-value { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: .75rem; color: hsl(var(--foreground)); }
        .donut-wrap { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
        .donut { width: 160px; height: 160px; border-radius: 50%; background: conic-gradient(${donutStops || 'hsl(var(--muted)) 0 100%'}); position: relative; }
        .donut::after { content: ''; position: absolute; inset: 18%; background: hsl(var(--card)); border-radius: 50%; }
        .legend { display: grid; grid-auto-rows: minmax(20px, auto); gap: .35rem; min-width: 200px; }
        .legend-item { display: flex; align-items: center; gap: .5rem; color: hsl(var(--foreground)); }
        .legend-swatch { width: 12px; height: 12px; border-radius: 3px; }

        /* Collapsible sections */
        .section.collapsible .section-header { cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
        .section.collapsed .section-content { display: none; }
        .caret { display:inline-block; transition: transform .2s; opacity: .8; }
        .section.collapsed .caret { transform: rotate(-90deg); opacity: .6; }

        /* Responsive */
        .table-responsive { width: 100%; overflow-x: auto; }
        @media (max-width: 1024px) {
            .main-content { flex-direction: column; }
            .sidebar { width: 100%; max-height: 260px; border-right: none; border-bottom: 1px solid hsl(var(--border)); }
            .container { padding: 1rem; }
            .charts-grid { grid-template-columns: 1fr; }
            .summary { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
            .controls-bar { flex-wrap: wrap; }
        }
        @media (max-width: 640px) {
            .header h1 { font-size: 1.25rem; }
            .header .subtitle { font-size: 0.8rem; }
            .line-number { width: 36px; padding: 0 0.5rem; }
            .code-snippet { font-size: 0.8rem; }
            .btn-copy { display: none; }
        }

        .controls-bar {
            display: flex;
            gap: 0.75rem;
            align-items: center;
            background: hsl(var(--secondary));
            border: 1px solid hsl(var(--border));
            border-radius: 8px;
            padding: 0.5rem 0.75rem;
            margin-bottom: 1rem;
        }
        .controls-bar .control { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; color: hsl(var(--foreground)); }
        .controls-bar input[type="checkbox"] { accent-color: hsl(var(--primary)); }
        .chip { display: none; background: hsl(var(--primary) / 0.15); color: hsl(var(--foreground)); border: 1px solid hsl(var(--primary)); padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.8rem; }
        .btn { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--foreground)); padding: .35rem .6rem; border-radius: 8px; cursor: pointer; transition: background .15s ease, border-color .15s ease, filter .15s ease; }
        .btn:hover { background: hsl(var(--secondary)); border-color: hsl(var(--primary)); }
        .btn-outline { background: transparent; border-color: hsl(var(--border)); color: hsl(var(--foreground)); }
        .btn-outline:hover { background: hsl(var(--secondary)); border-color: hsl(var(--primary)); }
        .btn-clear { display: none; align-items: center; gap: 0.25rem; border: 1px solid hsl(var(--border)); background: hsl(var(--secondary)); color: hsl(var(--foreground)); padding: 0.25rem 0.5rem; border-radius: 6px; cursor: pointer; }
        .btn-copy { display: inline-flex; align-items: center; gap: 0.25rem; border: 1px solid hsl(var(--border)); background: hsl(var(--secondary)); color: hsl(var(--foreground)); padding: 0.25rem 0.5rem; border-radius: 6px; cursor: pointer; }
        .btn-primary { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid hsl(var(--primary)); background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); padding: .5rem .9rem; border-radius: 8px; cursor: pointer; font-weight: 600; }
        .btn-primary:hover { filter: brightness(1.05); }
        .hidden { display: none !important; }

        /* Make sidebar slimmer on small screens */
        @media (max-width: 768px) {
          .sidebar { width: 280px; }
        }
        .rules-table tbody tr { cursor: pointer; }

        .rules-table {
            width: 100%;
            border-collapse: collapse;
        }

        .rules-table th {
            background: hsl(var(--secondary));
            padding: 0.75rem 1rem;
            text-align: left;
            font-weight: 600;
            font-size: 0.85rem;
            color: hsl(var(--muted-foreground));
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid hsl(var(--border));
        }

        .rules-table td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid hsl(var(--border));
            color: hsl(var(--foreground));
        }

        .rules-table tr:hover { background: hsl(var(--secondary)); }

        .rule-name { font-family: 'Monaco', 'Menlo', monospace; font-size: 0.9rem; color: hsl(var(--destructive)); }
        .rule-name a { color: inherit; text-decoration: none; }
        .rule-name a:hover { text-decoration: underline; }

        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-right: 0.5rem;
        }

        .badge-error { background: hsl(var(--destructive) / 0.2); color: hsl(var(--destructive-foreground)); border: 1px solid hsl(var(--destructive) / 0.3); }

        .badge-warning { background: hsl(var(--warning) / 0.2); color: hsl(var(--warning-foreground)); border: 1px solid hsl(var(--warning) / 0.3); }

        .file-issue { margin-bottom: 2rem; border: 1px solid hsl(var(--border)); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px hsl(var(--background) / 0.6); background: hsl(var(--card)); transition: transform 0.2s, box-shadow 0.2s; }

        .file-issue:hover { transform: translateY(-2px); box-shadow: 0 6px 16px hsl(var(--background) / 0.7); }

        .file-header {
            background: hsl(var(--secondary));
            color: hsl(var(--foreground));
            padding: 1rem 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            user-select: none;
            border-bottom: 1px solid hsl(var(--border));
        }

        .file-header:hover { background: hsl(var(--secondary) / 0.9); }

        .file-header-left {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex: 1;
        }

        .collapse-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border: 2px solid white;
            border-radius: 3px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .collapse-toggle::after {
            content: '−';
            color: white;
            font-size: 1rem;
            line-height: 1;
            font-weight: bold;
        }

        .file-collapsed .collapse-toggle::after {
            content: '+';
        }

        .file-collapsed .collapse-toggle { background: hsl(var(--foreground) / 0.1); }

        .file-path {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9rem;
        }

        .file-stats {
            display: flex;
            gap: 1rem;
            font-size: 0.85rem;
        }

        .file-issues-container {
            max-height: 5000px;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }

        .file-collapsed .file-issues-container {
            max-height: 0;
        }

        .issue { border-bottom: 1px solid hsl(var(--border)); padding: 1.25rem; background: hsl(var(--card)); }

        .issue:last-child {
            border-bottom: none;
        }

        .issue-header {
            display: flex;
            align-items: flex-start;
            margin-bottom: 1rem;
            gap: 1rem;
        }

        .severity-icon {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 0.85rem;
            flex-shrink: 0;
        }

        .severity-error { background: hsl(var(--destructive) / 0.2); color: hsl(var(--destructive-foreground)); border: 1px solid hsl(var(--destructive) / 0.3); }

        .severity-warning { background: hsl(var(--warning) / 0.2); color: hsl(var(--warning-foreground)); border: 1px solid hsl(var(--warning) / 0.3); }

        .issue-details {
            flex: 1;
        }

        .issue-message { font-size: 1rem; color: hsl(var(--foreground)); margin-bottom: 0.5rem; font-weight: 500; }

        .issue-meta { display: flex; gap: 1.5rem; font-size: 0.85rem; color: hsl(var(--muted-foreground)); }

        .issue-meta-item {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }

        .code-snippet { background: hsl(var(--code-bg)); border: 1px solid hsl(var(--border));
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 0.85rem;
            margin-top: 1rem;
        }

        .code-line {
            display: flex;
            padding: 0.25rem 0;
            border-left: 3px solid transparent;
            line-height: 1.5;
        }

        .code-line.error-line { background: hsl(var(--destructive) / 0.15); border-left-color: hsl(var(--destructive)); }

        .line-number { display: inline-block; width: 50px; padding: 0 1rem; color: hsl(var(--muted-foreground));
            text-align: right;
            user-select: none;
            flex-shrink: 0;
        }

        .error-line .line-number { color: hsl(var(--destructive-foreground)); font-weight: bold; }

        .line-content {
            flex: 1;
            padding-right: 1rem;
            white-space: pre;
        }

        .line-content * {
            font-family: inherit;
        }

        .error-arrow { color: hsl(var(--destructive-foreground));
            font-weight: bold;
            margin-left: 50px;
            padding: 0.25rem 1rem;
            font-size: 0.9rem;
        }

        .expandable-section {
            display: none;
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }

        .expandable-section.expanded {
            display: block;
            max-height: none;
        }

        .expand-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.5rem;
            background: hsl(var(--secondary));
            color: hsl(var(--muted-foreground));
            cursor: pointer;
            user-select: none;
            border-top: 1px solid hsl(var(--border));
            border-bottom: 1px solid hsl(var(--border));
            font-size: 0.8rem;
            transition: background 0.2s, color 0.2s;
        }

        .expand-toggle:hover {
            background: hsl(var(--secondary) / 0.9);
            color: hsl(var(--foreground));
        }

        .expand-toggle-icon { margin-right: 0.5rem; transition: transform 0.2s; }

        .expand-toggle.expanded .expand-toggle-icon {
            transform: rotate(180deg);
        }

        .code-line.expandable {
            opacity: 0.85;
        }

        .no-issues { text-align: center; padding: 3rem; color: hsl(var(--success)); }

        .no-issues-icon { margin-bottom: 1rem; }

        .no-issues-text {
            font-size: 1.5rem;
            font-weight: 600;
        }

        .tree-folder {
            margin: 0.25rem 0;
        }

        .tree-folder-header {
            display: flex;
            align-items: center;
            padding: 0.5rem 0.75rem;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.2s;
            gap: 0.5rem;
        }

        /* Top navigation and enhanced controls */
        .top-nav {
            position: sticky;
            top: 0;
            z-index: 50;
            background: linear-gradient(to bottom, hsl(var(--background)), hsl(var(--background) / 0.96));
            border-bottom: 1px solid hsl(var(--border));
            padding: 0.5rem 1rem;
            display: flex;
            gap: .5rem;
            align-items: center;
            flex-wrap: wrap;
        }
        .top-nav a, .top-nav button, .top-nav select {
            font-size: .85rem;
        }
        .top-nav a {
            color: hsl(var(--primary));
            text-decoration: none;
            padding: .25rem .5rem;
            border-radius: 6px;
        }
        .top-nav a:hover { background: hsl(var(--secondary)); }
        .top-spacer { height: .25rem; }
        .controls-bar {
            gap: .5rem;
            flex-wrap: wrap;
        }
        .controls-row {
            margin-top: .5rem;
            display: flex;
            gap: .5rem;
            align-items: center;
            flex-wrap: wrap;
        }
        .input-sm {
            height: 32px;
            padding: 0 .5rem;
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            color: hsl(var(--foreground));
            border-radius: 6px;
        }
        .input-sm:focus, .select-sm:focus { outline: none; border-color: hsl(var(--primary)); box-shadow: 0 0 0 2px hsl(var(--primary) / .35); }
        .select-sm { height: 32px; }
        .btn-xs { height: 30px; padding: 0 .6rem; }

        .tree-folder-header:hover { background: hsl(var(--secondary)); }

        .tree-folder-content {
            margin-left: 0.5rem;
        }

        .tree-folder-content.collapsed {
            display: none;
        }

        .tree-file {
            display: flex;
            align-items: center;
            padding: 0.5rem 0.75rem;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.2s;
            gap: 0.5rem;
            margin: 0.25rem 0;
        }

        .tree-file:hover { background: hsl(var(--secondary)); }

        .tree-file.active { background: hsl(var(--primary) / 0.1); border-left: 3px solid hsl(var(--primary)); }

        .tree-icon { flex-shrink: 0; }

        .folder-icon {
            transition: transform 0.2s;
        }

        .tree-folder-header.collapsed .folder-icon {
            transform: rotate(-90deg);
        }

        .tree-name { flex: 1; font-size: 0.9rem; color: hsl(var(--foreground));
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tree-stats {
            display: flex;
            gap: 0.25rem;
            flex-shrink: 0;
        }

        .tree-badge {
            display: inline-block;
            padding: 0.125rem 0.5rem;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 600;
        }

        .tree-badge-error { background: hsl(var(--destructive) / 0.2); color: hsl(var(--destructive-foreground)); border: 1px solid hsl(var(--destructive) / 0.3); }

        .tree-badge-warning { background: hsl(var(--warning) / 0.2); color: hsl(var(--warning-foreground)); border: 1px solid hsl(var(--warning) / 0.3); }

        /* legacy filter-info removed; using filters-toolbar */
        /* Icon base */
        .icon { width: 16px; height: 16px; stroke: currentColor; fill: none; display: inline-block; }
        .icon-lg { width: 20px; height: 20px; }
        .icon-xl { width: 64px; height: 64px; }

        /* Severity icons inherit color from container */
        .severity-icon svg { width: 18px; height: 18px; }
        .expand-toggle-icon svg { width: 14px; height: 14px; }
        .tree-icon svg { width: 16px; height: 16px; }
    </style>
    <!-- Inline SVG icon sprite for a professional look (no external deps) -->
    <svg xmlns="http://www.w3.org/2000/svg" style="display:none">
      <symbol id="icon-check-circle" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
        <path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </symbol>
      <symbol id="icon-alert" viewBox="0 0 24 24">
        <path d="M12 2l10 18H2L12 2z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
        <path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="17" r="1" fill="currentColor"/>
      </symbol>
      <symbol id="icon-x-circle" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
        <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </symbol>
      <symbol id="icon-folder" viewBox="0 0 24 24">
        <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
      </symbol>
      <symbol id="icon-file" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" fill="none"/>
        <path d="M14 2v6h6" stroke="currentColor" stroke-width="2" fill="none"/>
      </symbol>
      <symbol id="icon-hash" viewBox="0 0 24 24">
        <path d="M5 9h14M5 15h14M9 5l-2 14M17 5l-2 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
      </symbol>
      <symbol id="icon-tag" viewBox="0 0 24 24">
        <path d="M20 12l-8 8-8-8 6-6h6l4 4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
        <circle cx="14.5" cy="9.5" r="1.5" fill="currentColor"/>
      </symbol>
      <symbol id="icon-filter" viewBox="0 0 24 24">
        <path d="M4 5h16M7 12h10M10 19h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
      </symbol>
      <symbol id="icon-list" viewBox="0 0 24 24">
        <path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="4" cy="6" r="1" fill="currentColor"/>
        <circle cx="4" cy="12" r="1" fill="currentColor"/>
        <circle cx="4" cy="18" r="1" fill="currentColor"/>
      </symbol>
      <symbol id="icon-duplicate" viewBox="0 0 24 24">
        <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
        <rect x="5" y="5" width="10" height="10" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
      </symbol>
      <symbol id="icon-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/>
        <path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </symbol>
      <symbol id="icon-caret-down" viewBox="0 0 24 24">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </symbol>
      <symbol id="icon-link" viewBox="0 0 24 24">
        <path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07L13 19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
      </symbol>
      <symbol id="icon-lock" viewBox="0 0 24 24">
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
        <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="12" cy="15" r="1.5" fill="currentColor"/>
      </symbol>
    </svg>
    <script>
        let filterState = { showErrors: true, showWarnings: true, rule: '', q: '', sort: 'issues' };
        const urlParams = new URLSearchParams(location.search);
        const forceFull = urlParams.get('lite') === '0' || urlParams.get('mode') === 'full';
        const forceLite = urlParams.get('lite') === '1' || urlParams.get('mode') === 'lite';
        const smallScreen = matchMedia('(max-width: 768px)').matches;
        const isMobileUA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
        const IS_LITE = forceFull ? false : (forceLite ? true : (smallScreen || isMobileUA));

        function toggleExpand(button, sectionId) {
            const section = document.getElementById(sectionId);
            const isExpanded = section.classList.contains('expanded');

            if (isExpanded) {
                section.classList.remove('expanded');
                button.classList.remove('expanded');
            } else {
                section.classList.add('expanded');
                button.classList.add('expanded');
            }
        }

        function toggleFolder(header) {
            const content = header.nextElementSibling;
            const isCollapsed = content.classList.contains('collapsed');

            if (isCollapsed) {
                content.classList.remove('collapsed');
                header.classList.remove('collapsed');
            } else {
                content.classList.add('collapsed');
                header.classList.add('collapsed');
            }
        }

        function scrollToFile(fileId) {
            // Remove active class from all files
            document.querySelectorAll('.tree-file').forEach(f => f.classList.remove('active'));

            // Add active class to clicked file
            event.currentTarget.classList.add('active');

            // Scroll to the file in the main content
            const fileElement = document.getElementById(fileId);
            if (fileElement) {
                // Expand the file if it's collapsed
                fileElement.classList.remove('file-collapsed');

                fileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // Highlight the file briefly
                fileElement.style.animation = 'highlight 2s ease-out';
                setTimeout(() => {
                    fileElement.style.animation = '';
                }, 2000);
            }
        }

        function toggleFileCollapse(fileElement, event) {
            // Prevent event bubbling if clicking on the toggle itself
            if (event) {
                event.stopPropagation();
            }

            fileElement.classList.toggle('file-collapsed');
        }

        function toggleSectionCollapse(headerEl) {
            const sec = headerEl.closest('.section');
            if (sec) sec.classList.toggle('collapsed');
        }

        function updateIssueFilters() {
            const issues = Array.from(document.querySelectorAll('.issue'));
            const { showErrors, showWarnings, rule, q } = filterState;
            const ql = (q || '').toLowerCase().trim();
            issues.forEach(issue => {
                const sev = issue.getAttribute('data-severity');
                const ruleId = issue.getAttribute('data-rule') || '';
                const msg = issue.getAttribute('data-message') || '';
                let visible = true;
                if (sev === 'error' && !showErrors) visible = false;
                if (sev === 'warning' && !showWarnings) visible = false;
                if (rule && ruleId !== rule) visible = false;
                if (ql && !(msg.includes(ql))) visible = false;
                issue.style.display = visible ? '' : 'none';
            });

            // Hide file containers with no visible issues
            document.querySelectorAll('.file-issue').forEach(file => {
                const issuesInFile = Array.from(file.querySelectorAll('.file-issues-container .issue'));
                const anyVisible = issuesInFile.some(el => el.style.display !== 'none');
                file.style.display = anyVisible ? '' : 'none';
            });

            // Update active rule chip
            const chip = document.getElementById('active-rule-chip');
            const clearBtn = document.getElementById('clear-rule-filter');
            if (chip && clearBtn) {
                if (rule) {
                    chip.textContent = rule;
                    chip.style.display = 'inline-block';
                    clearBtn.style.display = 'inline-flex';
                } else {
                    chip.style.display = 'none';
                    clearBtn.style.display = 'none';
                }
            }

            applySorting();
            syncUrl();
        }

        function onSeverityCheckboxChange() {
            const errorsCb = document.getElementById('filter-errors');
            const warningsCb = document.getElementById('filter-warnings');
            filterState.showErrors = !!(errorsCb && errorsCb.checked);
            filterState.showWarnings = !!(warningsCb && warningsCb.checked);
            // sync top chips
            const eTop = document.getElementById('toggle-errors-top');
            const wTop = document.getElementById('toggle-warnings-top');
            if (eTop) eTop.classList.toggle('active', filterState.showErrors);
            if (wTop) wTop.classList.toggle('active', filterState.showWarnings);
            updateIssueFilters();
        }

        function filterByRule(ruleId) {
            filterState.rule = (filterState.rule === ruleId) ? '' : ruleId;
            updateIssueFilters();
        }

        function clearRuleFilter() {
            filterState.rule = '';
            updateIssueFilters();
        }

        function toggleSeverityTop(kind) {
            const errorsCb = document.getElementById('filter-errors');
            const warningsCb = document.getElementById('filter-warnings');
            if (kind === 'error' && errorsCb) {
                errorsCb.checked = !errorsCb.checked;
            }
            if (kind === 'warning' && warningsCb) {
                warningsCb.checked = !warningsCb.checked;
            }
            onSeverityCheckboxChange();
        }

        function mountFullReport() {
            const url = new URL(location.href);
            url.searchParams.set('lite', '0');
            location.href = url.toString();
        }

        function copyFileLink(fileId, ev) {
            ev && ev.stopPropagation();
            const url = location.origin + location.pathname + '#' + fileId;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).catch(() => {});
            } else {
                const ta = document.createElement('textarea');
                ta.value = url;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch {}
                document.body.removeChild(ta);
            }
        }

        function filterTree(input) {
            const q = (input.value || '').toLowerCase();
            const files = Array.from(document.querySelectorAll('.tree-file'));
            files.forEach(f => {
                const name = (f.textContent || '').toLowerCase();
                const match = !q || name.includes(q);
                f.style.display = match ? '' : 'none';
            });
            // Optionally hide folders without visible files
            const folders = Array.from(document.querySelectorAll('.tree-folder'));
            folders.forEach(folder => {
                const filesInFolder = Array.from(folder.querySelectorAll(':scope .tree-file'));
                const anyVisible = filesInFolder.some(el => el.style.display !== 'none');
                folder.style.display = anyVisible ? '' : 'none';
            });
        }

        function onSearchChange(input) {
            filterState.q = input.value || '';
            updateIssueFilters();
        }

        function onRuleInputChange(input) {
            filterState.rule = (input.value || '').trim();
            updateIssueFilters();
        }

        function onSortChange(select) {
            filterState.sort = select.value;
            applySorting();
            syncUrl();
        }

        function applySorting() {
            const container = document.querySelector('#section-files .section-content');
            if (!container) return;
            const items = Array.from(container.querySelectorAll('.file-issue'));
            const sort = filterState.sort || 'issues';
            items.sort((a, b) => {
                if (sort === 'alpha') {
                    const pa = a.getAttribute('data-path') || '';
                    const pb = b.getAttribute('data-path') || '';
                    return pa.localeCompare(pb);
                }
                if (sort === 'errors') {
                    const ea = parseInt(a.getAttribute('data-errors') || '0', 10);
                    const eb = parseInt(b.getAttribute('data-errors') || '0', 10);
                    return eb - ea || (a.getAttribute('data-path') || '').localeCompare(b.getAttribute('data-path') || '');
                }
                // default: visible issues count
                const va = Array.from(a.querySelectorAll('.issue')).filter(x => x.style.display !== 'none').length;
                const vb = Array.from(b.querySelectorAll('.issue')).filter(x => x.style.display !== 'none').length;
                return vb - va || (a.getAttribute('data-path') || '').localeCompare(b.getAttribute('data-path') || '');
            });
            items.forEach(el => container.appendChild(el));
        }

        function expandAllFiles() {
            document.querySelectorAll('.file-issue').forEach(f => f.classList.remove('file-collapsed'));
        }
        function collapseAllFiles() {
            document.querySelectorAll('.file-issue').forEach(f => f.classList.add('file-collapsed'));
        }

        function toggleSidebar() {
            const sb = document.getElementById('sidebar');
            if (sb) sb.classList.toggle('hidden');
        }

        function syncUrl() {
            const url = new URL(location.href);
            url.searchParams.set('lite', IS_LITE ? '1' : '0');
            url.searchParams.set('errors', filterState.showErrors ? '1' : '0');
            url.searchParams.set('warnings', filterState.showWarnings ? '1' : '0');
            if (filterState.rule) url.searchParams.set('rule', filterState.rule); else url.searchParams.delete('rule');
            if (filterState.q) url.searchParams.set('q', filterState.q); else url.searchParams.delete('q');
            if (filterState.sort && filterState.sort !== 'issues') url.searchParams.set('sort', filterState.sort); else url.searchParams.delete('sort');
            history.replaceState(null, '', url.toString());
        }

        window.addEventListener('load', () => {
            if (IS_LITE) {
                const ids = ['sidebar','section-charts','section-rules','section-security','section-secrets','section-tsprune','section-jscpd','section-files'];
                ids.forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
                const cta = document.getElementById('full-report-cta'); if (cta) cta.style.display = '';
            }
            // Initialize from URL
            if (urlParams.has('errors')) {
                const v = urlParams.get('errors') === '1';
                const eCb = document.getElementById('filter-errors');
                if (eCb) eCb.checked = v;
                filterState.showErrors = v;
            }
            if (urlParams.has('warnings')) {
                const v = urlParams.get('warnings') === '1';
                const wCb = document.getElementById('filter-warnings');
                if (wCb) wCb.checked = v;
                filterState.showWarnings = v;
            }
            const ruleQ = urlParams.get('rule') || '';
            const qText = urlParams.get('q') || '';
            const sort = urlParams.get('sort') || 'issues';
            filterState.rule = ruleQ;
            filterState.q = qText;
            filterState.sort = sort;
            const ruleInput = document.getElementById('filter-rule-input');
            if (ruleInput) ruleInput.value = ruleQ;
            const searchInput = document.getElementById('filter-search');
            if (searchInput) searchInput.value = qText;
            const sortSel = document.getElementById('sort-files');
            if (sortSel) sortSel.value = sort;

            onSeverityCheckboxChange();
            if (location.hash) {
                const id = location.hash.slice(1);
                const el = document.getElementById(id);
                if (el) {
                    el.classList.remove('file-collapsed');
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            // Patch Download JSON link when served via API route
            try {
              const a = document.querySelector('a[href="lint-summary.json"]');
              if (a && location.pathname.includes('/api/repos/')) {
                const parts = location.pathname.split('/').filter(Boolean);
                const idx = parts.indexOf('repos');
                if (idx !== -1 && parts[idx+1] && parts[idx+3]) {
                  const slug = parts[idx+1];
                  const id = parts[idx+3];
                  a.setAttribute('href', location.origin + '/api/repos/' + encodeURIComponent(slug) + '/reports/' + encodeURIComponent(id) + '/lint-summary.json');
                }
              }
            } catch {}
        });
    </script>
    <style>
        @keyframes highlight {
            0% { background: hsl(var(--warning) / 0.2); }
            100% { background: transparent; }
        }

        code {
            background: hsl(var(--secondary));
            padding: 0.125rem 0.375rem;
            border-radius: 4px;
            font-size: 0.9em;
            color: hsl(var(--primary));
            border: 1px solid hsl(var(--border));
        }

        ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }

        ::-webkit-scrollbar-track {
            background: hsl(var(--background));
        }

        ::-webkit-scrollbar-thumb {
            background: hsl(var(--border));
            border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: hsl(var(--muted-foreground) / 0.5);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>ESLint Quality Report</h1>
        <div class="subtitle">Generated on ${new Date().toLocaleString()} • ${escapeHtml(String(eslintTarget))}</div>
    </div>

    <div class="main-content">
        <aside id="sidebar" class="sidebar">
            <div class="sidebar-header"><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-folder" /></svg> Files with Issues</div>
            <div class="sidebar-search">
                <input type="text" placeholder="Search files..." oninput="filterTree(this)" />
            </div>
            <div class="tree-container">
                ${fileTreeHtml}
            </div>
        </aside>

        <div class="container">
        <div class="top-nav">
            <a href="#section-charts">Overview</a>
            <a href="#section-rules">Rules</a>
            <a href="#section-security">Security</a>
            <a href="#section-secrets">Secrets</a>
            <a href="#section-tsprune">Unused Exports</a>
            <a href="#section-jscpd">Duplicates</a>
            <a href="#section-files">Files</a>
            <span style="flex:1"></span>
            <button class="btn btn-outline btn-xs" onclick="toggleSidebar()">Mostrar/Ocultar Panel</button>
            <a class="btn btn-outline btn-xs" href="lint-summary.json" target="_blank" rel="noopener noreferrer">Descargar JSON</a>
        </div>
        <div class="top-spacer"></div>
        <div class="filters-toolbar">
            <span class="filters-title"><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-filter" /></svg> Filters</span>
            ${ignorePatterns.length > 0 ? ignorePatterns.map((p) => `<span class="chip-filter" title="Ignored pattern"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-tag" /></svg>${escapeHtml(p)}</span>`).join('') : ''}
            <span class="chip-toggle" id="toggle-errors-top" onclick="toggleSeverityTop('error')"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-alert" /></svg> Errors</span>
            <span class="chip-toggle" id="toggle-warnings-top" onclick="toggleSeverityTop('warning')"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-alert" /></svg> Warnings</span>
            <span style="margin-left:auto; color: hsl(var(--muted-foreground)); font-size:.85rem;">+ Add filters</span>
        </div>

        <div class="summary">
            <div class="summary-card files">
                <div class="label">Files Analyzed</div>
                <div class="value">${filteredResults.length}</div>
            </div>
            <div class="summary-card">
                <div class="label">ESLint Issues</div>
                <div class="value">${totalIssues}</div>
            </div>
            <div class="summary-card errors">
                <div class="label">Errors</div>
                <div class="value">${errorCount}</div>
            </div>
            <div class="summary-card warnings">
                <div class="label">Warnings</div>
                <div class="value">${warningCount}</div>
            </div>
            <div class="summary-card" style="border-left-color: hsl(var(--primary));">
                <div class="label">Unused Exports</div>
                <div class="value">${tsPruneData.count}</div>
            </div>
            <div class="summary-card" style="border-left-color: hsl(var(--warning));">
                <div class="label">Code Duplicates</div>
                <div class="value">${jscpdData.count}</div>
            </div>
            <div class="summary-card" style="border-left-color: hsl(var(--accent));">
                <div class="label">Security</div>
                <div class="value">${securityCount}</div>
            </div>
        </div>

        <div id="full-report-cta" class="section" style="display:none;">
            <div class="section-content">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
                    <div style="color:hsl(var(--muted-foreground))">Lightweight view is active on mobile to improve performance.</div>
                    <button class="btn-primary" onclick="mountFullReport()">Load Full Report</button>
                </div>
            </div>
        </div>

        <!-- Issue Distribution KPIs/Charts -->
        <div id="section-charts" class="section">
            <div class="section-header"><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-list" /></svg> Issue Distribution Overview</div>
            <div class="section-content">
                <div class="charts-grid">
                    <div class="chart-card">
                        <div class="chart-title">By Directory (Top 10)</div>
                        ${topDirs.length === 0 ? `<div style="color: hsl(var(--muted-foreground));">No issues to chart.</div>` : `
                        <div class="bar-chart">
                            ${topDirs
                              .map(([dir, count], idx) => {
                                const h = Math.max(4, Math.round((count / maxDirIssues) * 100));
                                const colorVar = barColorVars[idx % barColorVars.length];
                                return `
                                <div class="bar-wrap" title="${escapeHtml(dir)}: ${count}">
                                    <div class="bar" style="height:${h}%; --bar-color-hsl: var(${colorVar});"><span class="bar-value">${count}</span></div>
                                    <div class="bar-label">${escapeHtml(dir)}</div>
                                </div>`;
                              })
                              .join('')}
                        </div>`}
                    </div>
                    <div class="chart-card">
                        <div class="chart-title">By Type</div>
                        <div class="donut-wrap">
                            <div class="donut"></div>
                            <div class="legend">
                                ${donutData
                                  .map(
                                    (d) => `
                                <div class="legend-item">
                                    <span class="legend-swatch" style="background:${d.color}"></span>
                                    <span>${d.key}</span>
                                    <span style="margin-left:auto; font-weight:600;">${d.count}</span>
                                </div>`,
                                  )
                                  .join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${
          sortedRules.length > 0
            ? `
        <div id="section-rules" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-list" /></svg> Issues by Rule (Top ${Math.min(15, sortedRules.length)})</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>Rule</th>
                            <th style="text-align: center;">Total</th>
                            <th style="text-align: center;">Errors</th>
                            <th style="text-align: center;">Warnings</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedRules
                          .slice(0, 15)
                          .map(
                            ([rule, stats]) => `
                        <tr>
                            <td class="rule-name">${(() => { const url = docUrlForRule(rule) || '#'; return `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(rule)}</a>`; })()}</td>
                            <td style="text-align: center; font-weight: bold;">${stats.count}</td>
                            <td style="text-align: center;">${stats.errors > 0 ? `<span class="badge badge-error">${stats.errors}</span>` : '—'}</td>
                            <td style="text-align: center;">${stats.warnings > 0 ? `<span class="badge badge-warning">${stats.warnings}</span>` : '—'}</td>
                            <td style="text-align: right;"><button class="btn-copy" onclick="filterByRule('${escapeHtml(rule)}')">View Affected Files</button></td>
                        </tr>
                        `,
                          )
                          .join('')}
                    </tbody>
                </table></div>
            </div>
        </div>
        `
            : ''
        }

        ${securityCount > 0 ? `
        <div id="section-security" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-alert" /></svg> Security Findings (ESLint + Semgrep)</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Line</th>
                            <th>Rule</th>
                            <th>Source</th>
                            <th>Severity</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${securityFindings.slice(0, 200).map(item => `
                        <tr>
                            <td><code>${escapeHtml(item.file)}</code></td>
                            <td style="text-align: center;">${item.line}</td>
                            <td>${(() => { const url = docUrlForRule(item.ruleId); const content = `<code>${escapeHtml(item.ruleId)}</code>`; return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${content}</a>` : content; })()}</td>
                            <td style="text-transform: capitalize;">${escapeHtml(item.source || 'unknown')}</td>
                            <td style="text-align: center;">${item.severity}</td>
                            <td>${escapeHtml(item.message)}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table></div>
                ${securityFindings.length > 200 ? `<p style="margin-top: 1rem; color: hsl(var(--muted-foreground));">Showing first 200 of ${securityFindings.length} security rule findings</p>` : ''}
            </div>
        </div>
        ` : ''}

        ${secretFindings.length > 0 ? `
        <div id="section-secrets" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-lock" /></svg> Secrets & Credentials (Heuristics + Gitleaks)</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Line</th>
                            <th>Type</th>
                            <th>Source</th>
                            <th>Excerpt</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${secretFindings.slice(0, 200).map(item => `
                        <tr>
                            <td><code>${escapeHtml(item.file)}</code></td>
                            <td style="text-align: center;">${item.line}</td>
                            <td>${escapeHtml(item.type)}</td>
                            <td style="text-transform: capitalize;">${escapeHtml(item.source || 'unknown')}</td>
                            <td><code>${escapeHtml(item.match)}</code></td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table></div>
                ${secretFindings.length > 200 ? `<p style="margin-top: 1rem; color: hsl(var(--muted-foreground));">Showing first 200 of ${secretFindings.length} potential secrets</p>` : ''}
            </div>
        </div>
        ` : ''}

        ${depVulnCount > 0 ? `
        <div id="section-deps" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-alert" /></svg> Dependencies Vulnerabilities (OSV-Scanner)</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>Package</th>
                            <th>Version</th>
                            <th>Vuln ID</th>
                            <th>Severity</th>
                            <th>Source</th>
                            <th>Summary</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${osvFindings.slice(0, 200).map(v => `
                        <tr>
                            <td><code>${escapeHtml(v.package)}</code></td>
                            <td style="text-align:center;">${escapeHtml(v.version)}</td>
                            <td><code>${escapeHtml(v.id)}</code></td>
                            <td style="text-align:center;">${escapeHtml(v.severity)}</td>
                            <td><code>${escapeHtml(v.source || '')}</code></td>
                            <td>${escapeHtml(v.summary || '')}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table></div>
                ${depVulnCount > 200 ? `<p style="margin-top: 1rem; color: hsl(var(--muted-foreground));">Showing first 200 of ${depVulnCount} dependency vulnerabilities</p>` : ''}
            </div>
        </div>
        ` : ''}

        ${tsPruneData.count > 0 ? `
        <div id="section-tsprune" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-list" /></svg> Unused Exports (ts-prune)</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Line</th>
                            <th>Export</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tsPruneData.items.slice(0, 100).map(item => `
                        <tr>
                            <td><code>${escapeHtml(item.file)}</code></td>
                            <td style="text-align: center;">${item.line}</td>
                            <td><code>${escapeHtml(item.export)}</code></td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table></div>
                ${tsPruneData.count > 100 ? `<p style="margin-top: 1rem; color: hsl(var(--muted-foreground));">Showing first 100 of ${tsPruneData.count} unused exports</p>` : ''}
            </div>
        </div>
        ` : ''}

        ${jscpdData.count > 0 ? `
        <div id="section-jscpd" class="section collapsible collapsed">
            <div class="section-header" onclick="toggleSectionCollapse(this)"><span><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-duplicate" /></svg> Code Duplicates (jscpd) - ${jscpdData.percentage.toFixed(2)}% duplication</span><span class="caret">▾</span></div>
            <div class="section-content">
                <div class="table-responsive"><table class="rules-table">
                    <thead>
                        <tr>
                            <th>File 1</th>
                            <th>Lines</th>
                            <th>File 2</th>
                            <th>Lines</th>
                            <th>Tokens</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${jscpdData.duplicates.map(dup => `
                        <tr>
                            <td><code>${escapeHtml(dup.firstFile?.name || 'N/A')}</code></td>
                            <td style="text-align: center;">${dup.firstFile?.start || 'N/A'}-${dup.firstFile?.end || 'N/A'}</td>
                            <td><code>${escapeHtml(dup.secondFile?.name || 'N/A')}</code></td>
                            <td style="text-align: center;">${dup.secondFile?.start || 'N/A'}-${dup.secondFile?.end || 'N/A'}</td>
                            <td style="text-align: center;">${dup.tokens || 0}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table></div>
                ${jscpdData.count > 50 ? `<p style="margin-top: 1rem; color: hsl(var(--muted-foreground));">Showing first 50 of ${jscpdData.count} duplicates</p>` : ''}
            </div>
        </div>
        ` : ''}

        <div id="section-files" class="section">
            <div class="section-header"><svg class="icon icon-lg" viewBox="0 0 24 24"><use href="#icon-search" /></svg> ESLint Issues by File</div>
            <div class="section-content">
                <div class="controls-bar">
                    <label class="control"><input id="filter-errors" type="checkbox" checked onchange="onSeverityCheckboxChange()" /> Errors</label>
                    <label class="control"><input id="filter-warnings" type="checkbox" checked onchange="onSeverityCheckboxChange()" /> Warnings</label>
                    <span class="control">Rule: <span id="active-rule-chip" class="chip"></span></span>
                    <button id="clear-rule-filter" class="btn-clear" onclick="clearRuleFilter()"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-x-circle" /></svg> Clear</button>
                </div>
                <div class="controls-row">
                    <input id="filter-search" class="input-sm" placeholder="Buscar issues o archivos..." oninput="onSearchChange(this)" />
                    <input id="filter-rule-input" class="input-sm" placeholder="Filtrar por regla (p. ej., no-unused-vars)" oninput="onRuleInputChange(this)" />
                    <select id="sort-files" class="input-sm select-sm" onchange="onSortChange(this)">
                        <option value="issues">Ordenar: Más issues</option>
                        <option value="errors">Ordenar: Más errores</option>
                        <option value="alpha">Ordenar: A → Z</option>
                    </select>
                    <button class="btn btn-outline btn-xs" onclick="expandAllFiles()">Expandir todo</button>
                    <button class="btn btn-outline btn-xs" onclick="collapseAllFiles()">Colapsar todo</button>
                </div>
                ${
                  totalIssues === 0
                    ? `
                <div class="no-issues">
                    <div class="no-issues-icon"><svg class="icon icon-xl" viewBox="0 0 24 24"><use href="#icon-check-circle" /></svg></div>
                    <div class="no-issues-text">No issues found!</div>
                    <p style="margin-top: 0.5rem;">All files passed ESLint validation.</p>
                </div>
                `
                    : resultsWithSnippets
                        .filter(
                          (result) =>
                            result.errorCount > 0 || result.warningCount > 0,
                        )
                        .map((result) => {
                          const relativePath = path.relative(
                            process.cwd(),
                            result.filePath,
                          );
                          const fileId = `file-${relativePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
                          return `
                        <div class="file-issue" id="${fileId}" data-path="${escapeHtml(relativePath)}" data-errors="${result.errorCount}" data-warnings="${result.warningCount}">
                            <div class="file-header" onclick="toggleFileCollapse(this.parentElement, event)">
                                <div class="file-header-left">
                                    <div class="collapse-toggle"></div>
                                    <div class="file-path">${escapeHtml(relativePath)}</div>
                                </div>
                                <div class="file-stats">
                                    ${result.errorCount > 0 ? `<span class="badge badge-error">${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}</span>` : ''}
                                    ${result.warningCount > 0 ? `<span class="badge badge-warning">${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}</span>` : ''}
                                </div>
                                <button class="btn-copy" onclick="copyFileLink('${fileId}', event)"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-link" /></svg> Copy link</button>
                            </div>
                            <div class="file-issues-container">
                            ${result.messagesWithSnippets
                              .map((messageWithSnippet, messageIndex) => {
                                const message = messageWithSnippet;
                                const snippet = messageWithSnippet.snippet;
                                const isError = message.severity === 2;
                                const uniqueId = `snippet-${result.filePath.replace(/[^a-zA-Z0-9]/g, '-')}-${messageIndex}`;

                                const hasContent = snippet.visible.length > 0 || snippet.expandableTop.length > 0 || snippet.expandableBottom.length > 0;

                                return `
                                <div class="issue" data-severity="${isError ? 'error' : 'warning'}" data-rule="${escapeHtml(message.ruleId || '')}" data-message="${escapeHtml((message.message || '').toLowerCase())}">
                                    <div class="issue-header">
                                        <div class="severity-icon severity-${isError ? 'error' : 'warning'}">
                                            <svg class="icon" viewBox="0 0 24 24"><use href="#${isError ? 'icon-x-circle' : 'icon-alert'}" /></svg>
                                        </div>
                                        <div class="issue-details">
                                            <div class="issue-message">${escapeHtml(message.message)}</div>
                                            <div class="issue-meta">
                                                <div class="issue-meta-item">
                                                    <svg class="icon" viewBox="0 0 24 24"><use href="#icon-hash" /></svg>
                                                    Line ${message.line}:${message.column}
                                                </div>
                                                ${
                                                  message.ruleId
                                                    ? `
                                                <div class="issue-meta-item">
                                                    <svg class="icon" viewBox="0 0 24 24"><use href="#icon-tag" /></svg>
                                                    ${(() => { const url = docUrlForRule(message.ruleId); const content = `<code lang="typescript">${escapeHtml(message.ruleId)}</code>`; return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${content}</a>` : content; })()}
                                                </div>
                                                `
                                                    : ''
                                                }
                                            </div>
                                        </div>
                                    </div>
                                    ${
                                      hasContent
                                        ? `
                                    <div class="code-snippet">
                                        ${snippet.expandableTop.length > 0 ? `
                                        <div class="expand-toggle" onclick="toggleExpand(this, '${uniqueId}-top')">
                                            <span class="expand-toggle-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-caret-down" /></svg></span>
                                            <span>Show ${snippet.expandableTop.length} more line${snippet.expandableTop.length !== 1 ? 's' : ''} above</span>
                                        </div>
                                        <div id="${uniqueId}-top" class="expandable-section">
                                            ${snippet.expandableTop
                                              .map(
                                                (line) => `
                                            <div class="code-line expandable">
                                                <span class="line-number">${line.number}</span>
                                                <span class="line-content">${line.highlightedContent}</span>
                                            </div>`,
                                              )
                                              .join('')}
                                        </div>
                                        ` : ''}
                                        ${snippet.visible
                                          .map(
                                            (line) => `
                                        <div class="code-line ${line.isError ? 'error-line' : ''}">
                                            <span class="line-number">${line.number}</span>
                                            <span class="line-content">${line.highlightedContent}</span>
                                        </div>
                                        ${line.isError && message.column ? `<div class="error-arrow">${' '.repeat(message.column - 1)}^--- ${escapeHtml(message.message)}</div>` : ''}
                                        `,
                                          )
                                          .join('')}
                                        ${snippet.expandableBottom.length > 0 ? `
                                        <div class="expand-toggle" onclick="toggleExpand(this, '${uniqueId}-bottom')">
                                            <span class="expand-toggle-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-caret-down" /></svg></span>
                                            <span>Show ${snippet.expandableBottom.length} more line${snippet.expandableBottom.length !== 1 ? 's' : ''} below</span>
                                        </div>
                                        <div id="${uniqueId}-bottom" class="expandable-section">
                                            ${snippet.expandableBottom
                                              .map(
                                                (line) => `
                                            <div class="code-line expandable">
                                                <span class="line-number">${line.number}</span>
                                                <span class="line-content">${line.highlightedContent}</span>
                                            </div>`,
                                              )
                                              .join('')}
                                        </div>
                                        ` : ''}
                                    </div>
                                    `
                                        : ''
                                    }
                                </div>
                                `;
                              })
                              .join('')}
                            </div>
                        </div>
                        `;
                        })
                        .join('')
                }
            </div>
        </div>
        </div>
    </div>
</body>
</html>`;

  // Save to file
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, 'lint-report.html');
  fs.writeFileSync(reportPath, html);

  console.log(`[OK] HTML report generated: ${reportPath}`);
  console.log(
    `[SUMMARY] ${totalIssues} total issues (${errorCount} errors, ${warningCount} warnings)`,
  );

  // Quality gates (optional) — compute first to include in summary
  let exitCode = 0;
  const failures = [];
  if (strictMode && errorCount > 0) {
    failures.push(`strict mode: ${errorCount} errors > 0`);
  }
  if (typeof maxErrorsGate === 'number' && errorCount > maxErrorsGate) {
    failures.push(`errors ${errorCount} > max-errors ${maxErrorsGate}`);
  }
  if (typeof maxWarningsGate === 'number' && warningCount > maxWarningsGate) {
    failures.push(`warnings ${warningCount} > max-warnings ${maxWarningsGate}`);
  }
  if (typeof maxUnusedExportsGate === 'number' && (tsPruneData?.count || 0) > maxUnusedExportsGate) {
    failures.push(`unused-exports ${(tsPruneData?.count || 0)} > max-unused-exports ${maxUnusedExportsGate}`);
  }
  if (typeof maxDupPercentGate === 'number' && (jscpdData?.percentage || 0) > maxDupPercentGate) {
    failures.push(`duplication ${(jscpdData?.percentage || 0).toFixed(2)}% > max-dup-percent ${maxDupPercentGate}`);
  }
  if (typeof maxSecretsGate === 'number' && (secretFindings?.length || 0) > maxSecretsGate) {
    failures.push(`secrets ${(secretFindings?.length || 0)} > max-secrets ${maxSecretsGate}`);
  }
  if (typeof maxSastGate === 'number' && (semgrepFindings?.length || 0) > maxSastGate) {
    failures.push(`sast ${(semgrepFindings?.length || 0)} > max-sast ${maxSastGate}`);
  }
  if (typeof maxDepVulnsGate === 'number' && depVulnCount > maxDepVulnsGate) {
    failures.push(`dependencies ${depVulnCount} > max-dep-vulns ${maxDepVulnsGate}`);
  }
  if (failures.length > 0) {
    exitCode = 2;
    console.log(`[QUALITY GATE] Failed: ${failures.join('; ')}`);
  }

  // Write machine-readable summary alongside HTML for persistence/history
  try {
    const topRules = (Array.isArray(sortedRules) ? sortedRules : [])
      .slice(0, 10)
      .map(([rule, stats]) => ({ rule, ...stats }));
    // Build full per-file issues for machine consumption (all ESLint messages)
    const filesDetailed = filteredResults.map((res) => ({
      file: path.relative(process.cwd(), res.filePath),
      errorCount: res.errorCount,
      warningCount: res.warningCount,
      messages: (res.messages || []).map((m) => ({
        line: m.line || 0,
        column: m.column || 0,
        endLine: m.endLine || undefined,
        endColumn: m.endColumn || undefined,
        ruleId: m.ruleId || '',
        severity: m.severity === 2 ? 'error' : 'warning',
        message: m.message || '',
      })),
    }));
    const jsonSummary = {
      generatedAt: new Date().toISOString(),
      filesAnalyzed: filteredResults.length,
      totalIssues,
      errorCount,
      warningCount,
      topRules,
      tsPrune: { count: (typeof tsPruneData?.count === 'number') ? tsPruneData.count : 0 },
      jscpd: {
        count: (typeof jscpdData?.count === 'number') ? jscpdData.count : 0,
        percentage: (typeof jscpdData?.percentage === 'number') ? jscpdData.percentage : 0,
      },
      security: { count: securityCount },
      dependencies: { count: depVulnCount },
      qualityGate: {
        passed: failures.length === 0,
        failures,
      },
      // Full ESLint issues by file
      files: filesDetailed,
    };
    fs.writeFileSync(path.join(reportsDir, 'lint-summary.json'), JSON.stringify(jsonSummary, null, 2), 'utf8');
  } catch (e) {
    console.warn('[WARN] Failed to write lint-summary.json:', e?.message || e);
  }

  // CodeClimate JSON (GitLab Code Quality)
  try {
    const issues = [];
    for (const res of filteredResults) {
      const relPath = path.relative(process.cwd(), res.filePath);
      for (const msg of (res.messages || [])) {
        const severity = msg.severity === 2 ? 'major' : 'minor';
        const categories = msg.severity === 2 ? ['Bug Risk'] : ['Style'];
        const fp = crypto
          .createHash('md5')
          .update(`${relPath}:${msg.ruleId || 'eslint'}:${msg.line || 0}:${msg.column || 0}:${msg.message || ''}`)
          .digest('hex');
        issues.push({
          type: 'issue',
          check_name: msg.ruleId || 'eslint',
          description: msg.message || '',
          categories,
          severity,
          fingerprint: fp,
          location: {
            path: relPath,
            positions: {
              begin: { line: msg.line || 1, column: msg.column || 1 },
            },
          },
        });
      }
    }
    // Append OSV-Scanner findings as CodeClimate issues (category Security)
    for (const v of osvFindings) {
      const relPath = v.source || 'dependency-manifest';
      const sev = (v.severity || 'MEDIUM').toUpperCase();
      const severity = (sev === 'CRITICAL' || sev === 'HIGH') ? 'major' : 'minor';
      const fp = crypto
        .createHash('md5')
        .update(`osv:${relPath}:${v.package}:${v.version}:${v.id}`)
        .digest('hex');
      issues.push({
        type: 'issue',
        check_name: `osv:${v.id}`,
        description: `${v.package}@${v.version}: ${v.summary || 'Vulnerability found'}`,
        categories: ['Security'],
        severity,
        fingerprint: fp,
        location: {
          path: relPath,
          positions: { begin: { line: 1, column: 1 } },
        },
      });
    }
    // Append Semgrep findings as CodeClimate issues (category Security)
    for (const s of semgrepFindings) {
      const relPath = s.path;
      const sev = s.severity === 'ERROR' ? 'major' : 'minor';
      const fp = crypto
        .createHash('md5')
        .update(`semgrep:${relPath}:${s.check_id}:${s.start}:${s.message}`)
        .digest('hex');
      issues.push({
        type: 'issue',
        check_name: `semgrep:${s.check_id}`,
        description: s.message || s.check_id,
        categories: ['Security'],
        severity: sev,
        fingerprint: fp,
        location: {
          path: relPath,
          positions: { begin: { line: s.start || 1, column: 1 } },
        },
      });
    }
    // Append Gitleaks findings as CodeClimate issues (category Security)
    for (const l of gitleaksFindings) {
      const relPath = l.file || 'unknown';
      const fp = crypto
        .createHash('md5')
        .update(`gitleaks:${relPath}:${l.rule}:${l.line}:${l.match}`)
        .digest('hex');
      issues.push({
        type: 'issue',
        check_name: `gitleaks:${l.rule || 'secret'}`,
        description: `Potential secret detected`,
        categories: ['Security'],
        severity: 'major',
        fingerprint: fp,
        location: {
          path: relPath,
          positions: { begin: { line: l.line || 1, column: 1 } },
        },
      });
    }
    fs.writeFileSync(
      path.join(reportsDir, 'gl-code-quality-report.json'),
      JSON.stringify(issues, null, 2),
      'utf8'
    );
    console.log('[OK] CodeClimate report generated: gl-code-quality-report.json');
  } catch (e) {
    console.warn('[WARN] Failed to write CodeClimate report:', e?.message || e);
  }

  // ESLint SARIF (with fallback if built-in formatter not available)
  try {
    const eslintForFmt = new ESLint({ cwd: tmpCwd });
    try {
      const sarifFormatter = await eslintForFmt.loadFormatter('sarif');
      const sarifStr = sarifFormatter.format(filteredResults);
      fs.writeFileSync(path.join(reportsDir, 'eslint-sarif.json'), sarifStr, 'utf8');
      console.log('[OK] SARIF report generated: eslint-sarif.json');
    } catch (fmtErr) {
      // Minimal SARIF fallback
      const rulesMap = new Map();
      const resultsSarif = [];
      for (const res of filteredResults) {
        const relPath = path.relative(process.cwd(), res.filePath);
        for (const msg of (res.messages || [])) {
          const ruleId = msg.ruleId || 'eslint';
          if (!rulesMap.has(ruleId)) {
            rulesMap.set(ruleId, {
              id: ruleId,
              shortDescription: { text: ruleId },
              helpUri: 'https://eslint.org',
            });
          }
          resultsSarif.push({
            ruleId,
            level: msg.severity === 2 ? 'error' : 'warning',
            message: { text: msg.message || '' },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: relPath.replace(/\\/g, '/') },
                region: { startLine: msg.line || 1, startColumn: msg.column || 1 },
              },
            }],
          });
        }
      }
      const sarifDoc = {
        $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'ESLint', informationUri: 'https://eslint.org', rules: Array.from(rulesMap.values()) } },
          results: resultsSarif,
        }],
      };
      fs.writeFileSync(path.join(reportsDir, 'eslint-sarif.json'), JSON.stringify(sarifDoc, null, 2), 'utf8');
      console.log('[OK] SARIF report generated (fallback): eslint-sarif.json');
    }
  } catch (e) {
    console.log('[WARN] SARIF generation skipped:', e?.message || e);
  }

  process.exit(exitCode);
}

generateHtmlLintReport().catch((error) => {
  console.error('[ERROR] Error generating HTML lint report:', error);
  process.exit(1);
});
