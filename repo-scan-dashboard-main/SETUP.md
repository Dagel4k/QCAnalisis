# Guía de Configuración Rápida

## Pasos para correr localmente

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar archivos de entorno

Crea el archivo `.env` (copia desde `.env.example`):
```bash
cp .env.example .env
```

**IMPORTANTE**: Edita `.env` y configura las rutas absolutas a tus scripts:

```env
GITLAB_TOKEN=tu_token_gitlab
REVIEW_SCRIPT_PATH=/ruta/absoluta/a/scripts/review-gitlab-branches.js
REPORT_SCRIPT_PATH=/ruta/absoluta/a/scripts/generate-html-lint-report.js
```

### 3. Configurar repositorios

Crea el archivo `repos.json` (copia desde `repos.json.example`):
```bash
cp repos.json.example repos.json
```

Edita `repos.json` con tus repositorios GitLab:
```json
[
  {
    "slug": "mi-proyecto",
    "name": "Mi Proyecto",
    "repoUrl": "https://gitlab.com/org/mi-proyecto.git",
    "description": "Descripción del proyecto"
  }
]
```

### 4. Copiar scripts del analizador

Tienes dos opciones:

**Opción A**: Los scripts ya están en `scripts/` (incluidos en la plantilla)
- Configura las rutas en `.env`:
  ```env
  REVIEW_SCRIPT_PATH=/ruta/completa/al/proyecto/scripts/review-gitlab-branches.js
  REPORT_SCRIPT_PATH=/ruta/completa/al/proyecto/scripts/generate-html-lint-report.js
  ```

**Opción B**: Apuntar a tu instalación existente
- Configura las rutas a tu instalación actual del CLI.

### 5. Iniciar en desarrollo
```bash
npm run dev
```

Abre tu navegador en:
- Frontend: http://localhost:8080
- API: http://localhost:3001

## Variables de Entorno Clave

### Obligatorias
- `GITLAB_TOKEN`: Token de acceso a GitLab
- `REVIEW_SCRIPT_PATH`: Ruta absoluta a review-gitlab-branches.js
- `REPORT_SCRIPT_PATH`: Ruta absoluta a generate-html-lint-report.js

### Opcionales
- `GITLAB_BASE`: Base URL de API GitLab (default: https://gitlab.com/api/v4)
- `WORK_DIR`: Directorio para clones temporales (default: .work)
- `STORAGE_DIR`: Directorio para reportes (default: storage)
- `INSTALL_DEV_SPEC`: Ruta al meta-paquete de dev tools
- `ANALYZE_OFFLINE_MODE`: true/false para skip install-dev

## Estructura de Directorios

Después de la primera ejecución:
```
.
├── storage/              # Reportes generados
│   └── [repo-slug]/
│       ├── summary.json
│       └── [branch]/
│           └── lint-report.html
├── .work/               # Clones temporales (limpiados automáticamente)
├── scripts/             # Scripts del analizador
├── repos.json           # Configuración de repos
└── .env                 # Variables de entorno
```

## Troubleshooting

### "Cannot find module" al ejecutar análisis
- Verifica que `REVIEW_SCRIPT_PATH` y `REPORT_SCRIPT_PATH` sean rutas absolutas
- Verifica que los archivos existan en esas rutas

### "Repository already being analyzed"
- Solo se permite un análisis por repo a la vez
- Espera a que termine el análisis actual

### Frontend no conecta con backend
- Verifica que el backend esté corriendo en puerto 3001
- Revisa la consola del navegador para errores CORS

### No aparecen repositorios
- Verifica que `repos.json` exista y sea JSON válido
- Revisa la consola del servidor para errores

## Siguiente Paso: Primer Análisis

1. Ve a http://localhost:8080
2. Haz clic en un repositorio
3. Selecciona modo de análisis (recomendado: "Merge Requests abiertos")
4. Haz clic en "Analizar repositorio"
5. Observa el progreso en tiempo real
6. Revisa los reportes HTML generados

¡Listo! 🚀
