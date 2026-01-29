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
  progress?: number;
  phase?: string;
  mode: 'mrs' | 'mrs-specific' | 'branches' | 'specific';
  options: AnalysisOptions;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  logs: string[];
}

export interface AnalysisOptions {
  mode: 'mrs' | 'mrs-specific' | 'branches' | 'specific';
  branches?: string[];
  branchFilter?: string;
  mrState?: 'opened' | 'merged' | 'closed';
  mrTargetBranch?: string;
  mrLabels?: string[];
  mrsIids?: Array<number | string>;
  ignore?: string[];
  globs?: string[];
  depth?: number;
  noCleanup?: boolean;
  onlyChanged?: boolean;
  qualityGates?: {
    strict?: boolean;
    maxErrors?: number;
    maxWarnings?: number;
    maxUnusedExports?: number;
    maxDupPercent?: number;
  };
  // Advanced toggles (P1/P2)
  forceEslintConfig?: boolean;
  enableSemgrep?: boolean;
  enableGitleaks?: boolean;
  enableOsvScanner?: boolean;
  enableSecretHeuristics?: boolean;
  semgrepConfig?: string;
  maxSast?: number;
  maxSecrets?: number;
  maxDepVulns?: number;
  lightClone?: boolean;
  reuseClones?: boolean;
  cloneTimeoutMs?: number;
  fetchTimeoutMs?: number;
  cmdTimeoutMs?: number;
  // P3
  updateBaseline?: boolean;
  postMrComment?: boolean;
  // Lint plugins toggles
  disableUnicorn?: boolean;
  disableUnicornPreventAbbr?: boolean;
  disabledRules?: string;
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
  knip?: { findings?: any[] };
  architecture?: { findings?: any[] };
  jscpd?: { count: number; percentage?: number };
  security?: { count: number };
  dependencies?: { count: number };
  qualityGate?: { passed: boolean; failures?: string[] };
}

export interface HistoryEntry {
  id: string;
  type: 'mr' | 'branch';
  name: string;
  report: string;
  generatedAt: string;
  metrics?: AnalysisMetrics;
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
