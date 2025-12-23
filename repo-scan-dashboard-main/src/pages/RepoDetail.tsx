import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Calendar, AlertCircle, Code2, GitBranch } from '@/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AnalysisForm } from '@/components/analysisForm';
import { JobStatusCompact } from '@/components/jobStatusCompact';
import { toast } from '@/components/ui/sonner';
import {
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Repository, ReportSummary, AnalysisJob, AnalysisOptions, HistoryEntry } from '@/types';
import { SettingsDialog, getAnalyzerSettings } from '@/components/settingsDialog';
import { API_URL } from '@/lib/config-client';
import { cn } from '@/lib/utils';

const ITEMS_PER_PAGE = 5;

export default function RepoDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [reports, setReports] = useState<ReportSummary | null>(null);
  const [currentJob, setCurrentJob] = useState<AnalysisJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const pollingCleanupRef = useRef<(() => void) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchRepoData = useCallback(async () => {
    try {
      const [reposResponse, reportsResponse] = await Promise.all([
        fetch(`${API_URL}/api/repos`),
        fetch(`${API_URL}/api/repos/${slug}/reports`),
      ]);

      const repos = await reposResponse.json();
      const foundRepo = repos.find((r: Repository) => r.slug === slug);
      setRepo(foundRepo || null);

      const reportsData = await reportsResponse.json();
      const hasHistory = Array.isArray(reportsData.history) && reportsData.history.length > 0;
      const hasBranches = Array.isArray(reportsData.branches) && reportsData.branches.length > 0;
      setReports(hasHistory || hasBranches ? reportsData : null);
      setCurrentPage(1);
    } catch (error) {
      console.error('Error fetching repo data:', error);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) {
      fetchRepoData();
    }
    
    return () => {
      if (pollingCleanupRef.current) {
        pollingCleanupRef.current();
        pollingCleanupRef.current = null;
      }
    };
  }, [slug, fetchRepoData]);

  const historyList: HistoryEntry[] = useMemo(() => {
    if (!reports) return [] as HistoryEntry[];
    if (reports.history && reports.history.length > 0) {
      return [...reports.history].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    }
    return (reports.branches || []).map((b, i) => ({
      id: b.id || `${b.name}-${i}`,
      type: b.isMr ? 'mr' : 'branch',
      name: b.name,
      report: b.reportPath,
      generatedAt: reports.generatedAt,
    }));
  }, [reports]);

  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return historyList.slice(start, end);
  }, [historyList, currentPage]);

  const kpis = useMemo(() => {
    const totalRuns = historyList.length;
    const last = historyList[0];
    const prev = historyList[1];
    const lastIssues = last?.metrics?.totalIssues ?? 0;
    const lastErrors = last?.metrics?.errorCount ?? 0;
    const lastWarnings = last?.metrics?.warningCount ?? 0;
    const deltaIssues = prev ? lastIssues - (prev.metrics?.totalIssues ?? 0) : 0;
    const avgIssues = totalRuns > 0
      ? Math.round(
          historyList
            .map(r => r.metrics?.totalIssues)
            .filter((n): n is number => typeof n === 'number')
            .reduce((a, b) => a + b, 0) /
          (historyList.filter(r => typeof r.metrics?.totalIssues === 'number').length || 1)
        )
      : 0;
    const avgDupPerc = totalRuns > 0
      ? (
          historyList
            .map(r => r.metrics?.jscpd?.percentage)
            .filter((n): n is number => typeof n === 'number')
            .reduce((a, b) => a + b, 0) /
          (historyList.filter(r => typeof r.metrics?.jscpd?.percentage === 'number').length || 1)
        )
      : 0;
    const lastUnused = last?.metrics?.tsPrune?.count ?? 0;
    const lastGeneratedAt = last?.generatedAt || reports?.generatedAt;
    return { totalRuns, lastIssues, lastErrors, lastWarnings, deltaIssues, avgIssues, avgDupPerc, lastUnused, lastGeneratedAt };
  }, [historyList, reports]);

  const totalPages = useMemo(() => {
    return Math.ceil(historyList.length / ITEMS_PER_PAGE);
  }, [historyList]);

  const handleAnalyze = async (options: AnalysisOptions) => {
    try {
      const s = getAnalyzerSettings();
      const merged: AnalysisOptions = {
        ...options,
        forceEslintConfig: s.forceEslintConfig,
        enableSemgrep: s.enableSemgrep,
        enableGitleaks: s.enableGitleaks,
        enableOsvScanner: s.enableOsvScanner,
        enableSecretHeuristics: s.enableSecretHeuristics,
        semgrepConfig: s.semgrepConfig,
        maxSast: s.maxSast,
        maxSecrets: s.maxSecrets,
        maxDepVulns: s.maxDepVulns,
        lightClone: s.lightClone,
        reuseClones: s.reuseClones,
        cloneTimeoutMs: s.cloneTimeoutMs,
        fetchTimeoutMs: s.fetchTimeoutMs,
        cmdTimeoutMs: s.cmdTimeoutMs,
        disableUnicorn: s.disableUnicorn,
        disableUnicornPreventAbbr: s.disableUnicornPreventAbbr,
        disabledRules: s.disabledRules,
      };
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoSlug: slug, options: merged }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al iniciar análisis');
      }

      const { jobId } = await response.json();
      
      setCurrentJob({
        id: jobId,
        repoSlug: slug!,
        status: 'queued',
        mode: options.mode,
        options,
        logs: [],
      });
      
      if (pollingCleanupRef.current) {
        pollingCleanupRef.current();
      }
      pollingCleanupRef.current = pollJobStatus(jobId);
    } catch (error) {
      console.error('Error starting analysis:', error);
      toast.error('Error al iniciar análisis', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  };

  const pollJobStatus = (jobId: string) => {
    let eventSource: EventSource | null = null;
    let interval: number | undefined;

    const fetchJobStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/jobs/${jobId}/status`);
        if (!response.ok) throw new Error('Failed to fetch job status');
        const job: AnalysisJob = await response.json();
        setCurrentJob(job);
        return job;
      } catch (error) {
        console.error('Error fetching job status:', error);
        return null;
      }
    };

    const start = async () => {
      const initialJob = await fetchJobStatus();
      if (initialJob && (initialJob.status === 'succeeded' || initialJob.status === 'failed')) {
        fetchRepoData();
        return;
      }

      eventSource = new EventSource(`${API_URL}/api/jobs/${jobId}/stream`);

      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'job') {
            setCurrentJob(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                status: data.data?.status ?? prev.status,
                progress: typeof data.data?.progress === 'number' ? data.data.progress : prev.progress,
                phase: data.data?.phase ?? prev.phase,
              };
            });
            if (data.data?.status === 'succeeded' || data.data?.status === 'failed') {
              eventSource?.close();
              fetchJobStatus().then(() => fetchRepoData());
            }
          } else if (data.type === 'log') {
            setCurrentJob(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                logs: [...prev.logs, data.data],
              };
            });
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      });

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource?.close();
      };

      interval = window.setInterval(async () => {
        const job = await fetchJobStatus();
        if (job && (job.status === 'succeeded' || job.status === 'failed')) {
          if (interval) clearInterval(interval);
          eventSource?.close();
          fetchRepoData();
          pollingCleanupRef.current = null;
        }
      }, 2000);
    };

    // start polling without blocking the caller
    start();

    return () => {
      if (interval) clearInterval(interval);
      eventSource?.close();
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95 flex items-center justify-center">
        <div className="text-center space-y-6 p-8 rounded-2xl bg-card/50 border border-border/50">
          <p className="text-muted-foreground text-lg">Repositorio no encontrado</p>
          <Link to="/">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const getIssueBadgeVariant = (issues: number, errors: number, warnings: number) => {
    if (issues === 0) return 'success';
    if (errors > 0) return 'destructive';
    if (warnings > 0) return 'warning';
    return 'secondary';
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="relative border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <Link to="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver
              </Button>
            </Link>
            <div className="p-2 rounded-lg bg-primary/10">
              <Code2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {repo.name}
              </h1>
              <p className="text-muted-foreground mt-1.5">{repo.description || 'Sin descripción'}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="space-y-6">
          {/* Fila principal: Configuración + Resultados (igual altura) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-stretch min-h-0">
          <div className="lg:col-span-1 min-h-0">
            <Card className="border-border/50 h-auto lg:h-[71vh] flex flex-col overflow-hidden">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Configuración</CardTitle>
                <CardDescription className="text-xs">Configura y ejecuta un análisis</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 flex-1 flex flex-col min-h-0 lg:overflow-auto">
                <AnalysisForm
                  repoSlug={slug!}
                  repoUrl={repo.repoUrl}
                  onSubmit={handleAnalyze}
                  disabled={!!currentJob && currentJob.status === 'running'}
                />
              </CardContent>
            </Card>
            </div>

            <div className="lg:col-span-2 min-h-0">
              <Card className="border-border/50 h-auto lg:h-[71vh] flex flex-col overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Resultados del Repositorio</CardTitle>
                  <CardDescription className="text-xs">KPIs y análisis ejecutados</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>Ajustes</Button>
              </div>
            </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0 lg:overflow-hidden">
                  {/* KPIs compactos */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Issues último</p>
                      <p className="text-base font-semibold">{kpis.lastIssues}</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Tendencia</p>
                      <p className={cn(
                        "text-base font-semibold",
                        kpis.deltaIssues > 0 && "text-destructive",
                        kpis.deltaIssues < 0 && "text-green-500",
                        kpis.deltaIssues === 0 && "text-muted-foreground"
                      )}>{kpis.deltaIssues > 0 ? '+' : ''}{kpis.deltaIssues}</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Promedio</p>
                      <p className="text-base font-semibold">{kpis.avgIssues}</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Duplicación</p>
                      <p className="text-base font-semibold">{kpis.avgDupPerc ? kpis.avgDupPerc.toFixed(2) : '0.00'}%</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Total análisis</p>
                      <p className="text-base font-semibold">{kpis.totalRuns}</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 bg-card/30">
                      <p className="text-xs text-muted-foreground">Último</p>
                      <p className="text-xs font-medium">{kpis.lastGeneratedAt ? new Date(kpis.lastGeneratedAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A'}</p>
                    </div>
                  </div>
                  <div className="h-px bg-border mb-4" />
                  {!reports || historyList.length === 0 ? (
                    <Alert className="bg-muted/30 border-border/50">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        No hay reportes disponibles. Ejecuta un análisis para generar el primer reporte.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                        <div className="space-y-3 flex-1 pr-1 min-h-0 lg:overflow-auto">
                          {paginatedHistory.map((run) => {
                            const issues = run.metrics?.totalIssues ?? 0;
                            const errors = run.metrics?.errorCount ?? 0;
                            const warnings = run.metrics?.warningCount ?? 0;
                            const badgeVariant = getIssueBadgeVariant(issues, errors, warnings);
                            const gate = run.metrics?.qualityGate;
                            const idx = historyList.findIndex(r => r.id === run.id);
                            const prevRun = idx >= 0 ? historyList[idx + 1] : undefined;
                            const prevIssues = prevRun?.metrics?.totalIssues ?? undefined;
                            const delta = typeof prevIssues === 'number' ? (issues - prevIssues) : undefined;
                            const secCount = run.metrics?.security?.count ?? 0;
                            
                            return (
                              <div
                                key={run.id}
                                className="group flex flex-col sm:flex-row items-stretch sm:items-center justify-start sm:justify-between gap-3 p-4 border border-border/50 rounded-lg bg-card/30 hover:bg-card/50 hover:border-primary/30 transition-all duration-200"
                              >
                            <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
                              <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                                <GitBranch className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-semibold text-base truncate">{run.name}</h3>
                                  <Badge 
                                    variant={badgeVariant}
                                    className="text-xs"
                                  >
                                    {issues === 0 ? 'Sin issues' : `${issues} issue${issues !== 1 ? 's' : ''}`}
                                  </Badge>
                                  {gate && (
                                    <Badge
                                      variant={gate.passed ? 'success' : 'destructive'}
                                      className="text-xs"
                                      title={gate.passed ? 'Quality gate passed' : (gate.failures?.join('; ') || 'Quality gate failed')}
                                    >
                                      {gate.passed ? 'Gate: OK' : 'Gate: FAIL'}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
                                  <span>{new Date(run.generatedAt).toLocaleString('es-ES', { 
                                    day: '2-digit', 
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}</span>
                                  {run.metrics && (
                                    <>
                                      <span className={cn(errors > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                                        E: {errors}
                                      </span>
                                      <span className={cn(warnings > 0 ? 'text-warning' : 'text-muted-foreground')}>
                                        W: {warnings}
                                      </span>
                                      <span className={cn(secCount > 0 ? 'text-blue-400' : 'text-muted-foreground')}>
                                        S: {secCount}
                                      </span>
                                      {typeof delta === 'number' && (
                                        <span className={cn(delta > 0 && 'text-destructive', delta < 0 && 'text-green-500')}>
                                          Δ: {delta > 0 ? `+${delta}` : delta}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-4">
                              <a
                                href={`${API_URL}/api/repos/${slug}/reports/${encodeURIComponent(run.id)}/logs`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full sm:w-auto"
                              >
                                <Button size="sm" variant="outline" className="w-full sm:w-auto">Logs</Button>
                              </a>
                              <a
                                href={`${API_URL}/api/repos/${slug}/reports/${encodeURIComponent(run.id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full sm:w-auto"
                              >
                                <Button size="sm" variant="outline" className="gap-2 w-full sm:w-auto">
                                  <FileText className="h-4 w-4" />
                                  Ver
                                </Button>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                        </div>

                        {totalPages > 1 && (
                          <div className="pt-3 border-t border-border/50">
                            <div className="flex items-center w-full gap-2">
                              <PaginationPrevious
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (currentPage > 1) setCurrentPage(currentPage - 1);
                                }}
                                className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                              />

                              <div className="flex-1 flex items-center justify-center overflow-x-auto">
                                <div className="inline-flex items-center gap-1">
                                  {(() => {
                                    const getFixedPageSlots = (total: number, current: number): Array<number | 'ellipsis' | 'spacer'> => {
                                      if (total <= 5) {
                                        const nums = Array.from({ length: total }, (_, i) => i + 1);
                                        const spacers = Array.from({ length: 5 - total }, () => 'spacer' as const);
                                        return [...nums, ...spacers];
                                      }
                                      if (current <= 3) return [1, 2, 3, 'ellipsis', total];
                                      if (current >= total - 2) return [1, 'ellipsis', total - 2, total - 1, total];
                                      return [1, 'ellipsis', current, 'ellipsis', total];
                                    };
                                    return getFixedPageSlots(totalPages, currentPage).map((slot, idx) => {
                                      if (slot === 'ellipsis') {
                                        return (
                                          <PaginationItem key={`ellipsis-${idx}`}>
                                            <PaginationEllipsis />
                                          </PaginationItem>
                                        );
                                      }
                                      if (slot === 'spacer') {
                                        return <span key={`spacer-${idx}`} className="w-9 h-9" />;
                                      }
                                      const page = slot as number;
                                      return (
                                        <PaginationItem key={`page-${page}`}>
                                          <PaginationLink
                                            href="#"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              setCurrentPage(page);
                                            }}
                                            isActive={currentPage === page}
                                          >
                                            {page}
                                          </PaginationLink>
                                        </PaginationItem>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>

                              <PaginationNext
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                                }}
                                className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
                              />
                            </div>
                          </div>
                        )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 mt-3 border-t border-border/50">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          {reports?.generatedAt && (
                            <span>Última actualización: {new Date(reports.generatedAt).toLocaleString('es-ES')}</span>
                          )}
                        </div>
                        <span>
                          Mostrando {historyList.length === 0 ? 0 : ((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, historyList.length)} de {historyList.length}
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Estado del análisis debajo para no afectar alturas emparejadas */}
          {currentJob && (
            <div className="animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Estado del Análisis</CardTitle>
                </CardHeader>
                <CardContent>
                    <JobStatusCompact job={currentJob} latestReportId={historyList[0]?.id} repoSlug={slug!} />
                </CardContent>
              </Card>
            </div>
          )}
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </div>
      </main>
    </div>
  );
}
