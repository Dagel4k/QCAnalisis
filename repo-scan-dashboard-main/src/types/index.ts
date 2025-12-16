export interface Repository {
  slug: string;
  name: string;
  repoUrl: string;
  imageUrl?: string;
  description?: string;
}

export interface AnalysisJob {
  id: string;
  repoSlug: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  mode: 'mrs' | 'branches' | 'specific';
  options: AnalysisOptions;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  logs: string[];
}

export interface AnalysisOptions {
  mode: 'mrs' | 'branches' | 'specific';
  branches?: string[];
  branchFilter?: string;
  mrState?: 'opened' | 'merged' | 'closed';
  mrTargetBranch?: string;
  mrLabels?: string[];
  ignore?: string[];
  globs?: string[];
  depth?: number;
  noCleanup?: boolean;
  onlyChanged?: boolean; // analyze only changed files in MRs
  qualityGates?: {
    strict?: boolean;
    maxErrors?: number;
    maxWarnings?: number;
    maxUnusedExports?: number;
    maxDupPercent?: number;
  };
}

export interface ReportSummary {
  branches: BranchReport[];
  generatedAt: string;
  history?: HistoryEntry[];
}

export interface BranchReport {
  name: string;
  reportPath: string;
  isMr?: boolean;
  mrNumber?: string;
  id?: string;
}

export interface AnalysisMetrics {
  generatedAt?: string;
  filesAnalyzed?: number;
  totalIssues?: number;
  errorCount?: number;
  warningCount?: number;
  tsPrune?: { count: number };
  jscpd?: { count: number; percentage?: number };
  qualityGate?: { passed: boolean; failures?: string[] };
}

export interface HistoryEntry {
  id: string;            // unique run id (folder name)
  type: 'mr' | 'branch';
  name: string;          // branch or sourceBranch
  report: string;        // relative path to html
  generatedAt: string;   // ISO
  metrics?: AnalysisMetrics;
  // MR-specific optional fields
  iid?: number | string;
  title?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface RepositoryWithStatus extends Repository {
  lastAnalysis?: {
    date: string;
    status: 'succeeded' | 'failed';
    branchCount: number;
  };
}
