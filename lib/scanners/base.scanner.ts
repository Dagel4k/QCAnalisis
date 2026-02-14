import { IScanner, AnalysisContext } from './scanner.interface';
import { ScanResult, Issue, Severity } from './scanner.types';

export abstract class BaseScanner implements IScanner {
    abstract name: string;
    abstract version?: string;

    /**
     * Determines if the scanner is enabled.
     * Default implementation checks config.no<ToolName> (e.g. noGitleaks).
     * Subclasses can override this logic.
     */
    isEnabled(context: AnalysisContext): boolean {
        const configKey = `no${this.name.replace(/[^a-zA-Z0-9]/g, '')}`;
        return !context.config[configKey];
    }

    /**
     * Template method for running the scan.
     * Handles timing, error catching, and result formatting.
     */
    async run(context: AnalysisContext): Promise<ScanResult> {
        const start = Date.now();
        try {
            if (!this.isEnabled(context)) {
                return this.createResult('skipped', [], 0);
            }

            context.logger.log(`[${this.name}] Starting scan...`);
            const issues = await this.execute(context);
            const duration = Date.now() - start;

            context.logger.log(`[${this.name}] Completed in ${duration}ms. Found ${issues.length} issues.`);
            return this.createResult('success', issues, duration);

        } catch (error: any) {
            const duration = Date.now() - start;
            context.logger.error(`[${this.name}] Failed: ${error.message}`);
            return this.createResult('failed', [], duration, error);
        }
    }

    /**
     * Abstract method where the actual scanning logic resides.
     * @returns A promise that resolves to a list of found issues.
     */
    protected abstract execute(context: AnalysisContext): Promise<Issue[]>;

    /**
     * Helper to construct a ScanResult object.
     */
    protected createResult(
        status: 'success' | 'failed' | 'skipped' | 'timeout',
        issues: Issue[],
        durationMs: number,
        error?: Error
    ): ScanResult {
        return {
            tool: this.name,
            status,
            issues,
            durationMs,
            error
        };
    }

    /**
     * Helper to create an Issue object with defaults.
     */
    protected createIssue(
        severity: Severity,
        message: string,
        file: string,
        line: number,
        options: Partial<Issue> = {}
    ): Issue {
        return {
            tool: this.name,
            severity,
            message,
            file,
            line,
            ...options
        };
    }
}
