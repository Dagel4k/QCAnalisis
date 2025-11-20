'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, Play, Search, Loader2 } from '@/icons';
import { AnalysisOptions } from '@/types';
import { API_URL } from '@/lib/config-client';

interface AnalysisFormProps {
  repoSlug: string;
  repoUrl: string;
  onSubmit: (options: AnalysisOptions) => Promise<void>;
  disabled?: boolean;
}

interface Branch {
  name: string;
  default: boolean;
}

export function AnalysisForm({ repoSlug, repoUrl, onSubmit, disabled }: AnalysisFormProps) {
  const [mode, setMode] = useState<'mrs' | 'branches' | 'specific'>('mrs');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [mrState, setMrState] = useState<'opened' | 'merged' | 'closed'>('opened');
  const [mrTargetBranch, setMrTargetBranch] = useState('');
  const [mrLabels, setMrLabels] = useState('');
  const [ignore, setIgnore] = useState('');
  const [globs, setGlobs] = useState('');
  const [depth, setDepth] = useState('1');
  const [noCleanup, setNoCleanup] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === 'specific' || mode === 'branches') {
      fetchBranches();
    }
  }, [mode, repoSlug]);

  const fetchBranches = async () => {
    setBranchesLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/branches/${repoSlug}`);
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches || []);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setBranchesLoading(false);
    }
  };

  const filteredBranches = branches.filter(branch =>
    branch.name.toLowerCase().includes(branchSearch.toLowerCase())
  );

  const handleBranchToggle = (branchName: string) => {
    setSelectedBranches(prev =>
      prev.includes(branchName)
        ? prev.filter(b => b !== branchName)
        : [...prev, branchName]
    );
  };

  const handleSelectAll = () => {
    if (selectedBranches.length === filteredBranches.length) {
      setSelectedBranches([]);
    } else {
      setSelectedBranches(filteredBranches.map(b => b.name));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const options: AnalysisOptions = {
      mode,
      ...(mode === 'specific' && selectedBranches.length > 0 && { branches: selectedBranches }),
      ...(mode === 'branches' && branchFilter && { branchFilter }),
      ...(mode === 'mrs' && {
        mrState,
        ...(mrTargetBranch && { mrTargetBranch }),
        ...(mrLabels && { mrLabels: mrLabels.split(',').map(l => l.trim()) }),
      }),
      ...(ignore && { ignore: ignore.split(',').map(i => i.trim()) }),
      ...(globs && { globs: globs.split(',').map(g => g.trim()) }),
      depth: parseInt(depth) || 1,
      noCleanup,
    };

    try {
      await onSubmit(options);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 flex flex-col h-full">
      <div className="space-y-4">
        <div>
          <Label htmlFor="mode" className="text-sm font-medium mb-1.5 block">Modo de análisis</Label>
          <Select value={mode} onValueChange={(v) => {
            setMode(v as any);
            setSelectedBranches([]);
          }}>
            <SelectTrigger id="mode" className="h-9 border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mrs">Merge Requests</SelectItem>
              <SelectItem value="branches">Todas las ramas (filtro)</SelectItem>
              <SelectItem value="specific">Ramas específicas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === 'specific' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Seleccionar ramas</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="h-7 text-xs"
              >
                {selectedBranches.length === filteredBranches.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar ramas..."
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                className="pl-9 h-9 border-border/50"
              />
            </div>
            <ScrollArea className="h-40 rounded-md border border-border/50">
              <div className="p-2 space-y-1">
                {branchesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : filteredBranches.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {branchSearch ? 'No se encontraron ramas' : 'No hay ramas disponibles'}
                  </p>
                ) : (
                  filteredBranches.map((branch) => (
                    <div key={branch.name} className="flex items-center space-x-2.5 p-2 rounded-md hover:bg-muted/30 transition-colors group">
                      <Checkbox
                        id={`branch-${branch.name}`}
                        checked={selectedBranches.includes(branch.name)}
                        onCheckedChange={() => handleBranchToggle(branch.name)}
                        className="border-border/50"
                      />
                      <Label
                        htmlFor={`branch-${branch.name}`}
                        className="flex-1 cursor-pointer text-sm font-normal group-hover:text-foreground transition-colors"
                      >
                        <span className="font-mono text-xs">{branch.name}</span>
                        {branch.default && (
                          <span className="ml-2 text-xs text-primary/70">(default)</span>
                        )}
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            {selectedBranches.length > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                {selectedBranches.length} rama{selectedBranches.length !== 1 ? 's' : ''} seleccionada{selectedBranches.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {mode === 'branches' && (
          <div>
            <Label htmlFor="branchFilter" className="text-sm font-medium mb-1.5 block">Filtro de ramas (regex opcional)</Label>
            <Input
              id="branchFilter"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              placeholder="^feature/|^hotfix/"
              className="h-9 border-border/50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Deja vacío para analizar todas las ramas
            </p>
          </div>
        )}

        {mode === 'mrs' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="mrState" className="text-sm font-medium mb-1.5 block">Estado de MRs</Label>
              <Select value={mrState} onValueChange={(v) => setMrState(v as any)}>
                <SelectTrigger id="mrState" className="h-9 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">Abiertos</SelectItem>
                  <SelectItem value="merged">Mergeados</SelectItem>
                  <SelectItem value="closed">Cerrados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mrTargetBranch" className="text-sm font-medium mb-1.5 block">Rama destino (opcional)</Label>
              <Input
                id="mrTargetBranch"
                value={mrTargetBranch}
                onChange={(e) => setMrTargetBranch(e.target.value)}
                placeholder="development"
                className="h-9 border-border/50"
              />
            </div>
            <div>
              <Label htmlFor="mrLabels" className="text-sm font-medium mb-1.5 block">Etiquetas (separadas por coma)</Label>
              <Input
                id="mrLabels"
                value={mrLabels}
                onChange={(e) => setMrLabels(e.target.value)}
                placeholder="bug, backend"
                className="h-9 border-border/50"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/50 pt-3">
        <Dialog open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" className="w-full justify-between h-9 text-sm">
              Opciones avanzadas
              <ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Opciones avanzadas</DialogTitle>
              <DialogDescription>Ajustes opcionales para el análisis</DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-4 pr-1">
              <div>
                <Label htmlFor="ignore" className="text-sm font-medium mb-1.5 block">Patrones a ignorar</Label>
                <Textarea
                  id="ignore"
                  value={ignore}
                  onChange={(e) => setIgnore(e.target.value)}
                  placeholder="**/*.test.ts, **/__tests__/**"
                  rows={3}
                  className="border-border/50 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="globs" className="text-sm font-medium mb-1.5 block">Globs a analizar</Label>
                <Textarea
                  id="globs"
                  value={globs}
                  onChange={(e) => setGlobs(e.target.value)}
                  placeholder="src/**/*.{ts,tsx,js,jsx}"
                  rows={3}
                  className="border-border/50 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="depth" className="text-sm font-medium mb-1.5 block">Profundidad de clonación</Label>
                <Input
                  id="depth"
                  type="number"
                  min="1"
                  value={depth}
                  onChange={(e) => setDepth(e.target.value)}
                  className="h-9 border-border/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="noCleanup"
                  checked={noCleanup}
                  onCheckedChange={(checked) => setNoCleanup(checked === true)}
                  className="border-border/50"
                />
                <Label htmlFor="noCleanup" className="cursor-pointer text-sm">No limpiar clones temporales</Label>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button type="button">Guardar</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cerrar</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="pt-3 border-t border-border/50 mt-auto">
        <Button 
          type="submit" 
          className="w-full h-10 text-sm font-semibold bg-primary hover:bg-primary/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed" 
          disabled={disabled || loading || (mode === 'specific' && selectedBranches.length === 0)}
        >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Iniciando análisis...
          </>
        ) : (
          <>
            <Play className="h-5 w-5 mr-2" />
            Analizar repositorio
          </>
        )}
      </Button>
      </div>
    </form>
  );
}
