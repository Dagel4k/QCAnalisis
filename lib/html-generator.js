const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * HTML Generator Class
 * Modern Vercel/Linear-inspired generic dashboard.
 */
class HtmlGenerator {
    constructor(options = {}) {
        this.cwd = options.cwd || process.cwd();
        this.maxVisibleIssues = options.maxVisibleIssues || 500;
        this.collapseByDefault = options.collapseByDefault ?? true;
        this.theme = options.theme || 'dark';
    }

    escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, (m) => map[m]);
    }

    docUrlForRule(ruleId) {
        if (!ruleId) return '';
        try {
            if (ruleId.includes('/')) {
                const [plugin, rule] = ruleId.split('/', 2);
                if (plugin === '@typescript-eslint') return `https://typescript-eslint.io/rules/${rule}/`;
                if (plugin === 'import') return `https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/${rule}.md`;
                if (plugin === 'unicorn') return `https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/${rule}.md`;
                if (plugin === 'sonarjs') return `https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/docs/rules/${rule}.md`;
                return `https://www.google.com/search?q=${encodeURIComponent(ruleId + ' eslint rule')}`;
            }
            return `https://eslint.org/docs/latest/rules/${ruleId}`;
        } catch { return ''; }
    }

    async init() {
        try {
            const searchPaths = [
                this.cwd,
                path.join(this.cwd, 'node_modules'),
                path.join(this.cwd, 'repo-scan-dashboard-main', 'node_modules'),
                path.join(this.cwd, 'node_modules', '@scriptc', 'dev-tools', 'node_modules'),
            ];
            let shikiModule;
            try {
                const resolved = require.resolve('shiki', { paths: searchPaths });
                shikiModule = await import(pathToFileURL(resolved).href);
            } catch {
                shikiModule = await import('shiki');
            }
            this.codeToHtml = shikiModule.codeToHtml;
        } catch (e) {
            console.warn('[HTMLGenerator] Could not load shiki, syntax highlighting will be disabled.', e.message);
            this.codeToHtml = async (code) => this.escapeHtml(code);
        }
    }

    async getCodeSnippet(filePath, line, visibleContext = 2, expandableContext = 10) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            const visibleStart = Math.max(0, line - visibleContext - 1);
            const visibleEnd = Math.min(lines.length, line + visibleContext);

            const expandableStartTop = Math.max(0, line - expandableContext - 1);
            const expandableEndTop = visibleStart;
            const expandableStartBottom = visibleEnd;
            const expandableEndBottom = Math.min(lines.length, line + expandableContext);

            const snippet = { expandableTop: [], visible: [], expandableBottom: [] };

            const highlight = async (txt) => {
                try {
                    // Force dark theme for the new UI
                    const h = await this.codeToHtml(txt, { lang: 'typescript', theme: 'github-dark' });
                    const m = h.match(/<code[^>]*>(.*?)<\/code>/s);
                    return m ? m[1] : this.escapeHtml(txt);
                } catch { return this.escapeHtml(txt); }
            };

            for (let i = expandableStartTop; i < expandableEndTop; i++) {
                snippet.expandableTop.push({ number: i + 1, highlightedContent: await highlight(lines[i] || '') });
            }
            for (let i = visibleStart; i < visibleEnd; i++) {
                snippet.visible.push({
                    number: i + 1,
                    highlightedContent: await highlight(lines[i] || ''),
                    isError: (i + 1) === line
                });
            }
            for (let i = expandableStartBottom; i < expandableEndBottom; i++) {
                snippet.expandableBottom.push({ number: i + 1, highlightedContent: await highlight(lines[i] || '') });
            }
            return snippet;
        } catch {
            return { expandableTop: [], visible: [], expandableBottom: [] };
        }
    }

    buildFileTree(results) {
        const tree = {};
        results.forEach(res => {
            const rel = path.relative(this.cwd, res.filePath);
            const parts = rel.split(path.sep);
            let current = tree;
            parts.forEach((part, idx) => {
                if (!current[part]) {
                    const isFile = idx === parts.length - 1;
                    current[part] = isFile
                        ? { type: 'file', path: rel, errorCount: res.errorCount, warningCount: res.warningCount }
                        : { type: 'folder', children: {}, errorCount: 0, warningCount: 0 };
                }
                if (current[part].type === 'folder') {
                    current[part].errorCount += res.errorCount;
                    current[part].warningCount += res.warningCount;
                    current = current[part].children;
                }
            });
        });
        return tree;
    }

    renderFileTree(tree, level = 0) {
        let html = '';
        const entries = Object.entries(tree).sort(([nA, nAObj], [nB, nBObj]) => {
            if (nAObj.type !== nBObj.type) return nAObj.type === 'folder' ? -1 : 1;
            return nA.localeCompare(nB);
        });

        for (const [name, node] of entries) {
            if (node.type === 'folder') {
                if (node.errorCount === 0 && node.warningCount === 0) continue;
                // Recursively check if folder should be open by default? No, collapse by default to reduce noise as requested.
                html += `
            <div class="tree-folder">
              <div class="tree-row folder-row" onclick="toggleFolder(this)" role="button" tabindex="0" aria-expanded="false" aria-label="Toggle folder ${this.escapeHtml(name)}" style="padding-left: ${12 + (level * 12)}px;">
                <span class="tree-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-folder-closed" /></svg></span>
                <span class="tree-label">${this.escapeHtml(name)}</span>
                ${(node.errorCount + node.warningCount) > 0 ? `<span class="count-badge">${node.errorCount + node.warningCount}</span>` : ''}
              </div>
              <div class="tree-children hidden">
                ${this.renderFileTree(node.children, level + 1)}
              </div>
            </div>`;
            } else {
                const fileId = `file-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
                // Check if has errors to determine color
                const statusClass = node.errorCount > 0 ? 'status-error' : (node.warningCount > 0 ? 'status-warning' : 'status-clean');
                html += `
            <div class="tree-row file-row ${statusClass}" onclick="selectFile('${fileId}')" data-file-id="${fileId}" style="padding-left: ${12 + (level * 12)}px;">
              <span class="tree-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-file" /></svg></span>
              <span class="tree-label">${this.escapeHtml(name)}</span>
              ${node.errorCount > 0 ? `<span class="dot-error"></span>` : (node.warningCount > 0 ? `<span class="dot-warning"></span>` : '')}
            </div>`;
            }
        }
        return html;
    }

    /**
     * Main render function
     */
    async generate(data) {
        const startTime = performance.now();
        try {
            if (!this.codeToHtml) await this.init();

            const { results: eslintResults, summary, tsPrune, jscpd, semgrep, osv, gitleaks, knip, depCruiser } = data;

            // Clone to avoid mutating original if needed, or just extend
            const results = [...eslintResults];

            // Helper to merge findings
            const mergeFindings = (findings, toolPrefix) => {
                if (!findings || !Array.isArray(findings)) return;
                findings.forEach(f => {
                    // Skip findings without a file path
                    if (!f.file) {
                        console.warn(`[HTMLGenerator] Skipping ${toolPrefix} finding without file path:`, f.message || 'No message');
                        return;
                    }

                    const filePath = path.isAbsolute(f.file) ? f.file : path.resolve(this.cwd, f.file);
                    let text = f.message || 'Issue found';
                    // Clean up message if needed

                    let fileResult = results.find(r => r.filePath === filePath);
                    if (!fileResult) {
                        fileResult = { filePath, messages: [], errorCount: 0, warningCount: 0, source: '' };
                        results.push(fileResult);
                    }

                    const ruleSuffix = f.rule ? f.rule : 'issue';
                    const finalRuleId = ruleSuffix.startsWith(toolPrefix) ? ruleSuffix : `${toolPrefix}/${ruleSuffix}`;

                    fileResult.messages.push({
                        ruleId: finalRuleId,
                        message: text,
                        line: f.line || 1,
                        column: f.column || 1,
                        severity: 2 // Default to error
                    });
                    fileResult.errorCount++;
                });
            };

            // Merge all tools
            mergeFindings(semgrep?.findings, 'semgrep');
            mergeFindings(gitleaks?.findings, 'gitleaks');
            mergeFindings(osv?.findings, 'OSV');
            mergeFindings(knip?.findings, 'knip');
            mergeFindings(depCruiser?.findings, 'architecture');
            // JSCPD usually gives a separate struct, but if it has findings we could merge too. 
            // Analyzer doesn't seem to return standard findings for JSCPD, just duplicates array.
            // If we want JSCPD in the list:
            if (jscpd?.duplicates) {
                const getOrCreateFileResult = (fPath) => {
                    let safePath = fPath;
                    if (typeof fPath !== 'string') {
                        if (fPath && fPath.name) safePath = fPath.name;
                        else safePath = String(fPath);
                    }

                    let absPath = path.isAbsolute(safePath) ? safePath : path.resolve(this.cwd, safePath);
                    let res = results.find(r => r.filePath === absPath);
                    if (!res) {
                        res = { filePath: absPath, messages: [], errorCount: 0, warningCount: 0, source: '' };
                        results.push(res);
                    }
                    return res;
                };

                jscpd.duplicates.forEach(d => {
                    const firstFile = d.firstFile;
                    const fileRes = getOrCreateFileResult(firstFile);

                    let secondPath = d.secondFile;
                    if (typeof secondPath !== 'string') {
                        if (secondPath && secondPath.name) secondPath = secondPath.name;
                        else secondPath = String(secondPath);
                    }

                    fileRes.messages.push({
                        ruleId: 'jscpd/duplicate',
                        message: `Duplicate code found in ${path.basename(secondPath)} (${d.lines} lines)`,
                        line: d.firstFileStart || 1,
                        severity: 1,
                        tool: 'JSCPD'
                    });
                    fileRes.warningCount++;

                    const secondFile = d.secondFile;
                    const fileRes2 = getOrCreateFileResult(secondFile);

                    let firstPath = d.firstFile;
                    if (typeof firstPath !== 'string') {
                        if (firstPath && firstPath.name) firstPath = firstPath.name;
                        else firstPath = String(firstPath);
                    }

                    fileRes2.messages.push({
                        ruleId: 'jscpd/duplicate',
                        message: `Duplicate code found in ${path.basename(firstPath)} (${d.lines} lines)`,
                        line: d.secondFileStart || 1,
                        severity: 1,
                        tool: 'JSCPD'
                    });
                    fileRes2.warningCount++;
                });
            }

            const filteredResults = results.filter(r => r.errorCount > 0 || r.warningCount > 0);

            console.log('[HTMLGenerator] Generating highlights for snippets...');
            const resultsWithSnippets = await Promise.all(filteredResults.map(async r => {
                const sortedMsgs = [...r.messages].sort((a, b) => {
                    const sevDiff = (b.severity || 0) - (a.severity || 0);
                    if (sevDiff !== 0) return sevDiff;
                    return (a.line || 0) - (b.line || 0);
                });
                const messagesWithSnippets = await Promise.all(sortedMsgs.slice(0, 50).map(async m => {
                    // Try to get snippet, but don't fail if file doesn't exist (e.g., for Knip findings)
                    let snippet = null;
                    try {
                        snippet = await this.getCodeSnippet(r.filePath, m.line);
                    } catch (err) {
                        // File might not exist or be readable, that's ok for some tools
                        console.warn(`[HTMLGenerator] Could not get snippet for ${r.filePath}:${m.line}`);
                    }
                    return {
                        ...m,
                        snippet
                    };
                }));
                return { ...r, messagesWithSnippets };
            }));

            const fileTree = this.buildFileTree(resultsWithSnippets);
            const fileTreeHtml = this.renderFileTree(fileTree);

            // Rule Stats
            const ruleStats = {};
            results.forEach(res => {
                res.messages.forEach(m => {
                    if (m.ruleId) {
                        if (!ruleStats[m.ruleId]) ruleStats[m.ruleId] = { count: 0, errors: 0, warnings: 0 };
                        ruleStats[m.ruleId].count++;
                        if (m.severity === 2) ruleStats[m.ruleId].errors++; else ruleStats[m.ruleId].warnings++;
                    }
                });
            });
            const sortedRules = Object.entries(ruleStats).sort((a, b) => b[1].count - a[1].count);

            // Prepare JSON data string for client-side interaction
            const clientData = {
                files: resultsWithSnippets.map(res => ({
                    id: `file-${path.relative(this.cwd, res.filePath).replace(/[^a-zA-Z0-9]/g, '-')}`,
                    path: path.relative(this.cwd, res.filePath),
                    errorCount: res.errorCount,
                    warningCount: res.warningCount,
                    issues: res.messagesWithSnippets.map(m => {
                        let tool = 'ESLint';
                        if (m.ruleId) {
                            // Check for prefixed rules first (from merged findings)
                            if (m.ruleId.startsWith('knip/') || m.ruleId === 'knip') tool = 'Knip';
                            else if (m.ruleId.startsWith('gitleaks/') || m.ruleId === 'gitleaks') tool = 'Gitleaks';
                            else if (m.ruleId.startsWith('OSV/') || m.ruleId === 'OSV') tool = 'OSV';
                            else if (m.ruleId.startsWith('architecture/') || m.ruleId === 'architecture') tool = 'Architecture';
                            else if (m.ruleId.startsWith('jscpd/') || m.ruleId === 'jscpd') tool = 'JSCPD';
                            else if (m.ruleId.startsWith('semgrep/') || m.ruleId === 'semgrep' || m.ruleId.includes('security')) tool = 'Semgrep';
                        }
                        return {
                            severity: m.severity === 2 ? 'error' : 'warning',
                            rule: m.ruleId,
                            tool,
                            message: m.message,
                            line: m.line,
                            snippet: m.snippet
                        };
                    })
                }))
            };

            const model = {
                resultsWithSnippets, fileTreeHtml, summary, sortedRules, clientData,
                securityCount: (semgrep?.findings?.length || 0) + (gitleaks?.findings?.length || 0) + results.reduce((a, r) => a + r.messages.filter(m => m.ruleId && m.ruleId.includes('security')).length, 0),
                jscpdCount: jscpd?.count || 0,
                tsPruneCount: tsPrune?.count || 0,
                knipCount: knip?.findings?.length || 0,
                depVulnCount: osv?.findings?.length || 0,
            };

            console.log(`[HTMLGenerator] Generated in ${(performance.now() - startTime).toFixed(2)}ms`);
            return this.renderHtml(model);
        } catch (error) {
            console.error('[HTMLGenerator] Generation failed:', error);
            // Return a simple error page
            return `
            <!DOCTYPE html>
            <html>
            <head><title>Generation Error</title></head>
            <body style="font-family:system-ui; padding:2rem; background:#111; color:#fff;">
                <h1>Report Generation Failed</h1>
                <pre style="color:#f87171; background:#222; padding:1rem; border-radius:8px; overflow:auto;">${this.escapeHtml(error.stack || error.message)}</pre>
            </body>
            </html>`;
        }
    }

    renderHtml(model) {
        const { summary, sortedRules, fileTreeHtml, clientData, securityCount, jscpdCount, tsPruneCount } = model;
        const totalIssues = summary.errors + summary.warnings;

        return `<!DOCTYPE html>
                <html lang="en" class="dark">
                    <head>
                        <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                <title>Code Quality Report</title>
                                <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
                                <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js"></script>
                                <style>
                                    :root {
                                        /* Palette: Zinc/Neutral */
                                        --bg-body: #09090b;
                                        --bg-panel: #18181b;
                                        --bg-header: #09090b80; /* Glass */
                                        --border: #27272a;
                                        --text-main: #e4e4e7;
                                        --text-muted: #a1a1aa;

                                        --accent: #2563eb;
                                        --error: #ef4444;
                                        --warning: #eab308;
                                        --success: #22c55e;

                                        --font-main: 'Inter', -apple-system, system-ui, sans-serif;
                                        --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
                                    }
                                    * {margin:0; padding:0; box-sizing:border-box; }
                                    body {background: var(--bg-body); color: var(--text-main); font-family: var(--font-main); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

                                    /* Utility */
                                    .hidden {display: none !important; }
                                    .flex {display: flex; }
                                    .col {flex-direction: column; }
                                    .items-center {align-items: center; }
                                    .justify-between {justify-content: space-between; }
                                    .gap-2 {gap: 0.5rem; }
                                    .text-sm {font-size: 0.875rem; }
                                    .text-xs {font-size: 0.75rem; }
                                    .font-mono {font-family: var(--font-mono); }
                                    .text-muted {color: var(--text-muted); }
                                    .w-full {width: 100%; }

                                    /* Icon setup */
                                    .icon {width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; }

                                    /* Header */
                                    header {
                                        height: 50px;
                                        border-bottom: 1px solid var(--border);
                                        display: flex; align-items: center; padding: 0 1.5rem;
                                        background: var(--bg-header); backdrop-filter: blur(10px);
                                        position: sticky; top: 0; z-index: 50; 
                                    }
                                    header h1 {font-size: 0.95rem; font-weight: 600; color: var(--text-main); letter-spacing: -0.01em; }
                                    .header-meta {margin-left: auto; font-size: 0.8rem; color: var(--text-muted); }

                                    /* Main Grid */
                                    main {display: grid; grid-template-columns: 280px 1fr 320px; flex: 1; overflow: hidden; }

                                    /* Left: Sidebar (Tree) */
                                    .sidebar-left {background: var(--bg-body); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
                                    .sidebar-header {padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
                                    .tree-container {flex: 1; padding: 0.5rem 0; }

                                    .tree-row {
                                        display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 1rem;
                                        cursor: pointer; font-size: 0.85rem; color: var(--text-muted);
                                        transition: all 0.15s; border-left: 2px solid transparent;
                                    }
                                    .tree-row:hover {background: #27272a50; color: var(--text-main); }
                                    .tree-row.active {background: #2563eb15; color: var(--text-main); border-left-color: var(--accent); }
                                    .tree-label {overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

                                    .folder-row .tree-icon {color: var(--text-muted); opacity: 0.7; }
                                    .count-badge {font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: var(--border); margin-left: auto; }

                                    .dot-error {width: 6px; height: 6px; border-radius: 50%; background: var(--error); margin-left: auto; }
                                    .dot-warning {width: 6px; height: 6px; border-radius: 50%; background: var(--warning); margin-left: auto; }

                                    /* Tool Filters */
                                    .tools-list {padding: 0.5rem 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
                                    .tool-chip {
                                        font-size: 0.7rem; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--border);
                                        color: var(--text-muted); cursor: pointer; transition: all 0.2s;
                                    }
                                    .tool-chip:hover {border-color: var(--text-main); color: var(--text-main); }
                                    .tool-chip.active {background: var(--text-main); color: var(--bg-body); border-color: var(--text-main); font-weight: 600; }

                                    .tool-badge {
                                        font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; background: #3f3f46; color: #d4d4d8; margin-right: 0.5rem;
                                    }

                                    /* Center: Editor Area */
                                    .center-panel {background: #121214; display: flex; flex-direction: column; overflow: hidden; position: relative; }

                                    /* Empty State */
                                    .empty-state {position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-direction: column; gap: 1rem; }
                                    .empty-icon {width: 48px; height: 48px; opacity: 0.2; }

                                    /* Detail View */
                                    .detail-view {display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding-bottom: 3rem; }
                                    .file-toolbar {
                                        padding: 1rem 2rem; border-bottom: 1px solid var(--border);
                                        background: var(--bg-body); position: sticky; top: 0; z-index: 10;
                                        display: flex; align-items: center; justify-content: space-between;
                                    }
                                    .file-path {font-family: var(--font-mono); font-size: 0.9rem; color: var(--text-main); }

                                    .issue-card {
                                        margin: 1.5rem 2rem 0; border: 1px solid var(--border); border-radius: 8px;
                                        background: var(--bg-panel); flex-shrink: 0;
                                    }
                                    .issue-header {
                                        padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.75rem;
                                        border-bottom: 1px solid var(--border); background: #202023; 
                                    }
                                    .badge {
                                        text-transform: uppercase; font-size: 0.7rem; font-weight: 700;
                                        padding: 2px 6px; border-radius: 4px; letter-spacing: 0.02em; 
                                    }
                                    .badge.error {color: var(--error); background: #450a0a; border: 1px solid #7f1d1d; }
                                    .badge.warning {color: var(--warning); background: #422006; border: 1px solid #713f12; }

                                    .issue-rule {font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-left: auto; opacity: 0.8; }
                                    .issue-message {font-size: 0.9rem; font-weight: 500; }

                                    .snippet {
                                        padding: 1rem; background: #0d0d0d; font-family: var(--font-mono); font-size: 0.8rem; overflow-x: auto; 
                                    }
                                    .code-line {display: flex; line-height: 1.6; }
                                    .ln {width: 40px; padding-right: 1rem; text-align: right; color: #52525b; user-select: none; flex-shrink: 0; }
                                    .lc {white-space: pre; color: #d4d4d8; }
                                    .is-error {background: #450a0a30; }
                                    .is-error .ln {color: var(--error); font-weight: bold; }

                                    /* Right: Stats Panel */
                                    .sidebar-right {background: var(--bg-body); border-left: 1px solid var(--border); overflow-y: auto; padding: 1.5rem; }

                                    .stats-grid {display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 2rem; }
                                    .stat-card {
                                        background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
                                        padding: 1rem; display: flex; flex-direction: column; gap: 0.25rem;
                                        cursor: pointer; transition: transform 0.1s;
                                    }
                                    .stat-card:hover {border-color: var(--text-muted); }
                                    .stat-card.active {border-color: var(--text-main); background: #27272a; }
                                    .stat-label {font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
                                    .stat-value {font-size: 1.75rem; font-weight: 700; color: var(--text-main); }

                                    .stat-card.errors .stat-value {color: var(--error); }
                                    .stat-card.warnings .stat-value {color: var(--warning); }

                                    .chart-container {
                                        display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 2rem; 
                                    }
                                    .donut-chart {width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(var(--error) 0% 0%, var(--warning) 0% 100%); mask: radial-gradient(transparent 62%, black 63%); -webkit-mask: radial-gradient(transparent 62%, black 63%); }
                                    .donut-center {position: absolute; text-align: center; }
                                    .donut-total {font-size: 1.5rem; font-weight: 800; line-height: 1; }
                                    .donut-sub {font-size: 0.75rem; color: var(--text-muted); }

                                    .rules-list {display: flex; flex-direction: column; gap: 0.5rem; }
                                    .rule-item {display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
                                    .rule-header {display: flex; justify-content: space-between; font-size: 0.75rem; }
                                    .rule-name {color: var(--text-main); font-family: var(--font-mono); }
                                    .rule-count {color: var(--text-muted); }
                                    .progress-track {height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; width: 100%; }
                                    .progress-fill {height: 100%; background: var(--accent); border-radius: 2px; }

                                    .progress-fill.red {background: var(--error); }
                                    .progress-fill.yellow {background: var(--warning); }
                                    
                                    /* Header Controls */
                                    .header-controls { display: flex; align-items: center; gap: 0.5rem; margin-right: 1rem;}
                                    .search-input {
                                        background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main);
                                        padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; width: 180px;
                                    }
                                    .btn-icon {
                                        background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-muted);
                                        padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
                                        transition: all 0.2s;
                                    }
                                    .btn-icon:hover { color: var(--text-main); border-color: var(--text-muted); background: var(--bg-body); }
                                    .btn-text { font-size: 0.75rem; font-weight: 500; margin-left: 0.25rem; }

                                    /* Summary View */
                                    .summary-view { padding: 2rem; overflow-y: auto; height: 100%; display: none; }
                                    .summary-view.active { display: block; }
                                    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
                                    .summary-card { background: var(--bg-panel); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px; display:flex; flex-direction:column; gap:0.5rem; }
                                    .summary-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; }
                                    .summary-value { font-size: 2rem; font-weight: 700; color: var(--text-main); }

                                    /* Light Theme Overrides */
                                    html.light {
                                        --bg-body: #f8f9fa;
                                        --bg-panel: #ffffff;
                                        --bg-header: #ffffffcc;
                                        --border: #e2e8f0;
                                        --text-main: #1a202c;
                                        --text-muted: #718096;
                                        --accent: #3182ce;
                                    }
                                    html.light .center-panel { background: var(--bg-body); }
                                    
                                    /* Invert dark snippets to make them "light theme" compatible while keeping syntax colors */
                                    html.light .snippet { 
                                        filter: invert(0.93) hue-rotate(180deg);
                                        border: 1px solid var(--border);
                                        background: #0d0d0d; /* Ensure base is dark so it inverts to light */
                                    }
                                    
                                    html.light .issue-header { background: #f7fafc; border-bottom: 1px solid var(--border); }
                                    html.light .issue-card { background: #ffffff; border: 1px solid var(--border); }
                                    html.light .stat-card.active { background: #e2e8f0; border-color: #cbd5e0; }
                                    html.light .progress-track { background: #edf2f7; }

                                    /* Light mode sidebar overrides */
                                    html.light .tree-row:hover { background: rgba(0,0,0,0.05); }
                                    html.light .tree-row.active { background: #e2e8f0; }

                                    @media print {
                                        .sidebar-left, .header-controls, .sidebar-right { display: none !important; }
                                        .center-panel { width: 100% !important; padding: 0 !important; overflow: visible !important; }
                                        .detail-view, .summary-view { overflow: visible !important; height: auto !important; }
                                        body { background: white !important; color: black !important; overflow: visible !important; }
                                        .issue-card { border: 1px solid #ddd !important; break-inside: avoid; }
                                        .snippet { background: #f5f5f5 !important; border: 1px solid #eee !important; color: black !important; }
                                        .code-line .lc { color: black !important; }
                                        ::-webkit-scrollbar { display: none; }
                                    }

                                    /* Print & PDF Export */
                                    @media print {
                                        .sidebar-left, .header-controls, .sidebar-right { display: none !important; }
                                        .center-panel { width: 100% !important; padding: 0 !important; overflow: visible !important; }
                                        .detail-view, .summary-view { overflow: visible !important; height: auto !important; }
                                        body { background: white !important; color: black !important; overflow: visible !important; }
                                        .issue-card { border: 1px solid #ddd !important; break-inside: avoid; }
                                        .snippet { background: #f5f5f5 !important; border: 1px solid #eee !important; color: black !important; }
                                        .code-line .lc { color: black !important; }
                                        ::-webkit-scrollbar { display: none; }
                                    }

                                </style>
                                <!-- Icons -->
                                <svg style="display:none">
                                    <symbol id="icon-folder-closed" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" stroke="currentColor" fill="none" /></symbol>
                                    <symbol id="icon-file" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></symbol>
                                    <symbol id="icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></symbol>
                                    <symbol id="icon-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></symbol>
                                    <symbol id="icon-theme" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></symbol>
                                    <symbol id="icon-chart" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></symbol>
                                    <symbol id="icon-print" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></symbol>
                                    <symbol id="icon-table" viewBox="0 0 24 24"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/></symbol>
                                </svg>
                            </head>
                            <body>

                                <header>
                                    <h1>Lint Report</h1>
                                    <div class="header-controls">
                                        <input type="text" class="search-input" id="search-input" placeholder="Search..." aria-label="Search issues">
                                        <div style="height:20px; border-left:1px solid var(--border); margin:0 4px;"></div>
                                        <button class="btn-icon" onclick="toggleView()" aria-label="Summary View" title="Summary View"><svg class="icon"><use href="#icon-chart"/></svg></button>
                                        <button class="btn-icon" onclick="exportToCSV()" aria-label="Export Excel" title="Export Excel (CSV)"><svg class="icon"><use href="#icon-download"/></svg><span class="btn-text">Excel</span></button>
                                        <button class="btn-icon" onclick="downloadPDF(this)" aria-label="Download PDF" title="Generate PDF"><svg class="icon"><use href="#icon-print"/></svg><span class="btn-text">PDF</span></button>
                                        <div style="height:20px; border-left:1px solid var(--border); margin:0 4px;"></div>
                                        <button class="btn-icon" onclick="toggleTheme()" aria-label="Toggle Theme" title="Toggle Theme"><svg class="icon"><use href="#icon-theme"/></svg></button>
                                    </div>
                                    <div class="header-meta">
                                        ${new Date().toLocaleDateString()} • ${summary.files} Files Scanned
                                    </div>
                                </header>

                                <main>
                                    <!-- LEFT: Filters & File Tree -->
                                    <div class="sidebar-left">
                                        <div class="sidebar-header" style="margin-top:0">Tools</div>
                                        <div class="tools-list" id="tools-list">
                                            <!-- Injected via JS -->
                                        </div>
                                        <div class="sidebar-header">Explorer</div>
                                        <div class="tree-container">
                                            ${fileTreeHtml}
                                        </div>
                                    </div>

                                    <!-- CENTER: Detail View -->
                                    <div class="center-panel" id="center-panel">
                                        <div id="summary-view" class="summary-view">
                                            <!-- Summary Content Injected JS -->
                                            <h2 style="margin-bottom:1.5rem; border-bottom:1px solid var(--border); padding-bottom:1rem;">Executive Summary</h2>
                                            <div class="summary-grid">
                                                <div class="summary-card">
                                                    <span class="summary-label">Total Issues</span>
                                                    <span class="summary-value">${totalIssues}</span>
                                                </div>
                                                <div class="summary-card">
                                                    <span class="summary-label">Errors (Critical)</span>
                                                    <span class="summary-value" style="color:var(--error)">${summary.errors}</span>
                                                </div>
                                                <div class="summary-card">
                                                    <span class="summary-label">Warnings</span>
                                                    <span class="summary-value" style="color:var(--warning)">${summary.warnings}</span>
                                                </div>
                                                <div class="summary-card">
                                                    <span class="summary-label">Files Affected</span>
                                                    <span class="summary-value">${model.resultsWithSnippets.filter(r => r.errorCount > 0 || r.warningCount > 0).length}</span>
                                                </div>
                                            </div>
                                            
                                            <div class="summary-grid">
                                                <div class="summary-card">
                                                    <span class="summary-label">Security Findings</span>
                                                    <span class="summary-value">${securityCount}</span>
                                                </div>
                                                <div class="summary-card">
                                                    <span class="summary-label">Duplications</span>
                                                    <span class="summary-value">${jscpdCount}</span>
                                                </div>
                                            </div>

                                            <h3 style="margin:2rem 0 1rem; color:var(--text-muted); font-size: 0.9rem; text-transform:uppercase;">Top Offending Files</h3>
                                            <div class="rules-list">
                                                ${model.resultsWithSnippets
                .sort((a, b) => b.errorCount - a.errorCount)
                .slice(0, 5)
                .map(r => `
                                                    <div class="rule-item" style="cursor:pointer;" onclick="selectFile('file-${path.relative(this.cwd, r.filePath).replace(/[^a-zA-Z0-9]/g, '-')}')">
                                                        <div class="rule-header">
                                                            <span class="rule-name" style="font-family:monospace">${path.relative(this.cwd, r.filePath)}</span>
                                                            <span class="rule-count" style="color:var(--error)">${r.errorCount} Errors</span>
                                                        </div>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        </div>

                                        <div class="empty-state" id="empty-state">
                                            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                                            <p>Select a file to view details</p>
                                        </div>
                                    </div>

                                    <!-- RIGHT: Stats -->
                                    <div class="sidebar-right">
                                        <div class="chart-container">
                                            <div class="donut-chart" style="background: conic-gradient(var(--error) 0% ${(summary.errors / totalIssues) * 100}%, var(--warning) ${(summary.errors / totalIssues) * 100}% 100%)"></div>
                                            <div class="donut-center">
                                                <div class="donut-total">${totalIssues}</div>
                                                <div class="donut-sub">Issues</div>
                                            </div>
                                        </div>

                                        <div class="stats-grid">
                                            <div class="stat-card errors active" onclick="filterBySeverity('error')">
                                                <div class="stat-label">Errors</div>
                                                <div class="stat-value">${summary.errors}</div>
                                            </div>
                                            <div class="stat-card warnings" onclick="filterBySeverity('warning')">
                                                <div class="stat-label">Warnings</div>
                                                <div class="stat-value">${summary.warnings}</div>
                                            </div>
                                            <div class="stat-card unused" onclick="selectTool('ts-prune')">
                                                <div class="stat-label">Unused Exports</div>
                                                <div class="stat-value">${tsPruneCount}</div>
                                            </div>
                                            <div class="stat-card duplicates" onclick="selectTool('JSCPD')">
                                                <div class="stat-label">Duplicates</div>
                                                <div class="stat-value">${jscpdCount}</div>
                                            </div>
                                            <div class="stat-card knip" onclick="selectTool('Knip')">
                                                <div class="stat-label">Knip (Deep Unused)</div>
                                                <div class="stat-value">${model.knipCount}</div>
                                            </div>
                                            <div class="stat-card security" onclick="selectTool('Security')"> 
                                                <div class="stat-label">Security</div>
                                                <div class="stat-value">${securityCount}</div>
                                            </div>
                                        </div>

                                        <div class="sidebar-header" style="margin: 1.5rem 0 1rem;">Top Rules</div>

                                        <div class="rules-list">
                                            ${sortedRules.slice(0, 15).map(([rule, stats]) => {
                    const percent = Math.min(100, (stats.count / totalIssues) * 100);
                    const colorClass = stats.errors > 0 ? 'red' : 'yellow';
                    return `
                    <div class="rule-item">
                        <div class="rule-header">
                            <span class="rule-name">${rule}</span>
                            <span class="rule-count">${stats.count}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill ${colorClass}" style="width: ${percent}%"></div>
                        </div>
                    </div>`;
                }).join('')}
                                        </div>
                                    </div>
                                </main>

                                <script>
                                    const DATA = ${JSON.stringify(clientData)};
                                    let currentFilter = {tool: null, severity: null, fileId: null, search: '' };

                                    // Initialize Tools
                                    const allTools = new Set();
        DATA.files.forEach(f => f.issues.forEach(i => allTools.add(i.tool)));
                                    const toolsContainer = document.getElementById('tools-list');

                                    const allChip = document.createElement('div');
                                    allChip.className = 'tool-chip active';
                                    allChip.textContent = 'All';
        allChip.onclick = () => selectTool(null);
                                    toolsContainer.appendChild(allChip);

        Array.from(allTools).sort().forEach(tool => {
            const chip = document.createElement('div');
                                    chip.className = 'tool-chip';
                                    chip.textContent = tool;
            chip.onclick = () => selectTool(tool);
                                    toolsContainer.appendChild(chip);
        });

                                    // Theme Init
                                    if (localStorage.getItem('theme') === 'light') {
                                        document.documentElement.classList.remove('dark');
                                        document.documentElement.classList.add('light');
                                    }

                                    // Search Listener
                                    document.getElementById('search-input').addEventListener('input', (e) => {
                                        currentFilter.search = e.target.value.toLowerCase();
                                        render();
                                    });

                                    // Initial Render
                                    render();
                                    updateSidebar();

                                    function toggleTheme() {
                                        const html = document.documentElement;
                                        if (html.classList.contains('dark')) {
                                            html.classList.remove('dark');
                                            html.classList.add('light');
                                            localStorage.setItem('theme', 'light');
                                        } else {
                                            html.classList.remove('light');
                                            html.classList.add('dark');
                                            localStorage.setItem('theme', 'dark');
                                        }
                                    }

                                    function toggleView() {
                                        const summary = document.getElementById('summary-view');
                                        const wasActive = summary.classList.contains('active');
                                        
                                        if (wasActive) {
                                            summary.classList.remove('active');
                                            render(); // Restore correct detail state
                                        } else {
                                            summary.classList.add('active');
                                            document.getElementById('detail-view-container')?.classList.add('hidden');
                                            document.getElementById('empty-state')?.classList.add('hidden');
                                        }
                                    }

                                    function exportToCSV() {
                                        const issues = getFilteredIssues();
                                        if (!issues.length) return alert('No issues to export');
                                        
                                        const headers = ['File', 'Tool', 'Rule', 'Severity', 'Line', 'Message', 'Code Snippet'];
                                        const csvContent = [
                                            headers.join(','),
                                            ...issues.map(i => {
                                                // Extract code snippet text
                                                let snippetText = '';
                                                if (i.snippet && i.snippet.visible && Array.isArray(i.snippet.visible)) {
                                                    snippetText = i.snippet.visible
                                                        .map(line => 'L' + line.number + ': ' + stripHtml(line.highlightedContent || ''))
                                                        .join(' | ');
                                                }
                                                
                                                const row = [
                                                    escapeCsvField(i.path),
                                                    escapeCsvField(i.tool),
                                                    escapeCsvField(i.rule || ''),
                                                    escapeCsvField(i.severity),
                                                    i.line || '',
                                                    escapeCsvField(i.message || ''),
                                                    escapeCsvField(snippetText)
                                                ];
                                                return row.join(',');
                                            })
                                        ].join('\\n');

                                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = 'lint-report.csv';
                                        a.click();
                                        window.URL.revokeObjectURL(url);
                                    }

                                    function escapeCsvField(field) {
                                        const str = String(field || '');
                                        // Escape double quotes and wrap in quotes if contains comma, newline, or quotes
                                        if (str.includes(',') || str.includes('\\n') || str.includes('"')) {
                                            return '"' + str.replace(/"/g, '""') + '"';
                                        }
                                        return str;
                                    }

                                    function stripHtml(html) {
                                        const tmp = document.createElement('div');
                                        tmp.innerHTML = html;
                                        return tmp.textContent || tmp.innerText || '';
                                    }

                                    function getFilteredIssues() {
                                        let issues = [];
                                        
                                        // 1. Gather relevant issues based on File Scope
                                        if (currentFilter.fileId) {
                                            const fileData = DATA.files.find(f => f.id === currentFilter.fileId);
                                            if (fileData) {
                                                issues = fileData.issues.map(i => ({...i, path: fileData.path}));
                                            }
                                        } else {
                                            // Global scope
                                            DATA.files.forEach(f => {
                                                f.issues.forEach(i => {
                                                    issues.push({ ...i, path: f.path });
                                                });
                                            });
                                        }

                                        // 2. Apply Tool Filter
                                        if (currentFilter.tool) {
                                            if (currentFilter.tool === 'Security') {
                                                issues = issues.filter(i => ['Semgrep','Gitleaks','OSV'].includes(i.tool) || (i.rule && i.rule.toLowerCase().includes('security')));
                                            } else {
                                                issues = issues.filter(i => i.tool === currentFilter.tool);
                                            }
                                        }

                                        // 3. Apply Severity Filter
                                        if (currentFilter.severity) {
                                            issues = issues.filter(i => i.severity === currentFilter.severity);
                                        }

                                        // 4. Apply Text Search
                                        if (currentFilter.search) {
                                            const term = currentFilter.search;
                                            issues = issues.filter(i => 
                                                (i.message && i.message.toLowerCase().includes(term)) || 
                                                (i.rule && i.rule.toLowerCase().includes(term)) ||
                                                (i.path && i.path.toLowerCase().includes(term))
                                            );
                                        }

                                        return issues;
                                    }

                                    function selectTool(tool) {
                                        // If clicking the same tool tile, toggle it off (set to null)
                                        if (currentFilter.tool === tool) {
                                            currentFilter.tool = null;
                                        } else {
                                            currentFilter.tool = tool;
                                        }
                                        updateUI();
                                        render();
                                        updateSidebar();
                                    }

                                    function filterBySeverity(sev) {
                                        currentFilter.severity = currentFilter.severity === sev ? null : sev; // toggle
                                        updateUI();
                                        render();
                                        updateSidebar();
                                    }

                                    function clearFilters() {
                                        currentFilter = { tool: null, severity: null, fileId: null };
                                        updateUI();
                                        render();
                                        updateSidebar();
                                    }

                                    function updateUI() {
                                        // Update Tool Chips
                                        const chips = document.querySelectorAll('.tool-chip');
                                        chips.forEach(c => {
                                            if (c.textContent === 'All' && !currentFilter.tool) c.classList.add('active');
                                            else if (c.textContent === currentFilter.tool) c.classList.add('active');
                                            else c.classList.remove('active');
                                        });

                                        // Update Stat Cards (active state)
                                        document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
                                        
                                        if (currentFilter.severity === 'error') document.querySelector('.stat-card.errors')?.classList.add('active');
                                        if (currentFilter.severity === 'warning') document.querySelector('.stat-card.warnings')?.classList.add('active');
                                        
                                        if (currentFilter.tool === 'JSCPD') document.querySelector('.stat-card.duplicates')?.classList.add('active');
                                        if (currentFilter.tool === 'Knip') document.querySelector('.stat-card.knip')?.classList.add('active');
                                        if (currentFilter.tool === 'Security') document.querySelector('.stat-card.security')?.classList.add('active');
                                        if (currentFilter.tool === 'ts-prune') document.querySelector('.stat-card.unused')?.classList.add('active');

                                        // Update Tree Highlight
                                        document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
                                        if (currentFilter.fileId) {
                                            const row = document.querySelector(\`[data-file-id="\${currentFilter.fileId}"]\`);
                                            if(row) row.classList.add('active');
                                        }
                                    }

                                    function toggleFolder(el) {
                                        const children = el.nextElementSibling;
                                        children.classList.toggle('hidden');
                                        const icon = el.querySelector('svg');
                                        icon.style.opacity = children.classList.contains('hidden') ? '0.7' : '1';
                                    }

                                    function selectFile(fileId) {
                                        currentFilter.fileId = fileId;
                                        updateUI();
                                        render();
                                        updateSidebar();
                                    }

                                    function backToDashboard() {
                                        currentFilter.fileId = null;
                                        updateUI();
                                        render();
                                        updateSidebar();
                                    }

                                    function render() {
                                        const container = document.getElementById('center-panel');
                                        const issues = getFilteredIssues();

                                        const summaryViewActive = document.getElementById('summary-view').classList.contains('active');
                                        const detailViewClass = summaryViewActive ? 'detail-view hidden' : 'detail-view';
                                        
                                        // Sort issues:
                                        // 1. Security (Semgrep, Gitleaks, OSV, or rule includes "security")
                                        // 2. Severity (Error > Warning)
                                        // 3. File Path
                                        // 4. Line Number
                                        const isSecurity = (i) => ['Semgrep', 'Gitleaks', 'OSV', 'Horusec'].includes(i.tool) || (i.rule && i.rule.toLowerCase().includes('security'));

                                        issues.sort((a, b) => {
                                            const secA = isSecurity(a);
                                            const secB = isSecurity(b);
                                            if (secA && !secB) return -1;
                                            if (!secA && secB) return 1;

                                            // If both are security or both are not, check severity
                                            const score = { 'error': 2, 'warning': 1, 'info': 0 };
                                            const scoreA = score[a.severity] || 0;
                                            const scoreB = score[b.severity] || 0;
                                            if (scoreA !== scoreB) return scoreB - scoreA; // High score first

                                            // Then file path (Global view needs path sort)
                                            if (a.path < b.path) return -1;
                                            if (a.path > b.path) return 1;

                                            // Then line number
                                            return (a.line || 0) - (b.line || 0);
                                        });

                                        const displayIssues = issues.slice(0, 500);
                                        const remaining = Math.max(0, issues.length - 500);

                                        let toolbarHtml = '';
                                        if (currentFilter.fileId) {
                                            const fileData = DATA.files.find(f => f.id === currentFilter.fileId);
                                            toolbarHtml = \`
                                                <div class="file-toolbar">
                                                    <div style="display:flex; align-items:center; gap:1rem;">
                                                        <button onclick="backToDashboard()" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem;">← Back</button>
                                                        <div class="file-path">\${fileData ? fileData.path : 'Unknown File'}</div>
                                                    </div>
                                                    <div class="file-meta">
                                                        \${issues.length} Issues
                                                    </div>
                                                </div>
                                            \`;
                                        } else {
                                            toolbarHtml = \`
                                                <div class="file-toolbar">
                                                    <div class="file-path">
                                                        \${currentFilter.tool ? currentFilter.tool : 'All Tools'}
                                                        \${currentFilter.severity ? '(' + currentFilter.severity + ')' : ''}
                                                    </div>
                                                    <div class="file-meta">
                                                        \${issues.length} Total Issues \${remaining > 0 ? '(Showing first 500)' : ''}
                                                    </div>
                                                </div>
                                            \`;
                                        }

                                        // We need to preserve the summary view if it exists
                                        const summaryViewHtml = document.getElementById('summary-view')?.outerHTML || '';
                                        
                                        // But wait, re-rendering entirely destroys the summary view state if we overwrite innerHTML.
                                        // Instead of wiping innerHTML, we should target the detail-view container specifically if it exists, or re-create structure.
                                        // OR, simpler: just toggle the hidden class on the existing detail view if it exists.
                                        // Actually, simpler to just re-render everything since render is fast enough.
                                        // The 'summaryViewHtml' is static (injected server-side mostly + maybe some JS updates). 
                                        // Wait, the summary view data IS static from server render in my current implementation (lines 620-667). 
                                        // So I don't need to preserve it from DOM, I need to make sure I don't DELETE it when I render the list.
                                        // The 'center-panel' contains 'summary-view' AND 'detail-view' (or empty state).
                                        // My previous 'render' overwrote 'center-panel' innerHTML completely! That DELETED the summary view!
                                        // AHH! That explains why the summary view button did nothing - the summary view element was GONE after the first render().
                                        
                                        // FIX: Create/Update 'detail-view' separately from 'summary-view'.
                                        
                                        let detailView = document.getElementById('detail-view-container');
                                        if (!detailView) {
                                            // Initial setup if not present (should generally be present if I change HTML structure)
                                            // But wait, in the server-side HTML (lines 619+), I set up 'center-panel' > 'summary-view' + 'empty-state'.
                                            // 'render' was overwriting ALL of 'center-panel'.
                                            
                                            // I should modify 'render' to only update the detail view part.
                                            
                                            // Create detail view container if missing
                                            const div = document.createElement('div');
                                            div.id = 'detail-view-container';
                                            div.className = detailViewClass;
                                            container.appendChild(div);
                                            detailView = div;
                                        } else {
                                            detailView.className = detailViewClass;
                                        }
                                        
                                        // Ensure empty state is handled
                                        const emptyState = document.getElementById('empty-state');
                                        if (emptyState) {
                                            if (summaryViewActive) {
                                                // If summary is active, EVERYTHING else in center should be hidden
                                                emptyState.classList.add('hidden');
                                                if(detailView) detailView.classList.add('hidden');
                                            } else if (issues.length === 0 && !currentFilter.fileId && !currentFilter.tool && !currentFilter.search) {
                                                emptyState.classList.remove('hidden');
                                                if(detailView) detailView.classList.add('hidden');
                                            } else {
                                                emptyState.classList.add('hidden');
                                                if(detailView && !summaryViewActive) detailView.classList.remove('hidden');
                                            }
                                        }

                                        detailView.innerHTML = \`
                                            \${toolbarHtml}
                                            \${displayIssues.length > 0 
                                                ? displayIssues.map(i => renderIssue(i, !currentFilter.fileId)).join('')
                                                : '<div style="padding:4rem; text-align:center; color:var(--text-muted)">No issues found matching current filters.</div>'
                                            }
                                            \${remaining > 0 ?\`<div style="padding:2rem; text-align:center; color:#666">... and \${remaining} more issues</div>\` : ''}
                                        \`;
                                    }

                                    function updateSidebar() {
                                        // 1. Calculate Scope Issues (File + Tool, ignoring Severity)
                                        // This determines the counts for the Cards and Donut
                                        let scopeIssues = [];
                                        if (currentFilter.fileId) {
                                            const fileData = DATA.files.find(f => f.id === currentFilter.fileId);
                                            if (fileData) {
                                                scopeIssues = fileData.issues.map(i => ({...i, path: fileData.path}));
                                            }
                                        } else {
                                            DATA.files.forEach(f => {
                                                f.issues.forEach(i => {
                                                    scopeIssues.push({ ...i, path: f.path });
                                                });
                                            });
                                        }

                                        // Apply Tool filter ONLY for the Donut and Severity Cards (to reflect "Errors in Knip" etc)
                                        // But for the specific Tool Cards (Knip, Duplicates), we want the count regarding the FILE SCOPE, not filtered by "Knip" itself
                                        // Wait, "Errors" card changes with Tool filter? Yes.
                                        // But "Knip" card should probably NOT be filtered by "JSCPD" tool selection, otherwise it would go zero when JSCPD is selected.
                                        // The "Facet" cards typically show the count available *if you were to click them*.
                                        // So they should be based on 'scopeIssues' (File scope) but *ignoring* the current tool filter.
                                        
                                        const fileScopeIssues = [...scopeIssues]; 
                                        
                                        // 2. Facets (Cards & Donut) - ALWAYS reflect the full "File/Global Scope"
                                        // They should NOT change when a Tool or Severity filter is applied within that scope.
                                        // This allows the user to see "Total Errors" in the file even if they are currently looking at "JSCPD" issues.
                                        
                                        const totalIssues = fileScopeIssues.length;
                                        const errorCount = fileScopeIssues.filter(i => i.severity === 'error').length;
                                        const warningCount = fileScopeIssues.filter(i => i.severity === 'warning').length;

                                        // Update Donut Chart (Total Composition)
                                        const donutChart = document.querySelector('.donut-chart');
                                        const errorPercent = totalIssues > 0 ? (errorCount / totalIssues) * 100 : 0;
                                        if (donutChart) {
                                            donutChart.style.background = 'conic-gradient(var(--error) 0% ' + errorPercent + '%, var(--warning) ' + errorPercent + '% 100%)';
                                        }
                                        const donutTotal = document.querySelector('.donut-total');
                                        if (donutTotal) donutTotal.textContent = totalIssues;

                                        // Update Error/Warning Cards
                                        const errorCard = document.querySelector('.stat-card.errors .stat-value');
                                        const warningCard = document.querySelector('.stat-card.warnings .stat-value');
                                        if (errorCard) errorCard.textContent = errorCount;
                                        if (warningCard) warningCard.textContent = warningCount;

                                        // Update Tool-Specific Cards (Facets)
                                        const knipItems = fileScopeIssues.filter(i => i.tool === 'Knip');
                                        const dupItems = fileScopeIssues.filter(i => i.tool === 'JSCPD');
                                        const unusedItems = fileScopeIssues.filter(i => i.tool === 'ts-prune');
                                        const secItems = fileScopeIssues.filter(i => ['Semgrep','Gitleaks','OSV'].includes(i.tool) || (i.rule && i.rule.toLowerCase().includes('security')));

                                        const knipCard = document.querySelector('.stat-card.knip .stat-value');
                                        const dupCard = document.querySelector('.stat-card.duplicates .stat-value');
                                        const unusedCard = document.querySelector('.stat-card.unused .stat-value');
                                        const secCard = document.querySelector('.stat-card.security .stat-value');

                                        if (knipCard) knipCard.textContent = knipItems.length;
                                        if (dupCard) dupCard.textContent = dupItems.length;
                                        if (unusedCard) unusedCard.textContent = unusedItems.length;
                                        if (secCard) secCard.textContent = secItems.length;

                                        // 2. Calculate Visible Rules (File + Tool + Severity)
                                        const visibleIssues = getFilteredIssues();
                                        
                                        const ruleStats = {};
                                        visibleIssues.forEach(issue => {
                                            if (issue.rule) {
                                                if (!ruleStats[issue.rule]) {
                                                    ruleStats[issue.rule] = { count: 0, errors: 0, warnings: 0 };
                                                }
                                                ruleStats[issue.rule].count++;
                                                if (issue.severity === 'error') {
                                                    ruleStats[issue.rule].errors++;
                                                } else {
                                                    ruleStats[issue.rule].warnings++;
                                                }
                                            }
                                        });

                                        const sortedRules = Object.entries(ruleStats).sort((a, b) => b[1].count - a[1].count);

                                        // Update top rules list
                                        const rulesList = document.querySelector('.rules-list');
                                        if (rulesList) {
                                            rulesList.innerHTML = sortedRules.slice(0, 15).map(([rule, stats]) => {
                                                // Percent here should be relative to VISIBLE issues
                                                const totalVisible = visibleIssues.length;
                                                const percent = totalVisible > 0 ? Math.min(100, (stats.count / totalVisible) * 100) : 0;
                                                const colorClass = stats.errors > 0 ? 'red' : 'yellow';
                                                return '<div class="rule-item"><div class="rule-header"><span class="rule-name">' + rule + '</span><span class="rule-count">' + stats.count + '</span></div><div class="progress-track"><div class="progress-fill ' + colorClass + '" style="width: ' + percent + '%"></div></div></div>';
                                            }).join('');
                                        }
                                    }

                                    function renderIssue(issue, showPath = false) {
                                        return \`
                                    <div class="issue-card">
                                        <div class="issue-header">
                                            <span class="badge \${issue.severity}">\${issue.severity}</span>
                                            \${showPath ?\`<span style="font-size:0.75rem; color:#a1a1aa; margin-right:0.5rem; font-family:monospace">\${issue.path}</span>\` : ''}
                                            <span class="tool-badge">\${issue.tool}</span>
                                            <span class="issue-message">\${escapeHtml(issue.message)}</span>
                                            <span class="issue-rule">\${issue.rule}</span>
                                        </div>
                                        <div class="snippet">
                                            \${renderSnippet(issue.snippet)}
                                        </div>
                                    </div>
                                    \`;
                                    }

        function renderSnippet(snippet) {
            if (!snippet || !snippet.visible || !Array.isArray(snippet.visible)) {
                return '<div class="code-line"><span class="lc" style="opacity:0.5; font-style:italic">No snippet available</span></div>';
            }
            const lines = snippet.visible.map(l => {
                const lineNum = l.number || '';
                const content = l.highlightedContent || '';
                const errorClass = l.isError ? 'is-error' : '';
                return '<div class="code-line ' + errorClass + '"><span class="ln">' + lineNum + '</span><span class="lc">' + content + '</span></div>';
            }).join('');
            return lines || '<div class="code-line"><span class="lc">Empty snippet</span></div>';
        }

                                    function stripHtml(html) {
                                       let tmp = document.createElement("DIV");
                                       tmp.innerHTML = html;
                                       return tmp.textContent || tmp.innerText || "";
                                    }

                                    function downloadPDF(btn) {
                                        const issues = getFilteredIssues();
                                        if (!issues.length) {
                                            alert('No issues to export to PDF');
                                            return;
                                        }
                                        
                                        const originalContent = btn.innerHTML;
                                        btn.innerHTML = '<span class="btn-text">Generating...</span>';
                                        btn.disabled = true;

                                        try {
                                            const { jsPDF } = window.jspdf;
                                            const doc = new jsPDF();

                                            // Header
                                            doc.setFontSize(18);
                                            doc.text("Code Quality Report", 14, 20);
                                            
                                            doc.setFontSize(10);
                                            doc.setTextColor(100);
                                            doc.text("Generated: " + new Date().toLocaleString(), 14, 28);
                                            doc.text("Total Issues: " + issues.length + " | Scope: " + (currentFilter.tool || "All Tools"), 14, 33);

                                            // Prepare Data for Table
                                            const tableBody = issues.map(function(issue) {
                                                // Prepare Snippet Text (clean HTML tags)
                                                let snippetText = "";
                                                if (issue.snippet && issue.snippet.visible) {
                                                    snippetText = issue.snippet.visible
                                                        .map(function(l) { return (l.number || "  ") + "  " + stripHtml(l.highlightedContent); })
                                                        .join("\\n");
                                                }
                                                
                                                // Combine Message + Snippet
                                                const content = issue.message + (snippetText ? "\\n\\n" + snippetText : "");

                                                return [
                                                    issue.severity.toUpperCase(),
                                                    issue.path + (issue.line ? ":" + issue.line : ""),
                                                    issue.rule || "-",
                                                    content
                                                ];
                                            });

                                            // Generate Table
                                            doc.autoTable({
                                                startY: 40,
                                                head: [['Severity', 'Location', 'Rule', 'Message & Code']],
                                                body: tableBody,
                                                theme: 'grid',
                                                headStyles: { fillColor: [24, 24, 27], textColor: 255, fontStyle: 'bold' },
                                                styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
                                                columnStyles: {
                                                    0: { cellWidth: 20, fontStyle: 'bold' },
                                                    1: { cellWidth: 50 },
                                                    2: { cellWidth: 40 },
                                                    3: { cellWidth: 'auto', font: 'courier' } // Monospace for code
                                                },
                                                didParseCell: function(data) {
                                                    // Colorize Severity
                                                    if (data.column.index === 0 && data.section === 'body') {
                                                        const sev = data.cell.raw;
                                                        if (sev === 'ERROR') data.cell.styles.textColor = [220, 38, 38]; // Red
                                                        if (sev === 'WARNING') data.cell.styles.textColor = [202, 138, 4]; // Yellow
                                                    }
                                                }
                                            });

                                            doc.save('lint-report.pdf');

                                        } catch (e) {
                                            console.error(e);
                                            alert('Error generating PDF: ' + e.message);
                                        } finally {
                                            btn.innerHTML = originalContent;
                                            btn.disabled = false;
                                        }
                                    }

                                    function escapeHtml(text) {
             const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
                                    return String(text).replace(/[&<>"']/g, (m) => map[m]);
        }
                                    </script>
                            </body>
                        </html>`;
    }
}

module.exports = { HtmlGenerator };
