import * as fs from 'fs';
import * as path from 'path';
import { UnifiedAnalysisResult, ScanResult } from './scanners/scanner.types';

export interface RepoSummaryBranch {
    type: 'branch' | 'mr';
    branch: string; // or source branch
    repoUrl: string;
    slug: string; // task id or branch slug
    status: 'success' | 'failed';
    generatedAt: string;
    reportPath: string; // relative path to report
    metrics: {
        totalIssues: number;
        errorCount: number;
        warningCount: number;
        security: {
            count: number;
        };
        knip?: any;
        jscpd?: any;
        // Store individual tool stats if needed
        tools?: Record<string, { issues: number; status: string }>;
    };
}

export interface RepoSummary {
    repo: string;
    lastUpdated?: string;
    branches: RepoSummaryBranch[];
    history?: any[];
}

const MAX_HISTORY = 50;

export class SummaryManager {
    constructor(private reportsDir: string) { }

    public updateSummary(
        repoSlug: string,
        repoUrl: string,
        taskId: string,
        taskType: 'branch' | 'mr',
        targetName: string,
        result: UnifiedAnalysisResult,
        reportPath: string
    ): void {
        const repoDir = this.reportsDir;
        if (!fs.existsSync(repoDir)) {
            fs.mkdirSync(repoDir, { recursive: true });
        }

        const summaryFile = path.join(repoDir, 'summary.json');
        let summary: RepoSummary;

        try {
            if (fs.existsSync(summaryFile)) {
                summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
            } else {
                summary = {
                    repo: repoUrl,
                    branches: []
                };
            }
        } catch (e) {
            console.error(`[SummaryManager] Failed to read existing summary, starting fresh: ${e}`);
            summary = {
                repo: repoUrl,
                branches: []
            };
        }

        // Calculate Metrics
        const metrics = this.calculateMetrics(result);

        // Create new entry
        const entry: RepoSummaryBranch = {
            type: taskType,
            branch: targetName,
            repoUrl: repoUrl,
            slug: taskId,
            status: 'success', // If we are reporting results, it succeeded
            generatedAt: result.generatedAt,
            reportPath: reportPath, // This should be relative to storageDir usually, or absolute
            metrics: metrics
        };

        // Update Branches List
        // If an entry for this branch exists, replace it, move old to history?
        // For now, looking at existing summary.json, it seems to keep one entry per branch?
        // Or maybe it appends? 'branches' usually implies active branches.

        // Update Branches List & History
        const existingIdx = summary.branches.findIndex(b => b.branch === targetName && b.type === taskType);

        if (!summary.history) summary.history = [];

        // Create History Entry from the NEW result (since we want all runs in history)
        // Or should we only push the OLD one?
        // Dashboard likely wants a log of all runs.
        const historyEntry = {
            id: entry.slug,
            type: entry.type,
            name: entry.branch,
            report: entry.reportPath,
            generatedAt: entry.generatedAt,
            metrics: entry.metrics
        };
        summary.history.unshift(historyEntry);

        if (existingIdx !== -1) {
            summary.branches[existingIdx] = entry;
        } else {
            summary.branches.push(entry);
        }

        // Limit history
        if (summary.history.length > MAX_HISTORY) {
            summary.history = summary.history.slice(0, MAX_HISTORY);
        }

        summary.lastUpdated = new Date().toISOString();

        fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    }

    private calculateMetrics(result: UnifiedAnalysisResult): RepoSummaryBranch['metrics'] {
        const { totalErrors, totalWarnings } = result.summary;

        // Security Count: Gitleaks + OSV + Semgrep(security rules?)
        // For now, let's sum issues from tools named 'Gitleaks', 'OSV-Scanner'
        let securityCount = 0;
        let knipData: any = null;
        let jscpdData: any = null;
        const tools: Record<string, { issues: number; status: string }> = {};

        result.results.forEach(scan => {
            tools[scan.tool] = {
                issues: scan.issues.length,
                status: scan.status
            };

            if (['Gitleaks', 'OSV-Scanner'].includes(scan.tool)) {
                securityCount += scan.issues.length;
            }
            if (scan.tool === 'Semgrep') {
                // Assuming all semgrep findings are security/quality? 
                // Let's count them for now or verify rule types.
                // For simplicity, count them as security/quality mix.
                // If we want strict "Security" count, maybe only 'critical'/'high'?
                const securityIssues = scan.issues.filter(i => ['critical', 'high'].includes(i.severity));
                securityCount += securityIssues.length;
            }

            if (scan.tool === 'Knip') {
                // Map back to format expected by dashboard?
                // Dashboard likely calculates from findings.
                knipData = {
                    status: scan.status,
                    findings: scan.issues // Issue[] matches structure somewhat
                };
            }

            if (scan.tool === 'JSCPD') {
                jscpdData = {
                    status: scan.status,
                    count: scan.issues.length,
                    duplicates: scan.issues.map(i => ({
                        // Attempt to reconstruct duplication info if available in context
                        ...i.context
                    }))
                };
            }
        });

        return {
            totalIssues: totalErrors + totalWarnings,
            errorCount: totalErrors,
            warningCount: totalWarnings,
            security: {
                count: securityCount
            },
            knip: knipData,
            jscpd: jscpdData,
            tools
        };
    }
}
