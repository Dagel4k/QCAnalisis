import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface HtmlGeneratorOptions {
    cwd?: string;
    maxVisibleIssues?: number;
    collapseByDefault?: boolean;
    theme?: string;
}

interface CodeSnippetLine {
    number: number;
    highlightedContent: string;
    isError?: boolean;
}

interface CodeSnippet {
    expandableTop: CodeSnippetLine[];
    visible: CodeSnippetLine[];
    expandableBottom: CodeSnippetLine[];
}

interface FileTreeNode {
    type: 'file' | 'folder';
    path?: string;
    errorCount: number;
    warningCount: number;
    children?: Record<string, FileTreeNode>;
}

export class HtmlGenerator {
    private cwd: string;
    private maxVisibleIssues: number;
    private collapseByDefault: boolean;
    private theme: string;
    private codeToHtml: (code: string, options?: any) => Promise<string>;

    constructor(options: HtmlGeneratorOptions = {}) {
        this.cwd = options.cwd || process.cwd();
        this.maxVisibleIssues = options.maxVisibleIssues || 500;
        this.collapseByDefault = options.collapseByDefault ?? true;
        this.theme = options.theme || 'dark';
        this.codeToHtml = async (code) => this.escapeHtml(code);
    }

    private escapeHtml(text: any): string {
        const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"'']/g, (m) => map[m]);
    }

    public async init(): Promise<void> {
        try {
            const searchPaths = [
                this.cwd,
                path.join(this.cwd, 'node_modules'),
                path.join(this.cwd, 'repo-scan-dashboard-main', 'node_modules'),
                path.join(this.cwd, 'node_modules', '@scriptc', 'dev-tools', 'node_modules'),
            ];
            let shikiModule: any;
            try {
                const resolved = require.resolve('shiki', { paths: searchPaths });
                shikiModule = await import(pathToFileURL(resolved).href);
            } catch {
                shikiModule = await import('shiki');
            }
            this.codeToHtml = shikiModule.codeToHtml;
        } catch (e: any) {
            console.warn('[HTMLGenerator] Could not load shiki, syntax highlighting will be disabled.', e.message);
            this.codeToHtml = async (code) => this.escapeHtml(code);
        }
    }

    private async getCodeSnippet(filePath: string, line: number, visibleContext = 2, expandableContext = 10): Promise<CodeSnippet> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            const visibleStart = Math.max(0, line - visibleContext - 1);
            const visibleEnd = Math.min(lines.length, line + visibleContext);

            const expandableStartTop = Math.max(0, line - expandableContext - 1);
            const expandableEndTop = visibleStart;
            const expandableStartBottom = visibleEnd;
            const expandableEndBottom = Math.min(lines.length, line + expandableContext);

            const snippet: CodeSnippet = { expandableTop: [], visible: [], expandableBottom: [] };

            const highlight = async (txt: string) => {
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

    private buildFileTree(results: any[]): Record<string, FileTreeNode> {
        const tree: Record<string, FileTreeNode> = {};
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
                    current = current[part].children!;
                }
            });
        });
        return tree;
    }

    private renderFileTree(tree: Record<string, FileTreeNode>, level = 0): string {
        let html = '';
        const entries = Object.entries(tree).sort(([nA, nAObj], [nB, nBObj]) => {
            if (nAObj.type !== nBObj.type) return nAObj.type === 'folder' ? -1 : 1;
            return nA.localeCompare(nB);
        });

        for (const [name, node] of entries) {
            if (node.type === 'folder') {
                if (node.errorCount === 0 && node.warningCount === 0) continue;
                html += `
            <div class="tree-folder">
              <div class="tree-row folder-row" onclick="toggleFolder(this)" role="button" tabindex="0" aria-expanded="false" aria-label="Toggle folder ${this.escapeHtml(name)}" style="padding-left: ${12 + (level * 12)}px;">
                <span class="tree-icon"><svg class="icon" viewBox="0 0 24 24"><use href="#icon-folder-closed" /></svg></span>
                <span class="tree-label">${this.escapeHtml(name)}</span>
                ${(node.errorCount + node.warningCount) > 0 ? `<span class="count-badge">${node.errorCount + node.warningCount}</span>` : ''}
              </div>
              <div class="tree-children hidden">
                ${this.renderFileTree(node.children!, level + 1)}
              </div>
            </div>`;
            } else {
                const fileId = `file-${node.path!.replace(/[^a-zA-Z0-9]/g, '-')}`;
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

    public async generate(data: any): Promise<string> {
        const startTime = performance.now();
        try {
            if (this.codeToHtml.toString().includes('escapeHtml')) await this.init(); // Weak check if init needed

            const { results: eslintResults, summary, tsPrune, jscpd, semgrep, osv, gitleaks, knip, depCruiser } = data;

            const results = [...eslintResults];

            const mergeFindings = (findings: any[], toolPrefix: string) => {
                if (!findings || !Array.isArray(findings)) return;
                findings.forEach(f => {
                    if (!f.file) {
                        console.warn(`[HTMLGenerator] Skipping ${toolPrefix} finding without file path:`, f.message || 'No message');
                        return;
                    }

                    const filePath = path.isAbsolute(f.file) ? f.file : path.resolve(this.cwd, f.file);
                    let text = f.message || 'Issue found';

                    let fileResult = results.find(r => r.filePath === filePath);
                    if (!fileResult) {
                        fileResult = { filePath, messages: [], errorCount: 0, warningCount: 0, source: '' };
                        results.push(fileResult);
                    }

                    const ruleSuffix = f.rule ? f.rule : 'issue';
                    const finalRuleId = ruleSuffix.startsWith(toolPrefix) ? ruleSuffix : `${toolPrefix}/${ruleSuffix}`;

                    const sevMap: Record<string, number> = { 
                        'error': 2, 'err': 2, 'critical': 2, 'high': 2,
                        'warning': 1, 'warn': 1, 'info': 1, 'medium': 1, 'low': 1
                    };
                    let severity = 1; // Default to Warning
                    if (f.severity) {
                        if (typeof f.severity === 'number') severity = f.severity;
                        else if (typeof f.severity === 'string') {
                            const s = f.severity.toLowerCase();
                            if (sevMap[s]) severity = sevMap[s];
                        }
                    }

                    fileResult.messages.push({
                        ruleId: finalRuleId,
                        message: text,
                        line: f.line || 1,
                        column: f.column || 1,
                        severity: severity
                    });
                    if (severity === 2) fileResult.errorCount++; else fileResult.warningCount++;
                });
            };

            mergeFindings(semgrep?.findings, 'semgrep');
            mergeFindings(gitleaks?.findings, 'gitleaks');
            mergeFindings(osv?.findings, 'OSV');
            mergeFindings(knip?.findings, 'knip');
            mergeFindings(depCruiser?.findings, 'architecture');

            if (jscpd?.duplicates) {
                const getOrCreateFileResult = (fPath: any) => {
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

                jscpd.duplicates.forEach((d: any) => {
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
                    let snippet = null;
                    try {
                        snippet = await this.getCodeSnippet(r.filePath, m.line);
                    } catch (err) {
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

            const ruleStats: Record<string, any> = {};
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

            const clientData = {
                files: resultsWithSnippets.map(res => ({
                    id: `file-${path.relative(this.cwd, res.filePath).replace(/[^a-zA-Z0-9]/g, '-')}`,
                    path: path.relative(this.cwd, res.filePath),
                    errorCount: res.errorCount,
                    warningCount: res.warningCount,
                    issues: res.messagesWithSnippets.map(m => {
                        let tool = 'ESLint';
                        if (m.ruleId) {
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

            // Recalculate summary to include all merged findings (Knip, Semgrep, etc.)
            summary.errors = results.reduce((a, r) => a + r.errorCount, 0);
            summary.warnings = results.reduce((a, r) => a + r.warningCount, 0);
            summary.files = results.length;

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
        } catch (error: any) {
            console.error('[HTMLGenerator] Generation failed:', error);
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

    private renderHtml(model: any): string {
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
                --bg-body: #09090b;
                --bg-panel: #18181b;
                --bg-header: #09090b80;
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
            .hidden {display: none !important; }
            .flex {display: flex; }
            .col {flex-direction: column; }
            header { height: 50px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 1.5rem; background: var(--bg-header); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 50; }
            header h1 {font-size: 0.95rem; font-weight: 600; color: var(--text-main); letter-spacing: -0.01em; }
            .header-meta {margin-left: auto; font-size: 0.8rem; color: var(--text-muted); }
            main {display: grid; grid-template-columns: 280px 1fr 320px; flex: 1; overflow: hidden; }
            .sidebar-left {background: var(--bg-body); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
            .sidebar-header {padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
            .tree-container {flex: 1; padding: 0.5rem 0; }
            .tree-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 1rem; cursor: pointer; font-size: 0.85rem; color: var(--text-muted); transition: all 0.15s; border-left: 2px solid transparent; }
            .tree-row:hover {background: #27272a50; color: var(--text-main); }
            .tree-row.active {background: #2563eb15; color: var(--text-main); border-left-color: var(--accent); }
            .tree-label {overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .folder-row .tree-icon {color: var(--text-muted); opacity: 0.7; }
            .count-badge {font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: var(--border); margin-left: auto; }
            .dot-error {width: 6px; height: 6px; border-radius: 50%; background: var(--error); margin-left: auto; }
            .dot-warning {width: 6px; height: 6px; border-radius: 50%; background: var(--warning); margin-left: auto; }
            .tools-list {padding: 0.5rem 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
            .tool-chip { font-size: 0.7rem; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; transition: all 0.2s; }
            .tool-chip:hover {border-color: var(--text-main); color: var(--text-main); }
            .tool-chip.active {background: var(--text-main); color: var(--bg-body); border-color: var(--text-main); font-weight: 600; }
            .center-panel {background: #121214; display: flex; flex-direction: column; overflow: hidden; position: relative; }
            .empty-state {position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-direction: column; gap: 1rem; }
            .empty-icon {width: 48px; height: 48px; opacity: 0.2; }
            .detail-view {display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding-bottom: 3rem; }
            .file-toolbar { padding: 1rem 2rem; border-bottom: 1px solid var(--border); background: var(--bg-body); position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; }
            .file-path {font-family: var(--font-mono); font-size: 0.9rem; color: var(--text-main); }
            .issue-card { margin: 1.5rem 2rem 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); flex-shrink: 0; }
            .issue-header { padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--border); background: #202023; }
            .badge { text-transform: uppercase; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.02em; }
            .badge.error {color: var(--error); background: #450a0a; border: 1px solid #7f1d1d; }
            .badge.warning {color: var(--warning); background: #422006; border: 1px solid #713f12; }
            .tool-badge { font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; background: #3f3f46; color: #d4d4d8; }
            .issue-rule {font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-left: auto; opacity: 0.8; }
            .issue-message {font-size: 0.9rem; font-weight: 500; }
            .snippet { padding: 1rem; background: #0d0d0d; font-family: var(--font-mono); font-size: 0.8rem; overflow-x: auto; }
            .code-line {display: flex; line-height: 1.6; }
            .ln {width: 40px; padding-right: 1rem; text-align: right; color: #52525b; user-select: none; flex-shrink: 0; }
            .lc {white-space: pre; color: #d4d4d8; }
            .is-error {background: #450a0a30; }
            .is-error .ln {color: var(--error); font-weight: bold; }
            .sidebar-right {background: var(--bg-body); border-left: 1px solid var(--border); overflow-y: auto; padding: 1.5rem; }
            .stats-grid {display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 2rem; }
            .stat-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.25rem; cursor: pointer; transition: transform 0.1s; }
            .stat-card:hover {border-color: var(--text-muted); }
            .stat-card.active {border-color: var(--text-main); background: #27272a; }
            .stat-label {font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
            .stat-value {font-size: 1.75rem; font-weight: 700; color: var(--text-main); }
            .stat-card.errors .stat-value {color: var(--error); }
            .stat-card.warnings .stat-value {color: var(--warning); }
            .chart-container { display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 2rem; }
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
            .header-controls { display: flex; align-items: center; gap: 0.5rem; margin-right: 1rem;}
            .search-input { background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; width: 180px; }
            .btn-icon { background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-muted); padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
            .btn-icon:hover { color: var(--text-main); border-color: var(--text-muted); background: var(--bg-body); }
            .btn-text { font-size: 0.75rem; font-weight: 500; margin-left: 0.25rem; }
            .btn-back { background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
            .btn-back:hover { background: var(--border); }
            .summary-view { padding: 2rem; overflow-y: auto; height: 100%; display: none; }
            .summary-view.active { display: block; }
            .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
            .summary-card { background: var(--bg-panel); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px; display:flex; flex-direction:column; gap:0.5rem; }
            .summary-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; }
            .summary-value { font-size: 2rem; font-weight: 700; color: var(--text-main); }
            .icon {width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; }
            html.light { --bg-body: #f8f9fa; --bg-panel: #ffffff; --bg-header: #ffffffcc; --border: #e2e8f0; --text-main: #1a202c; --text-muted: #718096; --accent: #3182ce; }
            html.light .center-panel { background: var(--bg-body); }
            html.light .snippet { filter: invert(0.93) hue-rotate(180deg); border: 1px solid var(--border); background: #0d0d0d; }
            html.light .issue-header { background: #f7fafc; border-bottom: 1px solid var(--border); }
            html.light .issue-card { background: #ffffff; border: 1px solid var(--border); }
            html.light .stat-card.active { background: #e2e8f0; border-color: #cbd5e0; }
            html.light .progress-track { background: #edf2f7; }
            html.light .tree-row:hover { background: rgba(0,0,0,0.05); }
            html.light .tree-row.active { background: #e2e8f0; }
            @media print { .sidebar-left, .header-controls, .sidebar-right { display: none !important; } .center-panel { width: 100% !important; padding: 0 !important; overflow: visible !important; } .detail-view, .summary-view { overflow: visible !important; height: auto !important; } body { background: white !important; color: black !important; overflow: visible !important; } .issue-card { border: 1px solid #ddd !important; break-inside: avoid; } .snippet { background: #f5f5f5 !important; border: 1px solid #eee !important; color: black !important; } .code-line .lc { color: black !important; } ::-webkit-scrollbar { display: none; } }
        </style>
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
            <h1>Code Quality Report</h1>
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
            <div class="sidebar-left">
                <div class="sidebar-header" style="margin-top:0">Tools</div>
                <div class="tools-list" id="tools-list"></div>
                <div class="sidebar-header">Explorer</div>
                <div class="tree-container">${fileTreeHtml}</div>
            </div>
            <div class="center-panel" id="center-panel">
                <div id="summary-view" class="summary-view">
                    <h2 style="margin-bottom:1.5rem; border-bottom:1px solid var(--border); padding-bottom:1rem;">Executive Summary</h2>
                    <div class="summary-grid">
                        <div class="summary-card"><span class="summary-label">Total Issues</span><span class="summary-value">${totalIssues}</span></div>
                        <div class="summary-card"><span class="summary-label">Errors</span><span class="summary-value" style="color:var(--error)">${summary.errors}</span></div>
                        <div class="summary-card"><span class="summary-label">Warnings</span><span class="summary-value" style="color:var(--warning)">${summary.warnings}</span></div>
                        <div class="summary-card"><span class="summary-label">Files Affected</span><span class="summary-value">${model.resultsWithSnippets.filter((r: any) => r.errorCount > 0 || r.warningCount > 0).length}</span></div>
                    </div>
                    <div class="summary-grid">
                        <div class="summary-card"><span class="summary-label">Security Findings</span><span class="summary-value">${securityCount}</span></div>
                        <div class="summary-card"><span class="summary-label">Duplications</span><span class="summary-value">${jscpdCount}</span></div>
                    </div>
                    <h3 style="margin:2rem 0 1rem; color:var(--text-muted); font-size: 0.9rem; text-transform:uppercase;">Top Offending Files</h3>
                    <div class="rules-list">
                        ${model.resultsWithSnippets.sort((a: any, b: any) => b.errorCount - a.errorCount).slice(0, 5).map((r: any) =>
            `<div class="rule-item" style="cursor:pointer;" onclick="selectFile('file-${path.relative(this.cwd, r.filePath).replace(/[^a-zA-Z0-9]/g, '-')}')">
                                <div class="rule-header"><span class="rule-name" style="font-family:monospace">${path.relative(this.cwd, r.filePath)}</span><span class="rule-count" style="color:var(--error)">${r.errorCount} Errors</span></div>
                            </div>`
        ).join('')}
                    </div>
                </div>
                <div class="empty-state" id="empty-state">
                    <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                    <p>Select a file to view details</p>
                </div>
            </div>
            <div class="sidebar-right">
                <div class="chart-container">
                    <div class="donut-chart" style="background: conic-gradient(var(--error) 0% ${(summary.errors / totalIssues) * 100}% , var(--warning) ${(summary.errors / totalIssues) * 100}% 100%)"></div>
                    <div class="donut-center"><div class="donut-total">${totalIssues}</div><div class="donut-sub">Issues</div></div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card errors active" onclick="filterBySeverity('error')"><div class="stat-label">Errors</div><div class="stat-value">${summary.errors}</div></div>
                    <div class="stat-card warnings" onclick="filterBySeverity('warning')"><div class="stat-label">Warnings</div><div class="stat-value">${summary.warnings}</div></div>
                    <div class="stat-card unused" onclick="selectTool('ts-prune')"><div class="stat-label">Unused Exports</div><div class="stat-value">${tsPruneCount}</div></div>
                    <div class="stat-card duplicates" onclick="selectTool('JSCPD')"><div class="stat-label">Duplicates</div><div class="stat-value">${jscpdCount}</div></div>
                    <div class="stat-card knip" onclick="selectTool('Knip')"><div class="stat-label">Knip (Deep)</div><div class="stat-value">${model.knipCount}</div></div>
                    <div class="stat-card security" onclick="selectTool('Security')"><div class="stat-label">Security</div><div class="stat-value">${securityCount}</div></div>
                </div>
                <div class="sidebar-header" style="margin: 1.5rem 0 1rem;">Top Rules</div>
                <div class="rules-list">
                    ${sortedRules.slice(0, 15).map(([rule, stats]: [string, any]) => {
            const percent = Math.min(100, (stats.count / totalIssues) * 100);
            const colorClass = stats.errors > 0 ? 'red' : 'yellow';
            return `<div class="rule-item"><div class="rule-header"><span class="rule-name">${rule}</span><span class="rule-count">${stats.count}</span></div><div class="progress-track"><div class="progress-fill ${colorClass}" style="width: ${percent}%"></div></div></div>`;
        }).join('')}
                </div>
            </div>
        </main>
        <script>
            const DATA = ${JSON.stringify(clientData).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
            
            // Global Error Handler
            window.onerror = function(msg, url, line, col, error) {
                document.body.innerHTML += '<div style="color:red; background:black; padding:10px; border-bottom:1px solid #333;">Global Error: ' + msg + '</div>';
            };

            // Init Logic
            try {
                if (localStorage.getItem('theme') === 'light') { document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); }
                
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                     searchInput.addEventListener('input', (e) => { currentFilter.search = e.target.value.toLowerCase(); render(); });
                }
                
                // Init filtering state
                var currentFilter = {tool: null, severity: null, fileId: null, search: '' };
                
                const allTools = new Set();
                DATA.files.forEach(f => f.issues.forEach(i => allTools.add(i.tool)));
                
                const toolsContainer = document.getElementById('tools-list');
                if (toolsContainer) {
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
                }
                
                render();
                updateSidebar();

            } catch (e) {
                console.error(e);
                document.body.innerHTML += '<div style="color:red; background:black; padding:10px;">Init Error: ' + e.message + '</div>';
            }

            // --- FUNCTIONS (Global Scope) ---

            function toggleTheme() { 
                const html = document.documentElement;
                if (html.classList.contains('dark')) { html.classList.remove('dark'); html.classList.add('light'); localStorage.setItem('theme', 'light'); } 
                else { html.classList.remove('light'); html.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
            }

            function toggleView() { 
                const summary = document.getElementById('summary-view');
                if (summary.classList.contains('active')) { summary.classList.remove('active'); render(); } 
                else { summary.classList.add('active'); document.getElementById('detail-view-container')?.classList.add('hidden'); document.getElementById('empty-state')?.classList.add('hidden'); }
            }
            
            function exportToCSV() {
                const issues = getFilteredIssues();
                if (!issues.length) return alert('No issues');
                const csv = ['File,Tool,Rule,Severity,Line,Message'].concat(issues.map(i => 
                    '"' + i.path + '","' + i.tool + '","' + i.rule + '","' + i.severity + '",' + i.line + ',"' + (i.message||'').replace(/"/g,'""') + '"'
                )).join('\\n');
                const b = new Blob([csv], {type:'text/csv'});
                const u = URL.createObjectURL(b);
                const a = document.createElement('a'); a.href=u; a.download='report.csv'; a.click();
            }

            function downloadPDF(btn) {
                const issues = getFilteredIssues();
                if(!issues.length) return alert('No issues');
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                doc.text("Code Report", 14, 20);
                doc.autoTable({
                    startY: 30,
                    head: [['Sev','Loc','Rule','Msg']],
                    body: issues.map(i => [i.severity, i.path+':'+i.line, i.rule, i.message])
                });
                doc.save('report.pdf');
            }

            function getFilteredIssues() {
                let issues = [];
                if (currentFilter.fileId) {
                    const f = DATA.files.find(x => x.id === currentFilter.fileId);
                    if(f) issues = f.issues.map(i => ({...i, path: f.path}));
                } else {
                    DATA.files.forEach(f => f.issues.forEach(i => issues.push({...i, path: f.path})));
                }
                if (currentFilter.tool) issues = issues.filter(i => {
                    if (currentFilter.tool === 'Security') return ['Semgrep','Gitleaks','OSV'].includes(i.tool) || (i.rule && i.rule.toLowerCase().includes('security'));
                    return i.tool === currentFilter.tool;
                });
                if (currentFilter.severity) issues = issues.filter(i => i.severity === currentFilter.severity);
                if (currentFilter.search) issues = issues.filter(i => (i.message||'').toLowerCase().includes(currentFilter.search) || (i.path||'').toLowerCase().includes(currentFilter.search));
                return issues;
            }

            function selectTool(t) { currentFilter.tool = (currentFilter.tool === t ? null : t); updateUI(); render(); updateSidebar(); } 
            function filterBySeverity(s) { currentFilter.severity = (currentFilter.severity === s ? null : s); updateUI(); render(); updateSidebar(); } 
            function selectFile(id) { currentFilter.fileId = id; updateUI(); render(); updateSidebar(); }
            function backToDashboard() { currentFilter.fileId = null; updateUI(); render(); updateSidebar(); }
            function toggleFolder(el) { el.nextElementSibling.classList.toggle('hidden'); }

            function updateUI() {
                document.querySelectorAll('.tool-chip').forEach(c => {
                    if ((c.textContent === 'All' && !currentFilter.tool) || c.textContent === currentFilter.tool) c.classList.add('active');
                    else c.classList.remove('active');
                });
                document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
                if (currentFilter.severity === 'error') document.querySelector('.stat-card.errors')?.classList.add('active');
                if (currentFilter.severity === 'warning') document.querySelector('.stat-card.warnings')?.classList.add('active');
            }

            function updateSidebar() {
                // Stats are static, do not update on filter
            }

            function render() {
                const container = document.getElementById('center-panel');
                const issues = getFilteredIssues();
                const summaryActive = document.getElementById('summary-view').classList.contains('active');
                const emptyState = document.getElementById('empty-state');
                
                let detailContainer = document.getElementById('detail-view-container');
                if (!detailContainer) {
                    detailContainer = document.createElement('div');
                    detailContainer.id = 'detail-view-container';
                    detailContainer.className = 'detail-view';
                    // Ensure detail view is positioned above empty state if visible
                    detailContainer.style.position = 'relative';
                    detailContainer.style.zIndex = '10';
                    detailContainer.style.background = 'var(--bg-body)';
                    container.appendChild(detailContainer);
                }
                
                if (summaryActive) {
                    detailContainer.style.display = 'none';
                    if (emptyState) emptyState.style.display = 'none';
                    return;
                }
                
                // Show detail container
                detailContainer.style.display = 'flex';
                
                // Force hide empty state if we have issues or just want to show list
                if (issues.length > 0) {
                     if (emptyState) emptyState.style.display = 'none';
                } else {
                     // Even if 0 issues (after filtering), we want to show empty list state, not the logo overlay
                     if (emptyState) emptyState.style.display = 'none';
                     if (issues.length === 0 && !currentFilter.fileId && !currentFilter.tool && !currentFilter.severity && !currentFilter.search) {
                        // Only show empty state if truly at initial state with 0 total issues?
                        // No, initial state has total issues > 0.
                        // So empty state should strictly be hidden once render starts.
                     }
                }

                // Use simple string concatenation for innerHTML to avoid TS parsing issues
                let html = '<div class="file-toolbar"><div>' + issues.length + ' Issues</div><button onclick="backToDashboard()">Back</button></div>';
                
                html += issues.slice(0, 500).map(i => 
                    '<div class="issue-card">' + 
                        '<div class="issue-header"><span class="badge ' + i.severity + '">' + i.severity + '</span> ' + i.path + ':' + i.line + ' <span class="issue-message">' + escapeHtml(i.message) + '</span></div>' + 
                        '<div class="snippet">' + renderSnippet(i.snippet) + '</div>' + 
                    '</div>'
                ).join('');
                
                detailContainer.innerHTML = html;
            }

            function renderSnippet(s) {
                if (!s || !s.visible) return '';
                return s.visible.map(l => '<div class="code-line ' + (l.isError?'is-error':'') + '"><span class="ln">' + l.number + '</span><span class="lc">' + l.highlightedContent + '</span></div>').join('');
            }
            function escapeHtml(t) { return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

        </script>
    </body>
</html>`;
    }

    private getFrontendScript() {
        // Return the frontend JS as a string
        return `
            render();
            updateSidebar();

            function toggleTheme() { 
                const html = document.documentElement;
                if (html.classList.contains('dark')) { html.classList.remove('dark'); html.classList.add('light'); localStorage.setItem('theme', 'light'); } 
                else { html.classList.remove('light'); html.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
            }

            function toggleView() { 
                const summary = document.getElementById('summary-view');
                if (summary.classList.contains('active')) { summary.classList.remove('active'); render(); } 
                else { summary.classList.add('active'); document.getElementById('detail-view-container')?.classList.add('hidden'); document.getElementById('empty-state')?.classList.add('hidden'); }
            }
            
            function exportToCSV() {
                const issues = getFilteredIssues();
                if (!issues.length) return alert('No issues');
                // Use simple quote concatenation to avoid TS template literal confusion
                const csv = ['File,Tool,Rule,Severity,Line,Message'].concat(issues.map(i => 
                    '"' + i.path + '","' + i.tool + '","' + i.rule + '","' + i.severity + '",' + i.line + ',"' + (i.message||'').replace(/"/g,'""') + '"'
                )).join('\n');
                const b = new Blob([csv], {type:'text/csv'});
                const u = URL.createObjectURL(b);
                const a = document.createElement('a'); a.href=u; a.download='report.csv'; a.click();
            }

            function downloadPDF(btn) {
                const issues = getFilteredIssues();
                if(!issues.length) return alert('No issues');
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                doc.text("Code Report", 14, 20);
                doc.autoTable({
                    startY: 30,
                    head: [['Sev','Loc','Rule','Msg']],
                    body: issues.map(i => [i.severity, i.path+':'+i.line, i.rule, i.message])
                });
                doc.save('report.pdf');
            }

            function getFilteredIssues() {
                let issues = [];
                if (currentFilter.fileId) {
                    const f = DATA.files.find(x => x.id === currentFilter.fileId);
                    if(f) issues = f.issues.map(i => ({...i, path: f.path}));
                } else {
                    DATA.files.forEach(f => f.issues.forEach(i => issues.push({...i, path: f.path})));
                }
                if (currentFilter.tool) issues = issues.filter(i => {
                    if (currentFilter.tool === 'Security') return ['Semgrep','Gitleaks','OSV'].includes(i.tool) || (i.rule && i.rule.toLowerCase().includes('security'));
                    return i.tool === currentFilter.tool;
                });
                if (currentFilter.severity) issues = issues.filter(i => i.severity === currentFilter.severity);
                if (currentFilter.search) issues = issues.filter(i => (i.message||'').toLowerCase().includes(currentFilter.search) || (i.path||'').toLowerCase().includes(currentFilter.search));
                return issues;
            }

            function selectTool(t) { currentFilter.tool = (currentFilter.tool === t ? null : t); currentFilter.severity = null; currentFilter.fileId = null; switchToDetailView(); updateUI(); render(); updateSidebar(); } 
            function filterBySeverity(s) { currentFilter.severity = (currentFilter.severity === s ? null : s); currentFilter.tool = null; currentFilter.fileId = null; switchToDetailView(); updateUI(); render(); updateSidebar(); } 
            function selectFile(id) { currentFilter.fileId = id; switchToDetailView(); updateUI(); render(); updateSidebar(); }
            function backToDashboard() { currentFilter.fileId = null; updateUI(); render(); updateSidebar(); }
            function toggleFolder(el) { el.nextElementSibling.classList.toggle('hidden'); }

            function switchToDetailView() {
                const summary = document.getElementById('summary-view');
                if (summary.classList.contains('active')) {
                    summary.classList.remove('active');
                }
            }

            function updateUI() {
                document.querySelectorAll('.tool-chip').forEach(c => {
                    if ((c.textContent === 'All' && !currentFilter.tool) || c.textContent === currentFilter.tool) c.classList.add('active');
                    else c.classList.remove('active');
                });
                document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
                if (currentFilter.severity === 'error') document.querySelector('.stat-card.errors')?.classList.add('active');
                if (currentFilter.severity === 'warning') document.querySelector('.stat-card.warnings')?.classList.add('active');
            }

            function updateSidebar() {
                // Stats are static, do not update on filter
            }

            function render() {
                const container = document.getElementById('center-panel');
                const issues = getFilteredIssues();
                const summaryActive = document.getElementById('summary-view').classList.contains('active');
                
                let detailContainer = document.getElementById('detail-view-container');
                if (!detailContainer) {
                    detailContainer = document.createElement('div');
                    detailContainer.id = 'detail-view-container';
                    detailContainer.className = 'detail-view';
                    container.appendChild(detailContainer);
                }
                
                if (summaryActive) {
                    detailContainer.classList.add('hidden');
                    document.getElementById('empty-state')?.classList.add('hidden');
                    return;
                }
                
                detailContainer.classList.remove('hidden');
                document.getElementById('empty-state')?.classList.add('hidden'); 

                // Use simple string concatenation for innerHTML to avoid TS parsing issues
                let html = '<div class="file-toolbar"><div>' + issues.length + ' Issues</div><button class="btn-back" onclick="backToDashboard()">Back</button></div>';
                
                html += issues.slice(0, 500).map(i => 
                    '<div class="issue-card">' + 
                        '<div class="issue-header"><span class="badge ' + i.severity + '">' + i.severity + '</span> ' + i.path + ':' + i.line + ' <span class="issue-message">' + escapeHtml(i.message) + '</span></div>' + 
                        '<div class="snippet">' + renderSnippet(i.snippet) + '</div>' + 
                    '</div>'
                ).join('');
                
                detailContainer.innerHTML = html;
            }

            function renderSnippet(s) {
                if (!s || !s.visible) return '';
                return s.visible.map(l => '<div class="code-line ' + (l.isError?'is-error':'') + '"><span class="ln">' + l.number + '</span><span class="lc">' + l.highlightedContent + '</span></div>').join('');
            }
                        function escapeHtml(t) { return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
                    `;
    }
}
