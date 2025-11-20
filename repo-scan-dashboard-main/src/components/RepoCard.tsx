import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RepositoryWithStatus } from '@/types';
import { GitBranch, CheckCircle2, XCircle, Clock, ArrowRight } from '@/icons';
import { cn } from '@/lib/utils';

interface RepoCardProps {
  repo: RepositoryWithStatus;
}

export function RepoCard({ repo }: RepoCardProps) {
  const statusConfig = {
    succeeded: { 
      icon: CheckCircle2, 
      label: 'Exitoso', 
      variant: 'default' as const,
      className: 'bg-green-500/10 text-green-400 border-green-500/20'
    },
    failed: { 
      icon: XCircle, 
      label: 'Fallido', 
      variant: 'destructive' as const,
      className: 'bg-destructive/10 text-destructive border-destructive/20'
    },
  };

  const status = repo.lastAnalysis
    ? statusConfig[repo.lastAnalysis.status]
    : null;

  return (
    <Link to={`/repos/${repo.slug}`}>
      <Card className="group h-full transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 hover:-translate-y-1 bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <GitBranch className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-xl font-semibold truncate group-hover:text-primary transition-colors">
                  {repo.name}
                </CardTitle>
              </div>
              <CardDescription className="line-clamp-2 mt-1">
                {repo.description || 'Sin descripción'}
              </CardDescription>
            </div>
            {repo.imageUrl && (
              <img
                src={repo.imageUrl}
                alt={repo.name}
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
                className="h-12 w-12 rounded-lg object-cover border border-border/50"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {repo.lastAnalysis ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {status && (
                  <Badge 
                    variant={status.variant} 
                    className={cn("flex items-center gap-1.5", status.className)}
                  >
                    <status.icon className="h-3.5 w-3.5" />
                    {status.label}
                  </Badge>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {new Date(repo.lastAnalysis.date).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-sm text-muted-foreground">
                  {repo.lastAnalysis.branchCount} {repo.lastAnalysis.branchCount === 1 ? 'rama analizada' : 'ramas analizadas'}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Sin análisis previos</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
