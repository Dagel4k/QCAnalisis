'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Clock, Terminal } from '@/icons';
import { AnalysisJob } from '@/types';
import { API_URL } from '@/lib/config-client';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface JobStatusCompactProps {
  job: AnalysisJob;
  onViewLogs?: () => void;
  latestReportId?: string;
  repoSlug?: string;
}

export function JobStatusCompact({ job, onViewLogs, latestReportId, repoSlug }: JobStatusCompactProps) {
  const [progressLocal, setProgressLocal] = useState(0);
  const [logsOpen, setLogsOpen] = useState(false);
  const [fileLogs, setFileLogs] = useState<string | undefined>(undefined);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    if (typeof job.progress === 'number') {
      setProgressLocal(Math.max(0, Math.min(100, job.progress)));
    } else if (job.status === 'succeeded') {
      setProgressLocal(100);
    } else if (job.status !== 'running') {
      setProgressLocal(0);
    }
  }, [job.status, job.progress]);

  const statusConfig = {
    queued: {
      icon: Clock,
      label: 'En cola',
      variant: 'secondary' as const,
      color: 'text-muted-foreground',
    },
    running: {
      icon: Loader2,
      label: 'Analizando',
      variant: 'default' as const,
      color: 'text-primary',
    },
    succeeded: {
      icon: CheckCircle2,
      label: 'Completado',
      variant: 'default' as const,
      color: 'text-green-600',
    },
    failed: {
      icon: XCircle,
      label: 'Fallido',
      variant: 'destructive' as const,
      color: 'text-destructive',
    },
  };

  const config = statusConfig[job.status];
  const Icon = config.icon;
  const errorLogs = job.logs.filter(log => log.includes('[ERROR]'));
  const hasErrors = errorLogs.length > 0;
  const showSuccessActions = job.status === 'succeeded' && !!latestReportId && !!repoSlug;
  const showLogsDialog = job.status === 'succeeded' || job.logs.length > 0;

  return (
    <>
      <div className="p-3 border border-border rounded-md bg-card/30">
        <div className="flex items-center gap-3">
          <Badge 
            variant={config.variant} 
            className={cn(
              "flex items-center gap-1.5",
              job.status === 'succeeded' && "bg-green-600 hover:bg-green-700",
              job.status === 'running' && "bg-primary/20 text-primary border-primary/30"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", job.status === 'running' && 'animate-spin')} />
            {config.label}
          </Badge>
          <div className="flex-1 flex items-center gap-2">
            {(job.status === 'running' || job.status === 'succeeded') && (
              <>
                <Progress value={progressLocal} className="h-2 bg-muted/50 w-full" />
                <span className="text-xs tabular-nums text-muted-foreground min-w-[2.5rem] text-right">{Math.round(progressLocal)}%</span>
              </>
            )}
            {hasErrors && (
              <span className="text-xs text-destructive font-medium">
                {errorLogs.length} error{errorLogs.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {showLogsDialog && (
          <Dialog open={logsOpen} onOpenChange={async (open) => {
            setLogsOpen(open);
            // During running, prefer live logs; after success, load file logs for the latest report
            if (open && repoSlug && latestReportId && job.status === 'succeeded') {
              try {
                const resp = await fetch(`${API_URL}/api/repos/${repoSlug}/reports/${encodeURIComponent(latestReportId)}/logs`);
                if (resp.ok) {
                  const text = await resp.text();
                  setFileLogs(text);
                } else {
                  setFileLogs(undefined);
                }
              } catch {
                setFileLogs(undefined);
              }
            } else if (open) {
              setFileLogs(undefined);
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 h-8 text-xs">
                <Terminal className="h-3.5 w-3.5" />
                Ver Logs
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh]">
              <DialogHeader>
                <DialogTitle>Registro de Ejecución</DialogTitle>
                <DialogDescription>
                  {(() => {
                    const fileCount = fileLogs ? fileLogs.split('\n').length : 0;
                    const memCount = job.logs.length;
                    if (job.status !== 'succeeded') return `${memCount} líneas (en vivo)`;
                    // After success, prefer the richer source
                    if (fileCount >= memCount && fileCount > 0) return `${fileCount} líneas (archivo)`;
                    return `${memCount} líneas (en vivo)`;
                  })()}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="h-[65vh] w-full rounded-md border border-border bg-muted/30 p-4">
                <div className="space-y-1 font-mono text-xs whitespace-pre-wrap break-words">
                  {(() => {
                    const fileCount = fileLogs ? fileLogs.split('\n').length : 0;
                    const memCount = job.logs.length;
                    const useFile = job.status === 'succeeded' && fileLogs && fileCount >= memCount;
                    if (useFile) {
                      return fileLogs;
                    }
                    return job.logs.map((log, i) => {
                      const isError = log.includes('[ERROR]');
                      const isSuccess = log.includes('✓') || log.includes('completado');
                      return (
                        <div
                          key={`${job.id}-${i}-${job.logs.length}`}
                          className={cn(
                            isError && "text-destructive",
                            isSuccess && "text-green-500",
                            !isError && !isSuccess && "text-foreground/80"
                          )}
                        >
                          {log}
                        </div>
                      );
                    });
                  })()}
                </div>
              </ScrollArea>
              {job.error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 mt-4">
                  <p className="text-sm font-medium text-destructive mb-1">Error crítico:</p>
                  <p className="text-xs text-destructive/80 font-mono break-words">{job.error}</p>
                </div>
              )}
            </DialogContent>
          </Dialog>
          )}

          {showSuccessActions && (
            <div className="flex items-center gap-2">
              <a
                href={`${API_URL}/api/repos/${repoSlug}/reports/${encodeURIComponent(latestReportId!)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" variant="outline">Ver reporte</Button>
              </a>
            </div>
          )}

          {(job.status === 'running' || job.status === 'queued') && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              onClick={async () => {
                if (canceling) return;
                setCanceling(true);
                try {
                  await fetch(`${API_URL}/api/jobs/${job.id}/cancel`, { method: 'POST' });
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.error('Error al cancelar el job:', e);
                } finally {
                  setCanceling(false);
                }
              }}
              disabled={canceling}
            >
              {canceling ? 'Cancelando…' : 'Cancelar'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
