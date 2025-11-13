# Arquitectura del Sistema

## Visión General

Este proyecto es una aplicación full-stack que integra un analizador CLI existente de Node.js con un dashboard web interactivo.

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│    React + Vite + TypeScript + Tailwind + shadcn/ui     │
│                    (Port 8080)                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ HTTP / SSE
                 │
┌────────────────▼────────────────────────────────────────┐
│                     BACKEND API                          │
│              Express + TypeScript                        │
│                   (Port 3001)                            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Routes:                                          │  │
│  │  • GET  /api/repos                               │  │
│  │  • GET  /api/repos/:slug/reports                │  │
│  │  • POST /api/analyze                             │  │
│  │  • GET  /api/jobs/:id/status                     │  │
│  │  • GET  /api/jobs/:id/stream (SSE)               │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Job Manager (in-memory)                         │  │
│  │  • Queue management                               │  │
│  │  • Job state tracking                             │  │
│  │  • Event emitter for SSE                          │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ child_process.spawn()
                 │
┌────────────────▼────────────────────────────────────────┐
│              CLI ANALYZER (External)                     │
│    review-gitlab-branches.js                             │
│    generate-html-lint-report.js                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  1. Clone branches from GitLab                   │  │
│  │  2. Run ESLint + ts-prune + jscpd               │  │
│  │  3. Generate HTML reports                        │  │
│  │  4. Create summary.json                          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                 │
                 │ Writes to
                 │
┌────────────────▼────────────────────────────────────────┐
│                 FILESYSTEM STORAGE                       │
│                                                          │
│  storage/                                                │
│  └── [repo-slug]/                                       │
│      ├── summary.json          # Report index          │
│      └── [branch-name]/                                │
│          └── lint-report.html  # Full HTML report      │
│                                                          │
│  .work/                        # Temp clones (gitignored)│
└─────────────────────────────────────────────────────────┘
```

## Componentes Principales

### 1. Frontend (React + Vite)

**Páginas:**
- `Home.tsx` - Lista de repositorios con último estado
- `RepoDetail.tsx` - Detalle de repo, formulario de análisis, lista de reportes

**Componentes:**
- `RepoCard` - Card de repositorio con estado
- `AnalysisForm` - Formulario configurable para iniciar análisis
- `JobProgress` - Progreso en tiempo real con logs
- `ui/*` - Componentes shadcn/ui customizados

**Estado:**
- React useState/useEffect para estado local
- Fetch API para comunicación con backend
- EventSource para SSE (logs en tiempo real)

### 2. Backend (Express)

**Routes:**

```typescript
// repos.ts
GET  /api/repos
GET  /api/repos/:slug/reports
GET  /api/repos/:slug/reports/:id

// analyze.ts
POST /api/analyze
  Body: { repoSlug, options: AnalysisOptions }
  Returns: { jobId, status }

// jobs.ts
GET  /api/jobs/:id/status
GET  /api/jobs/:id/stream (SSE)
GET  /api/jobs/repo/:slug
```

**Job Manager:**
- Gestiona cola de jobs (en memoria)
- Limita concurrencia (1 job por repo)
- EventEmitter para comunicación SSE
- Tracking de estado: queued → running → succeeded/failed

**Analyzer:**
- Wrapper sobre el CLI existente
- Usa `child_process.spawn()` con args separados
- Stream de stdout/stderr a job logs
- Manejo de errores y timeouts

### 3. CLI Analyzer (Externo)

Scripts existentes no modificados:
- `review-gitlab-branches.js` - Orquestación principal
- `generate-html-lint-report.js` - Generación de reportes

**Flujo del CLI:**
1. Clona rama/MR desde GitLab (shallow clone)
2. Instala dev dependencies (opcional, via --install-dev)
3. Ejecuta ESLint con config generado
4. Ejecuta ts-prune para exports no usados
5. Ejecuta jscpd para detección de duplicados
6. Genera reporte HTML con Shiki highlighting
7. Copia reporte a --reports-dir
8. Crea/actualiza summary.json
9. Limpia clones (opcional, via --no-cleanup)

### 4. Almacenamiento

**Estructura:**
```
storage/
├── [repo-slug]/
│   ├── summary.json
│   │   {
│   │     "branches": [
│   │       { "name": "feature/x", "reportPath": "...", "isMr": true }
│   │     ],
│   │     "generatedAt": "2024-01-01T00:00:00Z"
│   │   }
│   └── [branch-name]/
│       └── lint-report.html
│
.work/
└── [temp-clones]/  # Limpiados automáticamente
```

**Persistencia:**
- No hay base de datos (v1)
- Estado de jobs en memoria (se pierde al reiniciar)
- Reportes en filesystem (permanentes)
- Preparado para migrar a Redis/BullMQ

## Flujo de Datos

### Análisis Completo

```
1. User clicks "Analizar repositorio"
   └─> AnalysisForm.onSubmit(options)

2. POST /api/analyze { repoSlug, options }
   └─> Validate repo exists
   └─> Check if repo already running
   └─> Create job { id, status: 'queued', ... }
   └─> Start runAnalysis() in background
   └─> Return { jobId }

3. Frontend connects to SSE
   └─> EventSource('/api/jobs/:id/stream')
   └─> Listen for 'log' and 'status' events

4. runAnalysis() executes
   └─> Build CLI command with args
   └─> spawn('node', [scriptPath, ...args])
   └─> Stream stdout/stderr to job.logs
   └─> On success: setJobSucceeded()
   └─> On error: setJobFailed(error)

5. CLI generates reports
   └─> Writes to storage/[slug]/
   └─> Creates summary.json

6. Job completes
   └─> SSE sends final status
   └─> Frontend fetches updated reports
   └─> Displays list of HTML reports
```

### Ver Reporte

```
1. User clicks "Ver Reporte"
   └─> Open new tab to /api/repos/:slug/reports/:id

2. Backend serves HTML
   └─> res.sendFile(reportPath)

3. Browser renders HTML report
   └─> Full ESLint + ts-prune + jscpd report
   └─> Syntax-highlighted code snippets
   └─> Interactive file tree
```

## Seguridad

### Tokens y Secrets
- GitLab token solo en servidor (.env)
- Nunca expuesto al cliente
- Usado solo por CLI via spawn args

### Input Sanitization
- Slugs validados (whitelist)
- Nombres de ramas sanitizados
- Args de spawn NUNCA concatenados en shell string
- Uso de spawn con array de args separados

### Concurrencia
- Máximo 1 análisis por repo simultáneo
- Queue en memoria (FIFO)
- Timeout configurable por análisis

## Escalabilidad

### Limitaciones Actuales (v1)
- Job queue en memoria (no persistente)
- Sin autenticación / multi-usuario
- Filesystem storage (no S3)
- Concurrencia limitada

### Migración Futura

**Job Queue:**
```typescript
// Replace in-memory queue with BullMQ
import Queue from 'bull';

const analysisQueue = new Queue('analysis', {
  redis: { host: 'localhost', port: 6379 }
});

analysisQueue.process(async (job) => {
  await runAnalysis(job.id, job.data.repoSlug, ...);
});
```

**Storage:**
```typescript
// Replace filesystem with S3
import AWS from 'aws-sdk';
const s3 = new AWS.S3();

await s3.putObject({
  Bucket: 'reports',
  Key: `${slug}/${branch}/report.html`,
  Body: htmlContent
}).promise();
```

**Database:**
```sql
-- Track jobs, reports, users
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  repo_slug VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP,
  ...
);
```

## Performance

### Optimizaciones Implementadas
- Shallow clones (--depth 1)
- Análisis paralelos (diferentes repos)
- Caching de dev dependencies
- Offline mode (skip install-dev)

### Métricas Típicas
- Clone: 10-30s (depende de tamaño)
- ESLint: 20-60s (depende de archivos)
- ts-prune + jscpd: 5-15s
- Total: ~1-2 min por rama

### Bottlenecks
- Clone de repo grande
- Install de dependencies
- ESLint en muchos archivos

### Mejoras Posibles
- Cache de clones (reusar entre análisis)
- Worker pool para análisis paralelos
- Stream de reportes (no esperar a full completion)

## Monitoreo

### Logs
```typescript
// Server logs
console.log(`[${timestamp}] Job ${id} started`);
jobManager.addLog(id, message);

// Job logs (visible en UI)
child.stdout.on('data', (data) => {
  jobManager.addLog(jobId, data.toString());
});
```

### Métricas a Trackear
- Jobs completados / fallidos
- Tiempo promedio de análisis
- Uso de disco (.work/ y storage/)
- Errores de GitLab API

### Health Checks
```
GET /api/health
{
  "status": "ok",
  "timestamp": "...",
  "jobs": {
    "running": 1,
    "queued": 0
  }
}
```

## Testing

### Backend
```bash
# Unit tests
npm test

# Integration tests con mock CLI
npm run test:integration
```

### Frontend
```bash
# Component tests
npm run test:components

# E2E con Playwright
npm run test:e2e
```

### CLI Integration
```bash
# Test real analysis
npm run test:analyze -- --repo <url>
```

## Extensiones Futuras

- [ ] Autenticación (JWT / OAuth)
- [ ] Multi-usuario con permisos
- [ ] Comparación de reportes (diff entre ramas)
- [ ] Webhooks (notificar en Slack/Discord)
- [ ] Scheduled analysis (cron jobs)
- [ ] Integración CI/CD (GitHub Actions)
- [ ] Métricas históricas (trends de calidad)
- [ ] Export de reportes (PDF, CSV)
