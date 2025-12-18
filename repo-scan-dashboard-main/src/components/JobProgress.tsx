'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Clock, AlertCircle } from '@/icons';
import { AnalysisJob } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/config-client';

interface JobProgressProps {
  job: AnalysisJob;
}

export function JobProgress({ job }: JobProgressProps) {
  const progress = typeof job.progress === 'number'
    ? Math.max(0, Math.min(100, job.progress))
    : (job.status === 'succeeded' ? 100 : (job.status === 'running' ? 50 : 0));
  const [canceling, setCanceling] = useState(false);

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

  return (
    <Card className="mt-4 bg-card/50 backdrop-blur-sm border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Progreso del Análisis</CardTitle>
          <div className="flex items-center gap-2">
          <Badge 
            variant={config.variant} 
            className={cn(
              "flex items-center gap-1.5 transition-colors",
              job.status === 'succeeded' && "bg-green-600 hover:bg-green-700",
              job.status === 'running' && "bg-primary/20 text-primary border-primary/30"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", job.status === 'running' && 'animate-spin')} />
            {config.label}
          </Badge>
          {(job.status === 'running' || job.status === 'queued') && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              disabled={canceling}
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
            >
              {canceling ? 'Cancelando…' : 'Cancelar'}
            </Button>
          )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(job.status === 'running' || job.status === 'succeeded') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progreso</span>
              <span className="font-medium text-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2.5 bg-muted/50" />
          </div>
        )}

        {hasErrors && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-destructive">Errores detectados</p>
                <p className="text-xs text-destructive/80">
                  {errorLogs.length} error{errorLogs.length !== 1 ? 'es' : ''} en el registro
                </p>
              </div>
            </div>
          </div>
        )}

        {job.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
            <p className="text-sm font-medium text-destructive mb-1">Error crítico:</p>
            <p className="text-xs text-destructive/80 font-mono break-words">{job.error}</p>
          </div>
        )}

        {job.logs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Registro de ejecución</p>
              <span className="text-xs text-muted-foreground">{job.logs.length} líneas</span>
            </div>
            <ScrollArea className="h-48 w-full rounded-md border border-border/50 bg-muted/30">
              <div className="p-3 space-y-1 font-mono text-xs">
                {job.logs.slice(-50).map((log, i) => {
                  const isError = log.includes('[ERROR]');
                  const isSuccess = log.includes('✓') || log.includes('completado');
                  
                  return (
                    <div
                      key={`${job.id}-${i}-${job.logs.length}`}
                      className={cn(
                        "break-words transition-colors",
                        isError && "text-destructive",
                        isSuccess && "text-green-500",
                        !isError && !isSuccess && "text-foreground/70"
                      )}
                    >
                      {log}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {job.startedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Iniciado: {new Date(job.startedAt).toLocaleTimeString('es-ES')}
            </span>
            {job.finishedAt && (
              <>
                <span>•</span>
                <span>
                  Duración: {Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s
                </span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
