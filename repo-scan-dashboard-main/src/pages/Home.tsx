import { useEffect, useMemo, useState } from 'react';
import { Search, Code2, Loader2 } from '@/icons';
import { Input } from '@/components/ui/input';
import { RepoCard } from '@/components/repo-card';
import { RepositoryWithStatus } from '@/types';
import { API_URL } from '@/lib/config-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { HelpHint } from '@/components/help-hint';

export default function Home() {
  const [repos, setRepos] = useState<RepositoryWithStatus[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RepositoryWithStatus | null>(null);
  const [edit, setEdit] = useState({
    name: '',
    slug: '',
    repoUrl: '',
    imageUrl: '',
    description: '',
  });
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RepositoryWithStatus | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    repoUrl: '',
    imageUrl: '',
    description: '',
  });
  const [error, setError] = useState('');
  const [repoOk, setRepoOk] = useState<null | { ok: boolean; reason?: string }>(null);
  const [validatingRepo, setValidatingRepo] = useState(false);

  useEffect(() => {
    checkConfig().then((ok) => {
      if (ok) fetchRepos();
    });
  }, []);

  const checkConfig = async () => {
    try {
      const res = await fetch(`${API_URL}/api/setup/status`);
      if (res.ok) {
        const { configured } = await res.json();
        if (!configured) {
          window.location.href = '/setup';
          return false;
        }
      }
      return true;
    } catch {
      return true; // If check fails, assume ok to avoid blocking (or handle differently)
    }
  };

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

  const slugify = (s: string) => s
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  const handleChange = (key: keyof typeof form, value: string) => {
    setError('');
    if (key === 'repoUrl') {
      setRepoOk(null);
    }
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !prev.slug) {
        next.slug = slugify(value);
      }
      return next;
    });
  };

  const handleEditChange = (key: keyof typeof edit, value: string) => {
    setError('');
    setEdit(prev => ({ ...prev, [key]: value }));
  };

  const isValidHttpsGitUrl = (url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const parts = u.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
      return parts.length >= 2;
    } catch { return false; }
  };
  const isValidSshGitUrl = (url: string) => /^git@[^:]+:[^\s]+\/(?:[^\s]+?)(?:\.git)?$/i.test(url.trim());

  const validateRepoServer = async (repoUrl: string) => {
    if (!repoUrl) return;
    if (!isValidHttpsGitUrl(repoUrl) && !isValidSshGitUrl(repoUrl)) {
      setRepoOk({ ok: false, reason: 'URL inválida. Use HTTPS (recomendado) o SSH.' });
      return;
    }
    try {
      setValidatingRepo(true);
      const resp = await fetch(`${API_URL}/api/repos/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const data = await resp.json();
      setRepoOk(data);
    } catch (e) {
      setRepoOk({ ok: false, reason: 'No se pudo validar el repositorio' });
    } finally {
      setValidatingRepo(false);
    }
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // Duplicate checks before anything else
    if (hasAnyDup) {
      const msgs: string[] = [];
      if (dupName) msgs.push('El nombre ya existe');
      if (dupSlug) msgs.push('El slug ya existe');
      if (dupRepoUrl) msgs.push('La Repo URL ya existe');
      if (dupImageUrl) msgs.push('La imagen ya está asociada a otro repo');
      if (dupDescription) msgs.push('La descripción coincide con otro repo');
      setError(msgs.join(' · '));
      return;
    }
    if (!form.name || !form.slug || !form.repoUrl) {
      setError('Nombre, Slug y Repo URL son obligatorios');
      return;
    }
    // Basic client checks
    const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug);
    if (!slugOk) { setError('Slug inválido (solo minúsculas, números y guiones)'); return; }
    if (!isValidHttpsGitUrl(form.repoUrl) && !isValidSshGitUrl(form.repoUrl)) {
      setError('Repo URL inválida. Use HTTPS (recomendado) o SSH.');
      return;
    }
    if (form.imageUrl) {
      try { new URL(form.imageUrl); } catch { setError('Imagen URL inválida'); return; }
    }
    // Server-side verification before submit
    setError('');
    setValidatingRepo(true);
    const vResp = await fetch(`${API_URL}/api/repos/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: form.repoUrl.trim() }),
    }).catch(() => null);
    setValidatingRepo(false);
    if (!vResp) { setError('No se pudo validar el repositorio'); return; }
    const vData = await vResp.json();
    if (!vData?.ok) { setError(vData?.reason || 'Repositorio no verificable'); return; }
    try {
      setAdding(true);
      const resp = await fetch(`${API_URL}/api/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          repoUrl: form.repoUrl.trim(),
          imageUrl: form.imageUrl.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err?.error || 'No se pudo añadir el repositorio');
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data)) {
        setRepos(data);
      } else {
        await fetchRepos();
      }
      setOpen(false);
      setForm({ name: '', slug: '', repoUrl: '', imageUrl: '', description: '' });
      setRepoOk(null);
    } catch (err) {
      console.error(err);
      setError('Error al enviar la solicitud');
    } finally {
      setAdding(false);
    }
  };

  const openEdit = (repo: RepositoryWithStatus) => {
    setEditTarget(repo);
    setEdit({
      name: repo.name || '',
      slug: repo.slug || '',
      repoUrl: repo.repoUrl || '',
      imageUrl: repo.imageUrl || '',
      description: repo.description || '',
    });
    setError('');
    setEditOpen(true);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    // Duplicate validations excluding current target
    const excludeSlug = editTarget.slug;
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const normUrl = (s: string) => norm(s).replace(/\.git$/i, '').replace(/\/+$/g, '');
    const dupNameEdit = !!edit.name && repos.some(r => r.slug !== excludeSlug && norm(r.name) === norm(edit.name));
    const dupRepoUrlEdit = !!edit.repoUrl && repos.some(r => r.slug !== excludeSlug && normUrl(r.repoUrl) === normUrl(edit.repoUrl));
    const dupImageUrlEdit = !!edit.imageUrl && repos.some(r => r.slug !== excludeSlug && norm(r.imageUrl || '') === norm(edit.imageUrl));
    if (dupNameEdit || dupRepoUrlEdit || dupImageUrlEdit) {
      const msgs: string[] = [];
      if (dupNameEdit) msgs.push('nombre duplicado');
      if (dupRepoUrlEdit) msgs.push('URL duplicada');
      if (dupImageUrlEdit) msgs.push('imagen duplicada');
      setError(`No se puede guardar: ${msgs.join(' · ')}`);
      return;
    }
    try {
      setAdding(true);
      const resp = await fetch(`${API_URL}/api/repos/${encodeURIComponent(editTarget.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edit.name.trim(),
          // slug: edit.slug.trim(), // slug stays immutable for now
          repoUrl: edit.repoUrl.trim(),
          // Siempre enviar strings: '' limpia en el servidor
          imageUrl: (edit.imageUrl ?? '').trim(),
          description: (edit.description ?? '').trim(),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err?.error || 'No se pudo actualizar el repositorio');
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data)) setRepos(data);
      setEditOpen(false);
      setEditTarget(null);
      setEdit({ name: '', slug: '', repoUrl: '', imageUrl: '', description: '' });
    } catch (err) {
      console.error(err);
      setError('Error al actualizar el repositorio');
    } finally {
      setAdding(false);
    }
  };

  const openDelete = (repo: RepositoryWithStatus) => {
    setDeleteTarget(repo);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const resp = await fetch(`${API_URL}/api/repos/${encodeURIComponent(deleteTarget.slug)}`, { method: 'DELETE' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err?.error || 'No se pudo eliminar el repositorio');
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data)) setRepos(data);
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      setError('Error al eliminar el repositorio');
    } finally {
      setDeleting(false);
    }
  };

  const filteredRepos = repos.filter(repo =>
    repo.name.toLowerCase().includes(search.toLowerCase()) ||
    repo.description?.toLowerCase().includes(search.toLowerCase())
  );

  // ----- Duplicate detection (client-side) -----
  const norm = (s: string) => (s || '').trim().toLowerCase();
  const normUrl = (s: string) => norm(s).replace(/\.git$/i, '').replace(/\/+$/g, '');
  const dupName = useMemo(() => !!form.name && repos.some(r => norm(r.name) === norm(form.name)), [form.name, repos]);
  const dupSlug = useMemo(() => !!form.slug && repos.some(r => norm(r.slug) === norm(form.slug)), [form.slug, repos]);
  const dupRepoUrl = useMemo(() => !!form.repoUrl && repos.some(r => normUrl(r.repoUrl) === normUrl(form.repoUrl)), [form.repoUrl, repos]);
  const dupImageUrl = useMemo(() => !!form.imageUrl && repos.some(r => norm(r.imageUrl || '') === norm(form.imageUrl)), [form.imageUrl, repos]);
  const dupDescription = useMemo(() => !!form.description && repos.some(r => norm(r.description || '') === norm(form.description)), [form.description, repos]);
  const hasAnyDup = dupName || dupSlug || dupRepoUrl || dupImageUrl || dupDescription;

  // Pagination logic
  const ITEMS_PER_PAGE = 6;
  const totalPages = Math.ceil(filteredRepos.length / ITEMS_PER_PAGE) || 1;
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedRepos = filteredRepos.slice(start, end);

  // Build a fixed-width page slot model (always 5 items)
  const getFixedPageSlots = (total: number, current: number): Array<number | 'ellipsis' | 'spacer'> => {
    if (total <= 5) {
      const nums = Array.from({ length: total }, (_, i) => i + 1);
      const spacers = Array.from({ length: 5 - total }, () => 'spacer' as const);
      return [...nums, ...spacers];
    }
    if (current <= 3) {
      return [1, 2, 3, 'ellipsis', total];
    }
    if (current >= total - 2) {
      return [1, 'ellipsis', total - 2, total - 1, total];
    }
    return [1, 'ellipsis', current, 'ellipsis', total];
  };
  const pageSlots = getFixedPageSlots(totalPages, currentPage);

  useEffect(() => {
    // Reset to page 1 on search text change
    setCurrentPage(1);
  }, [search]);

  useEffect(() => {
    // Adjust current page if totalPages decreased below currentPage
    if (currentPage > totalPages) setCurrentPage(totalPages || 1);
  }, [totalPages]);

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
                Analizador de Repositorios
              </h1>
              <p className="text-muted-foreground mt-1.5">
                Revisa la calidad del código de los proyectos de la empresa
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative container mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div className="relative w-full sm:max-w-lg">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar repositorios..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 h-12 bg-card/50 border-border/50 backdrop-blur-sm text-base"
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 sm:h-12 px-5 w-full sm:w-auto">
                Añadir repo
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <form onSubmit={handleSubmitAdd} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>Añadir repositorio</DialogTitle>
                  <DialogDescription>
                    Completa los datos para agregarlo a repos.json
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="repo-name" className="flex items-center gap-1">
                      Nombre
                      <HelpHint
                        title="Nombre del repositorio"
                        brief="Cómo se mostrará en la lista."
                        detail={"Nombre legible para identificar el repositorio (no único)."}
                      />
                    </Label>
                    <Input id="repo-name" value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Mi Proyecto" className={dupName ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {dupName && (
                      <div className="text-xs text-destructive">Ya existe un repositorio con este nombre</div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="repo-slug" className="flex items-center gap-1">
                      Slug
                      <HelpHint
                        title="Slug"
                        brief="Identificador único en minúsculas."
                        detail={"Se usa en URLs y como clave interna. Solo letras, números y guiones. Ej.: mi-proyecto"}
                      />
                    </Label>
                    <Input id="repo-slug" value={form.slug} onChange={(e) => handleChange('slug', e.target.value)} placeholder="mi-proyecto" className={dupSlug ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {dupSlug && (
                      <div className="text-xs text-destructive">Ya existe un repositorio con este slug</div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="repo-url" className="flex items-center gap-1">
                      Repo URL
                      <HelpHint
                        title="URL del repositorio"
                        brief="HTTPS (recomendado) o SSH."
                        detail={"Ej.: https://gitlab.com/org/repo.git o git@gitlab.com:org/repo.git . Se valida conectividad básica."}
                      />
                    </Label>
                    <Input id="repo-url" value={form.repoUrl} onChange={(e) => handleChange('repoUrl', e.target.value)} onBlur={() => validateRepoServer(form.repoUrl)} placeholder="https://gitlab.com/org/repo.git" className={dupRepoUrl ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {dupRepoUrl && (
                      <div className="text-xs text-destructive">Esta URL ya está registrada</div>
                    )}
                    {validatingRepo && (
                      <div className="text-xs text-muted-foreground">Validando repositorio...</div>
                    )}
                    {repoOk && (
                      <div className={`text-xs ${repoOk.ok ? 'text-green-600' : 'text-destructive'}`}>
                        {repoOk.ok ? 'Repositorio verificado' : (repoOk.reason || 'Repositorio no verificable')}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="repo-image" className="flex items-center gap-1">
                      Imagen (opcional)
                      <HelpHint
                        title="Imagen del proyecto"
                        brief="URL pública de logo/imagen."
                        detail={"Se muestra en la tarjeta del repo. Ej.: https://.../logo.png"}
                      />
                    </Label>
                    <Input id="repo-image" value={form.imageUrl} onChange={(e) => handleChange('imageUrl', e.target.value)} placeholder="https://.../logo.png" className={dupImageUrl ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {dupImageUrl && (
                      <div className="text-xs text-destructive">Esta imagen ya está asociada a otro repositorio</div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="repo-desc" className="flex items-center gap-1">
                      Descripción (opcional)
                      <HelpHint
                        title="Descripción"
                        brief="Texto corto para contexto."
                        detail={"Se muestra en la tarjeta para facilitar la búsqueda y el contexto del proyecto."}
                      />
                    </Label>
                    <Textarea id="repo-desc" value={form.description} onChange={(e) => handleChange('description', e.target.value)} placeholder="Breve descripción" className={dupDescription ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {dupDescription && (
                      <div className="text-xs text-destructive">Esta descripción coincide con otro repositorio</div>
                    )}
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={adding || hasAnyDup}>
                    {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
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
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {paginatedRepos.map(repo => (
                <RepoCard key={repo.slug} repo={repo} onEdit={openEdit} onDelete={openDelete} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center w-full gap-2">
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
                    {pageSlots.map((slot, idx) => {
                      if (slot === 'ellipsis') {
                        return (
                          <PaginationItem key={`ellipsis-${idx}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        );
                      }
                      if (slot === 'spacer') {
                        return (
                          <span key={`spacer-${idx}`} className="w-9 h-9" />
                        );
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
                    })}
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
            )}
          </>
        )}
      </main>
      {/* Edit repo dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setEditTarget(null); setError(''); } }}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitEdit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Editar repositorio</DialogTitle>
              <DialogDescription>Actualiza los campos del repositorio</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-name" className="flex items-center gap-1">
                  Nombre
                  <HelpHint
                    title="Nombre del repositorio"
                    brief="Cómo se mostrará en la lista."
                    detail={"Nombre legible para identificar el repositorio (no único)."}
                  />
                </Label>
                <Input id="edit-name" value={edit.name} onChange={(e) => handleEditChange('name', e.target.value)} placeholder="Mi Proyecto" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-slug" className="flex items-center gap-1">
                  Slug
                  <HelpHint
                    title="Slug"
                    brief="Identificador único en minúsculas."
                    detail={"Se usa en URLs y como clave interna. Solo letras, números y guiones. Ej.: mi-proyecto"}
                  />
                </Label>
                <Input id="edit-slug" value={edit.slug} disabled className="opacity-70" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-url" className="flex items-center gap-1">
                  Repo URL
                  <HelpHint
                    title="URL del repositorio"
                    brief="HTTPS (recomendado) o SSH."
                    detail={"Ej.: https://gitlab.com/org/repo.git o git@gitlab.com:org/repo.git . Se valida conectividad básica."}
                  />
                </Label>
                <Input id="edit-url" value={edit.repoUrl} onChange={(e) => handleEditChange('repoUrl', e.target.value)} placeholder="https://gitlab.com/org/repo.git" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-image" className="flex items-center gap-1">
                  Imagen (opcional)
                  <HelpHint
                    title="Imagen del proyecto"
                    brief="URL pública de logo/imagen."
                    detail={"Se muestra en la tarjeta del repo. Ej.: https://.../logo.png"}
                  />
                </Label>
                <Input id="edit-image" value={edit.imageUrl} onChange={(e) => handleEditChange('imageUrl', e.target.value)} placeholder="https://.../logo.png" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-desc" className="flex items-center gap-1">
                  Descripción (opcional)
                  <HelpHint
                    title="Descripción"
                    brief="Texto corto para contexto."
                    detail={"Se muestra en la tarjeta para facilitar la búsqueda y el contexto del proyecto."}
                  />
                </Label>
                <Textarea id="edit-desc" value={edit.description} onChange={(e) => handleEditChange('description', e.target.value)} placeholder="Breve descripción" />
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={adding}>Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete repo confirm */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar repositorio</DialogTitle>
            <DialogDescription>
              ¿Confirmas eliminar "{deleteTarget?.name}"? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
