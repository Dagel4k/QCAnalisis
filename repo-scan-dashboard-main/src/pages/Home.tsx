import { useEffect, useState } from 'react';
import { Search, Code2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RepoCard } from '@/components/RepoCard';
import { RepositoryWithStatus } from '@/types';
import { API_URL } from '@/lib/config-client';

export default function Home() {
  const [repos, setRepos] = useState<RepositoryWithStatus[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    try {
      const response = await fetch(`${API_URL}/api/repos`);
      const data = await response.json();
      setRepos(data);
    } catch (error) {
      console.error('Error fetching repos:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRepos = repos.filter(repo =>
    repo.name.toLowerCase().includes(search.toLowerCase()) ||
    repo.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMxYTE5MjYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMS41Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-40"></div>
      
      <header className="relative border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Code2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Analizador de Repositorios del pepe
              </h1>
              <p className="text-muted-foreground mt-1.5">
                Revisa la calidad del código de tus proyectos GitLab, fazil
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative container mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="relative max-w-lg">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar repositorios..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 h-12 bg-card/50 border-border/50 backdrop-blur-sm text-base"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center gap-2 text-muted-foreground">
              <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p>Cargando repositorios...</p>
            </div>
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex flex-col items-center gap-3 p-8 rounded-2xl bg-card/30 border border-border/50">
              <p className="text-muted-foreground text-lg">
                {search ? 'No se encontraron repositorios' : 'No hay repositorios configurados'}
              </p>
              {!search && (
                <p className="text-sm text-muted-foreground/80">
                  Configura repositorios en <code className="px-2 py-1 rounded bg-muted text-foreground font-mono text-xs">repos.json</code>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRepos.map(repo => (
              <RepoCard key={repo.slug} repo={repo} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
