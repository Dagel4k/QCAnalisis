'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Clock, Terminal } from '@/icons';
import { AnalysisJob } from '@/types';
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
}

export function JobStatusCompact({ job, onViewLogs }: JobStatusCompactProps) {
  const [progress, setProgress] = useState(0);
  const [logsOpen, setLogsOpen] = useState(false);

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
    <>
      <div className="flex items-center justify-between p-3 border border-border rounded-md bg-card/30">
        <div className="flex items-center gap-3 flex-1">
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
          
          {(job.status === 'running' || job.status === 'succeeded') && (
            <div className="flex-1 max-w-[180px]">
              <Progress value={progress} className="h-1.5 bg-muted/50" />
            </div>
          )}
          
          {hasErrors && (
            <span className="text-xs text-destructive font-medium">
              {errorLogs.length} error{errorLogs.length !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
        
        {job.logs.length > 0 && (
          <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
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
                  {job.logs.length} líneas de registro
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="h-[65vh] w-full rounded-md border border-border bg-muted/30 p-4">
                <div className="space-y-1 font-mono text-xs">
                  {job.logs.map((log, i) => {
                    const isError = log.includes('[ERROR]');
                    const isSuccess = log.includes('✓') || log.includes('completado');
                    
                    return (
                      <div
                        key={`${job.id}-${i}-${job.logs.length}`}
                        className={cn(
                          "break-words",
                          isError && "text-destructive",
                          isSuccess && "text-green-500",
                          !isError && !isSuccess && "text-foreground/80"
                        )}
                      >
                        {log}
                      </div>
                    );
                  })}
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
      </div>
    </>
  );
}
