# Integración Completada

El dashboard ha sido integrado con el sistema de análisis existente. Los siguientes cambios se han realizado:

## Cambios Realizados

### 1. Configuración Automática (`src/lib/config.ts`)
- Detección automática del directorio raíz del proyecto
- Resolución automática de rutas de scripts
- Configuración de directorio de reportes (`reports/`)

### 2. Integración de Análisis (`src/lib/analyzer.ts`)
- Uso de scripts reales desde la raíz del proyecto
- Soporte para `--force-eslint-config`
- Variables de entorno configuradas correctamente
- Directorio de trabajo configurado

### 3. Rutas de API (`server/routes/repos.ts`)
- Normalización del formato de `summary.json` existente
- Soporte para formato antiguo y nuevo
- Búsqueda inteligente de reportes HTML
- Compatibilidad con estructura de reportes actual

### 4. Scripts de Inicio (`package.json`)
- `npm run dev`: Inicia frontend y backend en desarrollo
- `npm run start`: Inicia frontend y backend en producción

## Configuración Inicial

### 1. Crear `repos.json` en la raíz del proyecto

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

### 2. Configurar variables de entorno (opcional)

Crea `.env` en `repo-scan-dashboard-main/`:

```env
GITLAB_BASE=https://gitlab.prestavale.mx/api/v4
GITLAB_TOKEN=tu_token_aqui
ANALYZE_OFFLINE_MODE=true
FORCE_ESLINT_CONFIG=true
```

### 3. Instalar dependencias e iniciar

```bash
cd repo-scan-dashboard-main
npm install
npm run dev
```

## Uso

1. Accede a `http://localhost:8080`
2. Selecciona un repositorio de la lista
3. Configura las opciones de análisis:
   - Modo: MRs, ramas del repo, o ramas específicas
   - Opciones avanzadas: ignore, globs, depth, etc.
4. Ejecuta el análisis
5. Visualiza los reportes generados

## Estructura de Reportes

El sistema lee automáticamente los reportes existentes en `reports/summary.json` y los normaliza para su visualización en el dashboard.

Los reportes se generan en:
```
reports/
├── summary.json
├── main/
│   └── lint-report.html
└── mr-107-feature-ids/
    └── lint-report.html
```

## Notas

- Los scripts se detectan automáticamente desde la raíz del proyecto
- El directorio de reportes se configura automáticamente a `reports/`
- El formato de `summary.json` se normaliza automáticamente
- Los reportes existentes son compatibles sin cambios

