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
              <div class="tree-row folder-row" onclick="toggleFolder(this)" style="padding-left: ${12 + (level * 12)}px;">
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
        if (!this.codeToHtml) await this.init();

        const { results, summary, tsPrune, jscpd, semgrep, osv, gitleaks } = data;
        const filteredResults = results.filter(r => r.errorCount > 0 || r.warningCount > 0);

        console.log('[HTMLGenerator] Generating highlights for snippets...');
        const resultsWithSnippets = await Promise.all(filteredResults.map(async r => {
            const sortedMsgs = [...r.messages].sort((a, b) => {
                const sevDiff = (b.severity || 0) - (a.severity || 0);
                if (sevDiff !== 0) return sevDiff;
                return (a.line || 0) - (b.line || 0);
            });
            const messagesWithSnippets = await Promise.all(sortedMsgs.slice(0, 50).map(async m => ({
                ...m,
                snippet: await this.getCodeSnippet(r.filePath, m.line)
            })));
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
                issues: res.messagesWithSnippets.map(m => ({
                    severity: m.severity === 2 ? 'error' : 'warning',
                    rule: m.ruleId,
                    message: m.message,
                    line: m.line,
                    snippet: m.snippet
                }))
            }))
        };

        const model = {
            resultsWithSnippets, fileTreeHtml, summary, sortedRules, clientData,
            securityCount: (semgrep?.length || 0) + (gitleaks?.length || 0) + results.reduce((a, r) => a + r.messages.filter(m => m.ruleId && m.ruleId.includes('security')).length, 0),
            jscpdCount: jscpd?.count || 0,
            tsPruneCount: tsPrune?.count || 0,
            depVulnCount: osv?.length || 0,
        };

        return this.renderHtml(model);
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
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background: var(--bg-body); color: var(--text-main); font-family: var(--font-main); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        
        /* Utility */
        .hidden { display: none !important; }
        .flex { display: flex; }
        .col { flex-direction: column; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .gap-2 { gap: 0.5rem; }
        .text-sm { font-size: 0.875rem; }
        .text-xs { font-size: 0.75rem; }
        .font-mono { font-family: var(--font-mono); }
        .text-muted { color: var(--text-muted); }
        .w-full { width: 100%; }

        /* Icon setup */
        .icon { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; }

        /* Header */
        header { 
            height: 50px; 
            border-bottom: 1px solid var(--border); 
            display: flex; align-items: center; padding: 0 1.5rem; 
            background: var(--bg-header); backdrop-filter: blur(10px); 
            position: sticky; top: 0; z-index: 50; 
        }
        header h1 { font-size: 0.95rem; font-weight: 600; color: var(--text-main); letter-spacing: -0.01em; }
        .header-meta { margin-left: auto; font-size: 0.8rem; color: var(--text-muted); }

        /* Main Grid */
        main { display: grid; grid-template-columns: 280px 1fr 320px; flex: 1; overflow: hidden; }
        
        /* Left: Sidebar (Tree) */
        .sidebar-left { background: var(--bg-body); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
        .sidebar-header { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
        .tree-container { flex: 1; padding: 0.5rem 0; }
        
        .tree-row { 
            display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 1rem; 
            cursor: pointer; font-size: 0.85rem; color: var(--text-muted);
            transition: all 0.15s; border-left: 2px solid transparent;
        }
        .tree-row:hover { background: #27272a50; color: var(--text-main); }
        .tree-row.active { background: #2563eb15; color: var(--text-main); border-left-color: var(--accent); }
        .tree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        
        .folder-row .tree-icon { color: var(--text-muted); opacity: 0.7; }
        .count-badge { font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: var(--border); margin-left: auto; }
        
        .dot-error { width: 6px; height: 6px; border-radius: 50%; background: var(--error); margin-left: auto; }
        .dot-warning { width: 6px; height: 6px; border-radius: 50%; background: var(--warning); margin-left: auto; }

        /* Center: Editor Area */
        .center-panel { background: #121214; display: flex; flex-direction: column; overflow: hidden; position: relative; }
        
        /* Empty State */
        .empty-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-direction: column; gap: 1rem; }
        .empty-icon { width: 48px; height: 48px; opacity: 0.2; }
        
        /* Detail View */
        .detail-view { display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding-bottom: 3rem; }
        .file-toolbar { 
            padding: 1rem 2rem; border-bottom: 1px solid var(--border); 
            background: var(--bg-body); position: sticky; top: 0; z-index: 10; 
            display: flex; align-items: center; justify-content: space-between;
        }
        .file-path { font-family: var(--font-mono); font-size: 0.9rem; color: var(--text-main); }
        
        .issue-card { 
            margin: 1.5rem 2rem 0; border: 1px solid var(--border); border-radius: 8px; 
            background: var(--bg-panel); overflow: hidden; 
        }
        .issue-header { 
            padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.75rem; 
            border-bottom: 1px solid var(--border); background: #202023; 
        }
        .badge { 
            text-transform: uppercase; font-size: 0.7rem; font-weight: 700; 
            padding: 2px 6px; border-radius: 4px; letter-spacing: 0.02em; 
        }
        .badge.error { color: var(--error); background: #450a0a; border: 1px solid #7f1d1d; }
        .badge.warning { color: var(--warning); background: #422006; border: 1px solid #713f12; }
        
        .issue-rule { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-left: auto; opacity: 0.8; }
        .issue-message { font-size: 0.9rem; font-weight: 500; }
        
        .snippet { 
            padding: 1rem; background: #0d0d0d; font-family: var(--font-mono); font-size: 0.8rem; overflow-x: auto; 
        }
        .code-line { display: flex; line-height: 1.6; }
        .ln { width: 40px; padding-right: 1rem; text-align: right; color: #52525b; select-none: none; flex-shrink: 0; }
        .lc { white-space: pre; color: #d4d4d8; }
        .is-error { background: #450a0a30; }
        .is-error .ln { color: var(--error); font-weight: bold; }
        
        /* Right: Stats Panel */
        .sidebar-right { background: var(--bg-body); border-left: 1px solid var(--border); overflow-y: auto; padding: 1.5rem; }
        
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 2rem; }
        .stat-card { 
            background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; 
            padding: 1rem; display: flex; flex-direction: column; gap: 0.25rem; 
            cursor: pointer; transition: transform 0.1s;
        }
        .stat-card:hover { border-color: var(--text-muted); }
        .stat-card.active { border-color: var(--text-main); background: #27272a; }
        .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
        .stat-value { font-size: 1.75rem; font-weight: 700; color: var(--text-main); }
        
        .stat-card.errors .stat-value { color: var(--error); }
        .stat-card.warnings .stat-value { color: var(--warning); }
        
        .chart-container { 
            display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 2rem; 
        }
        .donut-chart { width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(var(--error) 0% 0%, var(--warning) 0% 100%); mask: radial-gradient(transparent 62%, black 63%); -webkit-mask: radial-gradient(transparent 62%, black 63%); }
        .donut-center { position: absolute; text-align: center; }
        .donut-total { font-size: 1.5rem; font-weight: 800; line-height: 1; }
        .donut-sub { font-size: 0.75rem; color: var(--text-muted); }
        
        .rules-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .rule-item { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
        .rule-header { display: flex; justify-content: space-between; font-size: 0.75rem; }
        .rule-name { color: var(--text-main); font-family: var(--font-mono); }
        .rule-count { color: var(--text-muted); }
        .progress-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; width: 100%; }
        .progress-fill { height: 100%; background: var(--accent); border-radius: 2px; }
        
        .progress-fill.red { background: var(--error); }
        .progress-fill.yellow { background: var(--warning); }

    </style>
    <!-- Icons -->
    <svg style="display:none">
        <symbol id="icon-folder-closed" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" stroke="currentColor" fill="none"/></symbol>
        <symbol id="icon-file" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></symbol>
    </svg>
</head>
<body>

    <header>
        <h1>Lint Report</h1>
        <div class="header-meta">
            ${new Date().toLocaleDateString()} • ${summary.files} Files Scanned
        </div>
    </header>

    <main>
        <!-- LEFT: File Tree -->
        <div class="sidebar-left">
            <div class="sidebar-header">Explorer</div>
            <div class="tree-container">
                ${fileTreeHtml}
            </div>
        </div>

        <!-- CENTER: Detail View -->
        <div class="center-panel" id="center-panel">
            <div class="empty-state">
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
                <div class="stat-card">
                    <div class="stat-label">Unused Exports</div>
                    <div class="stat-value">${tsPruneCount}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Duplicates</div>
                    <div class="stat-value">${jscpdCount}</div>
                </div>
                 <div class="stat-card">
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
        
        function toggleFolder(el) {
            const children = el.nextElementSibling;
            children.classList.toggle('hidden');
            // Toggle icon rotation or state here if needed
            const icon = el.querySelector('svg');
            icon.style.opacity = children.classList.contains('hidden') ? '0.7' : '1';
        }

        function selectFile(fileId) {
            // Highlight Tree
            document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
            const row = document.querySelector(\`[data-file-id="\${fileId}"]\`);
            if(row) row.classList.add('active');

            // Find data
            const fileData = DATA.files.find(f => f.id === fileId);
            const container = document.getElementById('center-panel');
            
            if (!fileData) return;

            // Render
            container.innerHTML = \`
                <div class="detail-view">
                    <div class="file-toolbar">
                        <div class="file-path">\${fileData.path}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted)">
                            \${fileData.errorCount} Errors, \${fileData.warningCount} Warnings
                        </div>
                    </div>
                    \${fileData.issues.map(renderIssue).join('')}
                </div>
            \`;
        }

        function renderIssue(issue) {
            return \`
            <div class="issue-card">
                <div class="issue-header">
                    <span class="badge \${issue.severity}">\${issue.severity}</span>
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
            // Combines expandable top, visible, and bottom
            // For this UI, we just render visible lines + surrounding context if small
            // Simplification: Render visible lines
            return snippet.visible.map(l => \`
                <div class="code-line \${l.isError ? 'is-error' : ''}">
                    <span class="ln">\${l.number}</span>
                    <span class="lc">\${l.highlightedContent}</span>
                </div>
            \`).join('');
        }

        function escapeHtml(text) {
             const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
             return String(text).replace(/[&<>"']/g, (m) => map[m]);
        }

        function filterBySeverity(sev) {
            // TODO: Implement interactive tree filtering
            alert('Filter by ' + sev + ' coming soon (Placeholder action)');
        }
    </script>
</body>
</html>`;
    }
}

module.exports = { HtmlGenerator };
