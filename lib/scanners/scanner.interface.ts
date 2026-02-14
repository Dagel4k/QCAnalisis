import { Logger } from '../utils';
import { ScanResult } from './scanner.types';

export interface AnalysisContext {
    /**
     * The root directory of the repository/sandbox to analyze.
     */
    cwd: string;

    /**
     * Global configuration object.
     */
    config: any;

    /**
     * Standardized logger instance.
     */
    logger: Logger;

    /**
     * Environment variables for the analysis process.
     */
    env: NodeJS.ProcessEnv;
}

export interface IScanner {
    /**
     * unique name of the scanner.
     */
    name: string;

    /**
     * Version of the scanner tool (optional).
     */
    version?: string;

    /**
     * Determines if the scanner should run based on the current context.
     * @param context The analysis context.
     */
    isEnabled(context: AnalysisContext): boolean;

    /**
     * Executes the scanner.
     * @param context The analysis context.
     */
    run(context: AnalysisContext): Promise<ScanResult>;
}
