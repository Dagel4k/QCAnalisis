'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { HelpCircle } from '@/icons';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type AnalyzerSettings = {
  forceEslintConfig: boolean;
  enableSemgrep: boolean;
  enableGitleaks: boolean;
  enableOsvScanner: boolean;
  enableSecretHeuristics: boolean;
  semgrepConfig: string;
  maxSast?: number;
  maxSecrets?: number;
  maxDepVulns?: number;
  lightClone: boolean;
  reuseClones: boolean;
  cloneTimeoutMs?: number;
  fetchTimeoutMs?: number;
  cmdTimeoutMs?: number;
};

const STORAGE_KEY = 'analyzerSettings';

const defaultSettings: AnalyzerSettings = {
  forceEslintConfig: false,
  enableSemgrep: true,
  enableGitleaks: true,
  enableOsvScanner: true,
  enableSecretHeuristics: true,
  semgrepConfig: 'p/ci',
  maxSast: undefined,
  maxSecrets: undefined,
  maxDepVulns: undefined,
  lightClone: false,
  reuseClones: false,
  cloneTimeoutMs: undefined,
  fetchTimeoutMs: undefined,
  cmdTimeoutMs: undefined,
};

function loadSettings(): AnalyzerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [s, setS] = useState<AnalyzerSettings>(defaultSettings);
  const [helpOpen, setHelpOpen] = useState<null | { title: string; detail: string }>(null);

  const Help: React.FC<{ title: string; brief: string; detail: string }> = ({ title, brief, detail }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setHelpOpen({ title, detail })}
          className="inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground"
          aria-label={`Más info: ${title}`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{brief}</TooltipContent>
    </Tooltip>
  );

  useEffect(() => {
    if (open) setS(loadSettings());
  }, [open]);

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    onOpenChange(false);
  };
  const reset = () => setS({ ...defaultSettings });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajustes del Analizador</DialogTitle>
          <DialogDescription>Opciones que pueden afectar resultados o performance</DialogDescription>
        </DialogHeader>

        <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div className="space-y-3 p-3 rounded-md border">
            <p className="text-sm font-medium">Reglas y formatos</p>
            <div className="flex items-center gap-2">
              <Checkbox id="forceEslintConfig" checked={s.forceEslintConfig} onCheckedChange={(v) => setS({ ...s, forceEslintConfig: v === true })} />
              <Label htmlFor="forceEslintConfig" className="text-sm flex items-center gap-1">
                Forzar configuración interna de ESLint
                <Help title="ESLint interno"
                  brief="Usa una configuración mínima interna cuando la del proyecto falla o es incompatible."
                  detail="Activa un conjunto mínimo de reglas soportadas, útil cuando falta la config del proyecto (por ejemplo, presets no instalados). Puede cambiar el conteo de issues respecto a la config original." />
              </Label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="semgrepConfig" className="flex items-center gap-1">
                Semgrep config
                <Help title="Configuración de Semgrep"
                  brief="Selecciona la política de reglas de Semgrep (p/ci por defecto)."
                  detail="Puedes usar 'p/ci', reglas públicas o tu propio repositorio de reglas. Afecta el número y tipo de hallazgos SAST." />
              </Label>
              <Input id="semgrepConfig" value={s.semgrepConfig} onChange={(e) => setS({ ...s, semgrepConfig: e.target.value })} placeholder="p/ci" />
            </div>
          </div>

          <div className="space-y-3 p-3 rounded-md border">
            <p className="text-sm font-medium">Herramientas</p>
            <div className="flex items-center gap-2">
              <Checkbox id="enableSemgrep" checked={s.enableSemgrep} onCheckedChange={(v) => setS({ ...s, enableSemgrep: v === true })} />
              <Label htmlFor="enableSemgrep" className="text-sm flex items-center gap-1">
                Ejecutar Semgrep (SAST)
                <Help title="Semgrep"
                  brief="Escaneo SAST multi-reglas para detectar vulnerabilidades comunes."
                  detail="Semgrep ejecuta reglas estáticas (SAST) sobre el código. Habilitarlo aumenta cobertura de seguridad pero también tiempo de análisis. Configurable con reglas propias." />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="enableGitleaks" checked={s.enableGitleaks} onCheckedChange={(v) => setS({ ...s, enableGitleaks: v === true })} />
              <Label htmlFor="enableGitleaks" className="text-sm flex items-center gap-1">
                Ejecutar Gitleaks (secretos)
                <Help title="Gitleaks"
                  brief="Detecta credenciales y secretos expuestos."
                  detail="Gitleaks analiza archivos en búsqueda de tokens, keys y secretos. Puede aumentar el tiempo del análisis en repos grandes. Conviene habilitarlo en pipelines protegidos." />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="enableOsvScanner" checked={s.enableOsvScanner} onCheckedChange={(v) => setS({ ...s, enableOsvScanner: v === true })} />
              <Label htmlFor="enableOsvScanner" className="text-sm flex items-center gap-1">
                Ejecutar OSV-Scanner (dependencias)
                <Help title="OSV-Scanner"
                  brief="Evalúa vulnerabilidades en dependencias (OSV)."
                  detail="OSV analiza manifests/lockfiles para detectar dependencias vulnerables según OSV. Aumenta cobertura de seguridad sin afectar ESLint. Puede generar hallazgos que no están en el código fuente." />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="enableSecretHeuristics" checked={s.enableSecretHeuristics} onCheckedChange={(v) => setS({ ...s, enableSecretHeuristics: v === true })} />
              <Label htmlFor="enableSecretHeuristics" className="text-sm flex items-center gap-1">
                Escaneo heurístico de secretos
                <Help title="Heurísticos de secretos"
                  brief="Patrones simples para encontrar posibles secretos."
                  detail="Usa regex para detectar tokens tipo AWS/GitHub/JWT/etc. Puede producir falsos positivos. Recomendado combinar con Gitleaks." />
              </Label>
            </div>
          </div>

          <div className="space-y-3 p-3 rounded-md border">
            <p className="text-sm font-medium">Quality Gates</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maxSast" className="text-xs flex items-center gap-1">Máx. SAST
                  <Help title="Gate SAST"
                    brief="Número máximo de hallazgos SAST permitidos."
                    detail="Si los hallazgos SAST superan este número, el quality gate falla y el job sale con error. Permite endurecer la política de seguridad." />
                </Label>
                <Input id="maxSast" type="number" value={s.maxSast ?? ''} onChange={(e) => setS({ ...s, maxSast: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="maxSecrets" className="text-xs flex items-center gap-1">Máx. secretos
                  <Help title="Gate secretos"
                    brief="Número máximo de secretos detectados."
                    detail="Si el número de secretos (heurísticos + Gitleaks) excede el límite, el quality gate falla. Útil para evitar credenciales expuestas." />
                </Label>
                <Input id="maxSecrets" type="number" value={s.maxSecrets ?? ''} onChange={(e) => setS({ ...s, maxSecrets: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="maxDepVulns" className="text-xs flex items-center gap-1">Máx. dep. vulnerables
                  <Help title="Gate dependencias"
                    brief="Número máximo de vulnerabilidades en dependencias."
                    detail="Si las vulnerabilidades reportadas por OSV-Scanner superan el límite, el quality gate falla. Recomendado para pipelines de release." />
                </Label>
                <Input id="maxDepVulns" type="number" value={s.maxDepVulns ?? ''} onChange={(e) => setS({ ...s, maxDepVulns: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="space-y-3 p-3 rounded-md border">
            <p className="text-sm font-medium">Performance</p>
            <div className="flex items-center gap-2">
              <Checkbox id="lightClone" checked={s.lightClone} onCheckedChange={(v) => setS({ ...s, lightClone: v === true })} />
              <Label htmlFor="lightClone" className="text-sm flex items-center gap-1">
                Clonado ligero (filter=blob:none)
                <Help title="Clonado ligero"
                  brief="Reduce la transferencia de Git descargando blobs on‑demand."
                  detail="Clona con --filter=blob:none. Acelera repos grandes sin cambiar resultados, salvo que se pierda conectividad a mitad del análisis." />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="reuseClones" checked={s.reuseClones} onCheckedChange={(v) => setS({ ...s, reuseClones: v === true })} />
              <Label htmlFor="reuseClones" className="text-sm flex items-center gap-1">
                Reusar clones (fetch/reset/clean)
                <Help title="Reuso de clones"
                  brief="Acelera ejecuciones reusando el clone con fetch/reset/clean."
                  detail="Evita reclonar. Se hace fetch --prune, reset --hard a la ref y clean -fdx para exactitud. Recomendado en runners persistentes." />
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="cloneTimeoutMs" className="text-xs flex items-center gap-1">Clone timeout (ms)
                  <Help title="Timeout de clonación"
                    brief="Tiempo máximo para 'git clone' antes de abortar."
                    detail="Evita que el job quede colgado por redes lentas o credenciales. Valor por defecto 300000 ms si no se especifica." />
                </Label>
                <Input id="cloneTimeoutMs" type="number" value={s.cloneTimeoutMs ?? ''} onChange={(e) => setS({ ...s, cloneTimeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="fetchTimeoutMs" className="text-xs flex items-center gap-1">Fetch timeout (ms)
                  <Help title="Timeout de fetch"
                    brief="Tiempo máximo para 'git fetch' antes de abortar."
                    detail="Controla la duración del fetch cuando se reusan clones o se consultan refs adicionales. Valor por defecto 120000 ms." />
                </Label>
                <Input id="fetchTimeoutMs" type="number" value={s.fetchTimeoutMs ?? ''} onChange={(e) => setS({ ...s, fetchTimeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="cmdTimeoutMs" className="text-xs flex items-center gap-1">Cmd timeout (ms)
                  <Help title="Timeout general"
                    brief="Límite predeterminado para otros comandos."
                    detail="Se aplica como fallback para comandos envueltos por el runner. Útil para cortar procesos colgados." />
                </Label>
                <Input id="cmdTimeoutMs" type="number" value={s.cmdTimeoutMs ?? ''} onChange={(e) => setS({ ...s, cmdTimeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            </div>
          </div>
        </div>
        </TooltipProvider>

        <div className="flex items-center justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={reset}>Restablecer</Button>
          <Button onClick={save}>Guardar</Button>
        </div>

        {helpOpen && (
          <Dialog open={!!helpOpen} onOpenChange={() => setHelpOpen(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{helpOpen.title}</DialogTitle>
              </DialogHeader>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                {helpOpen.detail}
              </div>
              <div className="flex justify-end mt-3">
                <Button variant="outline" onClick={() => setHelpOpen(null)}>Cerrar</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function getAnalyzerSettings(): AnalyzerSettings {
  return loadSettings();
}
