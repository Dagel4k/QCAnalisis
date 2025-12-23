const { ESLint } = require('eslint');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

let codeToHtml;
let lintGlobs;

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
      return args[i].substring(8);
    } else if (args[i] === '--globs' && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
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

/**
 * Check if a file path should be ignored based on patterns
 */
function shouldIgnoreFile(filePath, ignorePatterns) {
  if (ignorePatterns.length === 0) return false;

  const relativePath = path.relative(process.cwd(), filePath);

  return ignorePatterns.some((pattern) => {
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
            <span class="tree-icon folder-icon">📁</span>
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
          <span class="tree-icon">📄</span>
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
function runTsPrune() {
  try {
    console.log('🔍 Running ts-prune...');
    // Prefer local binary if available to avoid network
    const localBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');
    const nestedBin = path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules', '.bin', process.platform === 'win32' ? 'ts-prune.cmd' : 'ts-prune');
    const cmd = fs.existsSync(localBin)
      ? `"${localBin}" src --ignore "\\.pb\\.ts$|/proto/|/protos/"`
      : fs.existsSync(nestedBin)
        ? `"${nestedBin}" src --ignore "\\.pb\\.ts$|/proto/|/protos/"`
        : 'npx ts-prune src --ignore "\\.pb\\.ts$|/proto/|/protos/"';
    const output = execSync(cmd, {
      encoding: 'utf-8',
    });
    const lines = output.split('\n').filter(line => line.trim());

    const unusedExports = lines
      .filter(line => line.includes('used in module'))
      .map(line => {
        const match = line.match(/^(.+?):(\d+) - (.+)$/);
        if (match) {
          return {
            file: match[1],
            line: parseInt(match[2]),
            export: match[3],
          };
        }
        return null;
      })
      .filter(Boolean);

    return { count: unusedExports.length, items: unusedExports };
  } catch (error) {
    console.warn('⚠️  ts-prune failed:', error.message);
    return { count: 0, items: [] };
  }
}

/**
 * Run jscpd to find code duplicates
 */
function runJscpd() {
  try {
    console.log('🔍 Running jscpd...');
    const tempFile = path.join(process.cwd(), 'reports', 'jscpd-report.json');

    // Run jscpd with reporters option to generate JSON file, ignore exit code
    try {
      const localBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
      const nestedBin = path.join(process.cwd(), 'node_modules', '@scriptc', 'dev-tools', 'node_modules', '.bin', process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd');
      const baseCmd = fs.existsSync(localBin)
        ? `"${localBin}" src --reporters json --output reports --threshold 100 --exitCode 0`
        : fs.existsSync(nestedBin)
          ? `"${nestedBin}" src --reporters json --output reports --threshold 100 --exitCode 0`
          : `npx jscpd src --reporters json --output reports --threshold 100 --exitCode 0`;
      execSync(baseCmd, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (execError) {
      // jscpd might fail with non-zero exit code, but still generate the file
      console.log('⚠️  jscpd finished with warnings (this is normal)');
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
    console.warn('⚠️  jscpd failed:', error.message);
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

  console.log('🔍 Running ESLint on src/ directory...');
  if (ignorePatterns.length > 0) {
    console.log(`📋 Ignoring patterns: ${ignorePatterns.join(', ')}`);
  }

  const envDisabledRules = process.env.REPORT_DISABLED_RULES;
  let disabledRulesConfig = {};
  if (envDisabledRules) {
      envDisabledRules.split(',').forEach(r => {
          const rule = r.trim();
          if (rule) disabledRulesConfig[rule] = 'off';
      });
  }

  const eslint = new ESLint({
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fix: false,
    overrideConfig: {
      rules: disabledRulesConfig
    }
  });

  const patterns = lintGlobs ? [lintGlobs] : ['src/**/*.ts'];
  const results = await eslint.lintFiles(patterns);

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
    `📊 Found ${totalIssues} issues (${errorCount} errors, ${warningCount} warnings)`,
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
  console.log('🎨 Applying syntax highlighting...');
  const resultsWithSnippets = await Promise.all(
    filteredResults.map(async (result) => {
      const messagesWithSnippets = await Promise.all(
        result.messages.map(async (message) => ({
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
  const tsPruneData = runTsPrune();
  const jscpdData = runJscpd();

  // Build file tree
  const filesWithIssues = resultsWithSnippets.filter(
    (result) => result.errorCount > 0 || result.warningCount > 0,
  );
  const fileTree = buildFileTree(filesWithIssues);
  const fileTreeHtml = renderFileTree(fileTree);

  // Generate HTML
  // Read favicon
  const faviconPath = path.join(__dirname, '../public/favicon.ico');
  let faviconData = '';
  try {
      if (fs.existsSync(faviconPath)) {
          faviconData = fs.readFileSync(faviconPath).toString('base64');
      }
  } catch (e) {
      console.warn('Could not read favicon.ico', e.message);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${faviconData ? `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconData}" />` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ESLint Report - SonarQube Style</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f3f3f3;
            color: #333;
            line-height: 1.6;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem 2rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
            background: white;
            border-right: 1px solid #e2e8f0;
            overflow-y: auto;
            flex-shrink: 0;
        }

        .sidebar-header {
            padding: 1rem 1.5rem;
            background: #f7fafc;
            border-bottom: 2px solid #e2e8f0;
            font-weight: 600;
            color: #2d3748;
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .tree-container {
            padding: 0.5rem;
        }

        .container {
            flex: 1;
            overflow-y: auto;
            padding: 2rem;
        }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .summary-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }

        .summary-card.errors {
            border-left-color: #e53e3e;
        }

        .summary-card.warnings {
            border-left-color: #dd6b20;
        }

        .summary-card.files {
            border-left-color: #3182ce;
        }

        .summary-card .label {
            font-size: 0.85rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }

        .summary-card .value {
            font-size: 2.5rem;
            font-weight: bold;
            color: #333;
        }

        .section {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
            overflow: hidden;
        }

        .section-header {
            background: #f7fafc;
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid #e2e8f0;
            font-weight: 600;
            font-size: 1.1rem;
            color: #2d3748;
        }

        .section-content {
            padding: 1.5rem;
        }

        .rules-table {
            width: 100%;
            border-collapse: collapse;
        }

        .rules-table th {
            background: #f7fafc;
            padding: 0.75rem 1rem;
            text-align: left;
            font-weight: 600;
            font-size: 0.85rem;
            color: #4a5568;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #e2e8f0;
        }

        .rules-table td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #e2e8f0;
        }

        .rules-table tr:hover {
            background: #f7fafc;
        }

        .rule-name {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9rem;
            color: #ef4444;
        }

        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-right: 0.5rem;
        }

        .badge-error {
            background: #fed7d7;
            color: #c53030;
        }

        .badge-warning {
            background: #feebc8;
            color: #c05621;
        }

        .file-issue {
            margin-bottom: 2rem;
            border: 2px solid #cbd5e0;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            background: white;
        }

        .file-header {
            background: #2d3748;
            color: white;
            padding: 1rem 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }

        .file-header:hover {
            background: #374151;
        }

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

        .file-collapsed .collapse-toggle {
            background: rgba(255, 255, 255, 0.1);
        }

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

        .issue {
            border-bottom: 1px solid #e2e8f0;
            padding: 1.25rem;
        }

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

        .severity-error {
            background: #fed7d7;
            color: #c53030;
        }

        .severity-warning {
            background: #feebc8;
            color: #c05621;
        }

        .issue-details {
            flex: 1;
        }

        .issue-message {
            font-size: 1rem;
            color: #2d3748;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        .issue-meta {
            display: flex;
            gap: 1.5rem;
            font-size: 0.85rem;
            color: #718096;
        }

        .issue-meta-item {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }

        .code-snippet {
            background: #0d1117;
            border-radius: 6px;
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

        .code-line.error-line {
            background: rgba(229, 62, 62, 0.15);
            border-left-color: #e53e3e;
        }

        .line-number {
            display: inline-block;
            width: 50px;
            padding: 0 1rem;
            color: #6e7681;
            text-align: right;
            user-select: none;
            flex-shrink: 0;
        }

        .error-line .line-number {
            color: #ff7b72;
            font-weight: bold;
        }

        .line-content {
            flex: 1;
            padding-right: 1rem;
            white-space: pre;
        }

        .line-content * {
            font-family: inherit;
        }

        .error-arrow {
            color: #fc8181;
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
            background: #2d3748;
            color: #a0aec0;
            cursor: pointer;
            user-select: none;
            border-top: 1px solid #4a5568;
            border-bottom: 1px solid #4a5568;
            font-size: 0.8rem;
            transition: background 0.2s, color 0.2s;
        }

        .expand-toggle:hover {
            background: #374151;
            color: #e2e8f0;
        }

        .expand-toggle-icon {
            margin-right: 0.5rem;
            font-weight: bold;
            transition: transform 0.2s;
        }

        .expand-toggle.expanded .expand-toggle-icon {
            transform: rotate(180deg);
        }

        .code-line.expandable {
            opacity: 0.85;
        }

        .no-issues {
            text-align: center;
            padding: 3rem;
            color: #48bb78;
        }

        .no-issues-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
        }

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

        .tree-folder-header:hover {
            background: #f7fafc;
        }

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

        .tree-file:hover {
            background: #edf2f7;
        }

        .tree-file.active {
            background: #e6f2ff;
            border-left: 3px solid #667eea;
        }

        .tree-icon {
            font-size: 1rem;
            flex-shrink: 0;
        }

        .folder-icon {
            transition: transform 0.2s;
        }

        .tree-folder-header.collapsed .folder-icon {
            transform: rotate(-90deg);
        }

        .tree-name {
            flex: 1;
            font-size: 0.9rem;
            color: #2d3748;
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

        .tree-badge-error {
            background: #fed7d7;
            color: #c53030;
        }

        .tree-badge-warning {
            background: #feebc8;
            color: #c05621;
        }

        .filter-info {
            background: #ebf8ff;
            border: 1px solid #90cdf4;
            border-radius: 6px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            color: #2c5282;
        }

        .filter-info strong {
            color: #2a4365;
        }
    </style>
    <script>
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
    </script>
    <style>
        @keyframes highlight {
            0% { background: #fef3c7; }
            100% { background: transparent; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 ESLint Quality Report</h1>
        <div class="subtitle">Generated on ${new Date().toLocaleString()} • src/ directory</div>
    </div>

    <div class="main-content">
        <aside class="sidebar">
            <div class="sidebar-header">📁 Files with Issues</div>
            <div class="tree-container">
                ${fileTreeHtml}
            </div>
        </aside>

        <div class="container">
        ${
          ignorePatterns.length > 0
            ? `
        <div class="filter-info">
            <strong>🔍 Filters Applied:</strong> Ignoring patterns: ${ignorePatterns.map((p) => `<code lang="typescript">${escapeHtml(p)}</code>`).join(', ')}
        </div>
        `
            : ''
        }

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
            <div class="summary-card" style="border-left-color: #805ad5;">
                <div class="label">Unused Exports</div>
                <div class="value">${tsPruneData.count}</div>
            </div>
            <div class="summary-card" style="border-left-color: #d69e2e;">
                <div class="label">Code Duplicates</div>
                <div class="value">${jscpdData.count}</div>
            </div>
        </div>

        ${
          sortedRules.length > 0
            ? `
        <div class="section">
            <div class="section-header">📋 Issues by Rule (Top ${Math.min(15, sortedRules.length)})</div>
            <div class="section-content">
                <table class="rules-table">
                    <thead>
                        <tr>
                            <th>Rule</th>
                            <th style="text-align: center;">Total</th>
                            <th style="text-align: center;">Errors</th>
                            <th style="text-align: center;">Warnings</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedRules
                          .slice(0, 15)
                          .map(
                            ([rule, stats]) => `
                        <tr>
                            <td class="rule-name">${escapeHtml(rule)}</td>
                            <td style="text-align: center; font-weight: bold;">${stats.count}</td>
                            <td style="text-align: center;">${stats.errors > 0 ? `<span class="badge badge-error">${stats.errors}</span>` : '—'}</td>
                            <td style="text-align: center;">${stats.warnings > 0 ? `<span class="badge badge-warning">${stats.warnings}</span>` : '—'}</td>
                        </tr>
                        `,
                          )
                          .join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `
            : ''
        }

        ${tsPruneData.count > 0 ? `
        <div class="section">
            <div class="section-header">🗑️ Unused Exports (ts-prune)</div>
            <div class="section-content">
                <table class="rules-table">
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
                </table>
                ${tsPruneData.count > 100 ? `<p style="margin-top: 1rem; color: #718096;">Showing first 100 of ${tsPruneData.count} unused exports</p>` : ''}
            </div>
        </div>
        ` : ''}

        ${jscpdData.count > 0 ? `
        <div class="section">
            <div class="section-header">📋 Code Duplicates (jscpd) - ${jscpdData.percentage.toFixed(2)}% duplication</div>
            <div class="section-content">
                <table class="rules-table">
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
                </table>
                ${jscpdData.count > 50 ? `<p style="margin-top: 1rem; color: #718096;">Showing first 50 of ${jscpdData.count} duplicates</p>` : ''}
            </div>
        </div>
        ` : ''}

        <div class="section">
            <div class="section-header">🔍 ESLint Issues by File</div>
            <div class="section-content">
                ${
                  totalIssues === 0
                    ? `
                <div class="no-issues">
                    <div class="no-issues-icon">✅</div>
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
                        <div class="file-issue" id="${fileId}">
                            <div class="file-header" onclick="toggleFileCollapse(this.parentElement, event)">
                                <div class="file-header-left">
                                    <div class="collapse-toggle"></div>
                                    <div class="file-path">${escapeHtml(relativePath)}</div>
                                </div>
                                <div class="file-stats">
                                    ${result.errorCount > 0 ? `<span class="badge badge-error">${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}</span>` : ''}
                                    ${result.warningCount > 0 ? `<span class="badge badge-warning">${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}</span>` : ''}
                                </div>
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
                                <div class="issue">
                                    <div class="issue-header">
                                        <div class="severity-icon severity-${isError ? 'error' : 'warning'}">
                                            ${isError ? '✕' : '⚠'}
                                        </div>
                                        <div class="issue-details">
                                            <div class="issue-message">${escapeHtml(message.message)}</div>
                                            <div class="issue-meta">
                                                <div class="issue-meta-item">
                                                    📍 Line ${message.line}:${message.column}
                                                </div>
                                                ${
                                                  message.ruleId
                                                    ? `
                                                <div class="issue-meta-item">
                                                    📋 <code lang="typescript">${escapeHtml(message.ruleId)}</code>
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
                                            <span class="expand-toggle-icon">▼</span>
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
                                            <span class="expand-toggle-icon">▼</span>
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

  console.log(`✅ HTML report generated: ${reportPath}`);
  console.log(
    `📊 Summary: ${totalIssues} total issues (${errorCount} errors, ${warningCount} warnings)`,
  );

  // Don't exit with error code to allow viewing the report even when there are errors
  process.exit(0);
}

generateHtmlLintReport().catch((error) => {
  console.error('❌ Error generating HTML lint report:', error);
  process.exit(1);
});
