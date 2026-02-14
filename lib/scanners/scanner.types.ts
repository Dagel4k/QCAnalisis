export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Issue {
    /**
     * The name of the tool that found the issue (e.g., 'ESLint', 'Gitleaks').
     */
    tool: string;

    /**
     * Normalized severity of the issue.
     */
    severity: Severity;

    /**
     * Human-readable description of the issue.
     */
    message: string;

    /**
     * Relative path to the file containing the issue.
     */
    file: string;

    /**
     * Line number (1-based).
     */
    line: number;

    /**
     * Column number (1-based, optional).
     */
    col?: number;

    /**
     * The offending code snippet (optional).
     */
    snippet?: string;

    /**
     * The rule ID violation (e.g., '@typescript-eslint/no-explicit-any').
     */
    code?: string;

    /**
     * Additional metadata or context for the issue.
     */
    context?: Record<string, any>;
}

export interface ScanResult {
    /**
     * The name of the tool that performed the scan.
     */
    tool: string;

    /**
     * Duration of the scan in milliseconds.
     */
    durationMs: number;

    /**
     * Status of the scan execution.
     */
    status: 'success' | 'failed' | 'skipped' | 'timeout';

    /**
     * List of issues found (if any).
     */
    issues: Issue[];

    /**
     * Error object if the scan failed.
     */
    error?: Error;
}

export interface UnifiedAnalysisResult {
    generatedAt: string;
    durationMs: number;
    results: ScanResult[];
    summary: {
        totalFiles: number;
        totalErrors: number;
        totalWarnings: number;
    };
}

