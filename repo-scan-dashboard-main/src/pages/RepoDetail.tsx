import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Calendar, AlertCircle, Code2, Activity, ListChecks, Bug, TrendingUp, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AnalysisForm } from '@/components/AnalysisForm';
import { JobProgress } from '@/components/JobProgress';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Repository, ReportSummary, AnalysisJob, AnalysisOptions, HistoryEntry } from '@/types';
import { API_URL } from '@/lib/config-client';

const ITEMS_PER_PAGE = 10;

export default function RepoDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [reports, setReports] = useState<ReportSummary | null>(null);
  const [currentJob, setCurrentJob] = useState<AnalysisJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (slug) {
      fetchRepoData();
    }
  }, [slug]);

  const fetchRepoData = async () => {
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
  };

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
    return { totalRuns, lastIssues, lastErrors, lastWarnings, deltaIssues, avgIssues, avgDupPerc, lastUnused };
  }, [historyList]);

  const totalPages = useMemo(() => {
    return Math.ceil(historyList.length / ITEMS_PER_PAGE);
  }, [historyList]);

  const handleAnalyze = async (options: AnalysisOptions) => {
    try {
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoSlug: slug, options }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al iniciar análisis');
      }

      const { jobId } = await response.json();
      pollJobStatus(jobId);
    } catch (error) {
      console.error('Error starting analysis:', error);
      alert(error instanceof Error ? error.message : 'Error al iniciar análisis');
    }
  };

  const pollJobStatus = async (jobId: string) => {
    const eventSource = new EventSource(`${API_URL}/api/jobs/${jobId}/stream`);

    eventSource.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'status') {
        if (data.data === 'succeeded' || data.data === 'failed') {
          eventSource.close();
          fetchRepoData();
        }
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/jobs/${jobId}/status`);
        const job: AnalysisJob = await response.json();
        setCurrentJob(job);

        if (job.status === 'succeeded' || job.status === 'failed') {
          clearInterval(interval);
          fetchRepoData();
        }
      } catch (error) {
        clearInterval(interval);
      }
    }, 2000);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMxYTE5MjYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMS41Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-40"></div>
      
      <header className="relative border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 bg-transparent border border-transparent hover:border-primary/20 hover:bg-primary hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver
              </Button>
            </Link>
            <div className="p-3 rounded-xl bg-primary/10">
              <Code2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
                {repo.name}
              </h1>
              <p className="text-muted-foreground">{repo.description || 'Sin descripción'}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative container mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardHeader>
                <CardTitle className="text-xl">Nuevo Análisis</CardTitle>
                <CardDescription>Configura y ejecuta un análisis del repositorio</CardDescription>
              </CardHeader>
              <CardContent>
                <AnalysisForm
                  repoSlug={slug!}
                  repoUrl={repo.repoUrl}
                  onSubmit={handleAnalyze}
                  disabled={!!currentJob && currentJob.status === 'running'}
                />
              </CardContent>
            </Card>

            {currentJob && (
              <JobProgress job={currentJob} />
            )}
          </div>

          <div className="lg:col-span-2">
            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardHeader>
                <CardTitle className="text-xl">Reportes Disponibles</CardTitle>
                <CardDescription>Historial de análisis del repositorio</CardDescription>
              </CardHeader>
              <CardContent>
                {/* KPIs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Análisis</p>
                      <p className="text-2xl font-semibold">{kpis.totalRuns}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Activity className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Último: Issues</p>
                      <p className="text-2xl font-semibold">{kpis.lastIssues}</p>
                      <p className="text-[11px] text-muted-foreground">E: {kpis.lastErrors} · W: {kpis.lastWarnings}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <ListChecks className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Tendencia issues</p>
                      <p className={`text-2xl font-semibold ${kpis.deltaIssues > 0 ? 'text-red-500' : kpis.deltaIssues < 0 ? 'text-green-500' : ''}`}>
                        {kpis.deltaIssues > 0 ? '+' : ''}{kpis.deltaIssues}
                      </p>
                      <p className="text-[11px] text-muted-foreground">vs análisis anterior</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <TrendingUp className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Promedio issues</p>
                      <p className="text-2xl font-semibold">{kpis.avgIssues}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Bug className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Duplicación media</p>
                      <p className="text-2xl font-semibold">{kpis.avgDupPerc ? kpis.avgDupPerc.toFixed(2) : '0.00'}%</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Percent className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Exports sin uso (últ.)</p>
                      <p className="text-2xl font-semibold">{kpis.lastUnused}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                </div>

                {!reports || historyList.length === 0 ? (
                  <Alert className="bg-muted/30 border-border/50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No hay reportes disponibles. Ejecuta un análisis para generar el primer reporte.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="space-y-3 mb-6">
                      {paginatedHistory.map((run) => (
                        <div
                          key={run.id}
                          className="group flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 hover:border-primary/30 transition-all duration-200"
                        >
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                              <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{run.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{new Date(run.generatedAt).toLocaleString('es-ES')}</p>
                              {run.metrics && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {run.metrics.totalIssues ?? 0} issues · {run.metrics.errorCount ?? 0} errores · {run.metrics.warningCount ?? 0} warnings
                                </p>
                              )}
                            </div>
                          </div>
                          <a
                            href={`${API_URL}/api/repos/${slug}/reports/${encodeURIComponent(run.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button size="sm" className="gap-2">
                              Ver Reporte
                            </Button>
                          </a>
                        </div>
                      ))}
                    </div>

                    {totalPages > 1 && (
                      <div className="mt-6 pt-6 border-t border-border/50">
                        <Pagination>
                          <PaginationContent>
                            <PaginationItem>
                              <PaginationPrevious
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (currentPage > 1) setCurrentPage(currentPage - 1);
                                }}
                                className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                              />
                            </PaginationItem>
                            
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                              if (
                                page === 1 ||
                                page === totalPages ||
                                (page >= currentPage - 1 && page <= currentPage + 1)
                              ) {
                                return (
                                  <PaginationItem key={page}>
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
                              } else if (page === currentPage - 2 || page === currentPage + 2) {
                                return (
                                  <PaginationItem key={page}>
                                    <PaginationEllipsis />
                                  </PaginationItem>
                                );
                              }
                              return null;
                            })}

                            <PaginationItem>
                              <PaginationNext
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                                }}
                                className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
                              />
                            </PaginationItem>
                          </PaginationContent>
                        </Pagination>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-sm text-muted-foreground pt-4 mt-4 border-t border-border/50">
                      {reports?.generatedAt && (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>Última actualización: {new Date(reports.generatedAt).toLocaleString('es-ES')}</span>
                        </div>
                      )}
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
      </main>
    </div>
  );
}
