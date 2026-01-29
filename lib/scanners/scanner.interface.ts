
export interface ScanFinding {
    tool: string;
    rule: string;
    message: string;
    file: string;
    line: number;
    col?: number;
    severity?: 'error' | 'warning' | 'info';
    match?: string;
    package?: string;
    version?: string;
    type?: string;
}

export interface ScanResult {
    tool: string;
    status: 'success' | 'skipped' | 'error';
    findings: ScanFinding[];
    error?: string;
    summary?: any; // For tools like DepCruiser that return a summary object
}

export interface ScannerOptions {
    cwd: string;
    // Common overrides like "noKnip", "forceInternalEslint" etc can be passed via a config object if needed,
    // or handled by the Orchestrator deciding which Scanners to instantiate.
}

export interface Scanner {
    name: string;
    isEnabled(options: any): boolean;
    run(options: ScannerOptions): Promise<ScanResult>;
}
