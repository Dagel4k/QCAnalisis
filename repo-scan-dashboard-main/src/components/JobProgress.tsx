'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Clock, AlertCircle } from 'lucide-react';
import { AnalysisJob } from '@/types';
import { cn } from '@/lib/utils';

interface JobProgressProps {
  job: AnalysisJob;
}

export function JobProgress({ job }: JobProgressProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (job.status === 'running') {
      const interval = setInterval(() => {
        setProgress(prev => Math.min(prev + 2, 90));
      }, 1000);
      return () => clearInterval(interval);
    } else if (job.status === 'succeeded') {
      setProgress(100);
    } else if (job.status === 'failed') {
      setProgress(0);
    }
  }, [job.status]);

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
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Progreso del Análisis</CardTitle>
          <Badge 
            variant={config.variant} 
            className={cn(
              "flex items-center gap-1.5",
              job.status === 'succeeded' && "bg-green-600 hover:bg-green-700"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", job.status === 'running' && 'animate-spin')} />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(job.status === 'running' || job.status === 'succeeded') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progreso</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {hasErrors && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
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
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
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
            <ScrollArea className="h-48 w-full rounded-md border bg-muted/30">
              <div className="p-3 space-y-1 font-mono text-xs">
                {job.logs.slice(-20).map((log, i) => {
                  const isError = log.includes('[ERROR]');
                  const isSuccess = log.includes('✓') || log.includes('completado');
                  
                  return (
                    <div
                      key={i}
                      className={cn(
                        "break-words",
                        isError && "text-destructive",
                        isSuccess && "text-green-600",
                        !isError && !isSuccess && "text-foreground/80"
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
