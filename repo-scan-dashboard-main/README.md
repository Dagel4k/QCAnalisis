# Analizador de Repositorios GitLab

Plantilla full-stack para integrar el analizador CLI de ScriptC con un dashboard web interactivo.

## Stack Tecnológico

- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express + TypeScript
- **Integración**: Child process para invocar el CLI de análisis

## Requisitos

- Node.js 18+
- Git instalado y accesible en PATH
- Acceso a GitLab (token de API)

## Configuración Inicial

### 1. Clonar y configurar dependencias

```bash
npm install
```

### 2. Configurar repositorios

Copia el archivo de ejemplo y configura tus repositorios:

```bash
cp repos.json.example repos.json
```

Edita `repos.json` con tus repositorios:

```json
[
  {
    "slug": "mi-proyecto",
    "name": "Mi Proyecto",
    "repoUrl": "https://gitlab.com/org/mi-proyecto.git",
    "imageUrl": "https://example.com/logo.png",
    "description": "Descripción del proyecto"
  }
]
```

### 3. Configurar variables de entorno

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Edita `.env` con tus configuraciones:

```env
# GitLab
GITLAB_BASE=https://gitlab.com/api/v4
GITLAB_TOKEN=tu_token_de_gitlab

# Rutas absolutas a los scripts del analizador
REVIEW_SCRIPT_PATH=/ruta/absoluta/a/scripts/review-gitlab-branches.js
REPORT_SCRIPT_PATH=/ruta/absoluta/a/scripts/generate-html-lint-report.js

# Directorios de trabajo
WORK_DIR=.work
STORAGE_DIR=storage

# Opciones por defecto
DEFAULT_IGNORE=**/*.pb.ts,**/proto/**,**/node_modules/**
DEFAULT_GLOBS=src/**/*.{ts,tsx,js,jsx}

# (Opcional) Meta paquete de dev tools
INSTALL_DEV_SPEC=file:/ruta/a/scriptc-dev-tools-0.1.0.tgz
ANALYZE_OFFLINE_MODE=false
```

### 4. Copiar scripts del analizador

Asegúrate de tener los scripts del analizador disponibles y configura las rutas absolutas en `.env`:

- `review-gitlab-branches.js` - CLI principal
- `generate-html-lint-report.js` - Generador de reportes HTML

## Uso en Desarrollo

Inicia tanto el frontend como el backend:

```bash
npm run dev
```

Esto iniciará:
- Frontend en `http://localhost:8080`
- Backend API en `http://localhost:3001`

## Uso en Producción

### Build local

```bash
npm run build
npm run start
```

### Docker

```bash
# Build
docker build -t gitlab-analyzer .

# Run con volúmenes para persistencia
docker run -p 8080:8080 -p 3001:3001 \
  -v $(pwd)/storage:/app/storage \
  -v $(pwd)/.work:/app/.work \
  --env-file .env \
  gitlab-analyzer
```

## Estructura del Proyecto

```
├── src/                    # Frontend (React)
│   ├── components/         # Componentes React
│   ├── pages/             # Páginas
│   ├── lib/               # Utilidades compartidas
│   └── types/             # TypeScript types
├── server/                # Backend (Express)
│   ├── routes/            # API routes
│   └── index.ts           # Server entry point
├── scripts/               # Scripts del analizador (copiados)
├── storage/               # Reportes generados (gitignored)
├── .work/                 # Clones temporales (gitignored)
├── repos.json             # Configuración de repositorios
└── .env                   # Variables de entorno
```

## Flujo de Trabajo

1. **Home**: Lista todos los repositorios configurados con su último estado de análisis
2. **Detalle de Repo**: 
   - Formulario para configurar y ejecutar análisis
   - Selector de modo: MRs, ramas del repo, o ramas específicas
   - Opciones avanzadas: ignore, globs, depth, etc.
   - Progreso en tiempo real via SSE
3. **Reportes**: Lista de análisis previos con links a reportes HTML

## API Endpoints

### Repositorios

- `GET /api/repos` - Lista repositorios con último estado
- `GET /api/repos/:slug/reports` - Reportes de un repo
- `GET /api/repos/:slug/reports/:id` - Sirve reporte HTML específico

### Análisis

- `POST /api/analyze` - Inicia nuevo análisis
  ```json
  {
    "repoSlug": "mi-proyecto",
    "options": {
      "mode": "mrs",
      "mrState": "opened",
      "ignore": ["**/*.test.ts"],
      "globs": ["src/**/*.ts"]
    }
  }
  ```

### Jobs

- `GET /api/jobs/:id/status` - Estado del job
- `GET /api/jobs/:id/stream` - Stream SSE de logs
- `GET /api/jobs/repo/:slug` - Todos los jobs de un repo

## Modos de Análisis

### 1. Merge Requests
Analiza MRs abiertos (o cerrados/mergeados):
- Estado: opened, closed, merged
- Filtros: rama destino, etiquetas

### 2. Ramas del Repositorio
Lista y analiza ramas desde GitLab:
- Filtro regex para seleccionar ramas

### 3. Ramas Específicas
Analiza ramas específicas por nombre:
- Lista separada por comas

## Almacenamiento

Los reportes se guardan en filesystem:

```
storage/
└── [repo-slug]/
    ├── summary.json          # Índice de reportes
    └── [branch-or-mr]/
        └── lint-report.html  # Reporte HTML completo
```

## Seguridad

- ✅ Tokens GitLab solo en servidor (nunca expuestos al cliente)
- ✅ Spawn con argumentos separados (no shell injection)
- ✅ Validación de inputs (slugs, nombres de ramas)
- ✅ Concurrencia limitada (1 job por repo)

## Troubleshooting

### Error: "Cannot find module"
Verifica que las rutas absolutas en `.env` sean correctas.

### Error: "Repository already being analyzed"
Solo se permite un análisis por repo a la vez. Espera a que termine el actual.

### Reportes no aparecen
Verifica que `storage/[slug]/summary.json` existe y es válido JSON.

## Extensiones Futuras

- [ ] Reemplazar cola en memoria por BullMQ + Redis
- [ ] Autenticación y multi-usuario
- [ ] Comparación de reportes entre ramas
- [ ] Notificaciones vía Webhook
- [ ] Integración con CI/CD

## Licencia

MIT
