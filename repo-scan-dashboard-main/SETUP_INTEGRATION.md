# Configuración de Integración

Este documento explica cómo integrar el dashboard con el sistema de análisis existente.

## Estructura del Proyecto

```
scriptCCode/
├── bin/
│   └── review-gitlab-branches.js    # Script principal de análisis
├── generate-html-lint-report.js      # Generador de reportes HTML
├── reports/                          # Reportes generados
│   ├── summary.json
│   └── [branch-name]/
│       └── lint-report.html
└── repo-scan-dashboard-main/         # Dashboard web
    ├── server/                       # Backend Express
    └── src/                          # Frontend React
```

## Configuración Automática

El sistema detecta automáticamente:
- Rutas de scripts en la raíz del proyecto
- Directorio de reportes (`reports/`)
- Archivo `repos.json` en la raíz del proyecto

## Configuración Manual (Opcional)

Si necesitas personalizar las rutas, crea un archivo `.env` en `repo-scan-dashboard-main/`:

```env
# GitLab
GITLAB_BASE=https://gitlab.prestavale.mx/api/v4
GITLAB_TOKEN=tu_token_aqui

# Rutas (solo si la detección automática falla)
# REVIEW_SCRIPT_PATH=/ruta/absoluta/a/bin/review-gitlab-branches.js
# REPORT_SCRIPT_PATH=/ruta/absoluta/a/generate-html-lint-report.js

# Directorios
# WORK_DIR=.work
# STORAGE_DIR=reports

# Opciones
ANALYZE_OFFLINE_MODE=true
FORCE_ESLINT_CONFIG=true
DEFAULT_IGNORE=**/*.pb.ts,**/proto/**,**/node_modules/**
DEFAULT_GLOBS=src/**/*.{ts,tsx,js,jsx}
```

## Configurar Repositorios

Crea un archivo `repos.json` en la raíz del proyecto (`scriptCCode/repos.json`):

```json
[
  {
    "slug": "cajera-web",
    "name": "Cajera Web",
    "repoUrl": "https://gitlab.prestavale.mx/zazpayv2/cajera-web.git",
    "description": "Aplicación web de cajera"
  }
]
```

## Iniciar el Dashboard

Desde `repo-scan-dashboard-main/`:

```bash
npm install
npm run dev
```

Esto iniciará:
- Frontend en `http://localhost:8080`
- Backend API en `http://localhost:3001`

## Uso

1. Accede a `http://localhost:8080`
2. Selecciona un repositorio
3. Configura las opciones de análisis
4. Ejecuta el análisis
5. Visualiza los reportes generados

## Formato de Reportes

El sistema lee reportes existentes en `reports/summary.json` con el formato:

```json
{
  "repo": "https://gitlab.com/org/repo.git",
  "branches": [
    { "branch": "main", "report": "reports/main/lint-report.html" }
  ],
  "mrs": [
    {
      "iid": 107,
      "title": "Feature",
      "sourceBranch": "feature/x",
      "targetBranch": "main",
      "report": "reports/mr-107-feature-x/lint-report.html"
    }
  ]
}
```

El dashboard normaliza automáticamente este formato para su visualización.

