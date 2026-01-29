# ScriptC - Analizador de Código Local

> **Análisis estático de código TypeScript/JavaScript** con ESLint, Knip, Semgrep, Gitleaks y más.  
> **100% Local. 100% Privado. $0 de costo.**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## 🎯 ¿Qué es ScriptC?

Una herramienta **local-first** para analizar la calidad de código de proyectos TypeScript/JavaScript. Ejecuta múltiples scanners en paralelo y genera reportes HTML profesionales con código resaltado.

### ✨ Características

- ✅ **6 Scanners Integrados**: ESLint, Knip, Semgrep, Gitleaks, JSCPD, OSV-Scanner
- ✅ **Reportes HTML Interactivos**: Con syntax highlighting y filtros
- ✅ **Dashboard Web Local**: React + Vite con progreso en tiempo real
- ✅ **Integración GitLab**: Analiza MRs y ramas automáticamente
- ✅ **CLI Potente**: Para análisis batch y automatización
- ✅ **100% Privado**: Todo ejecuta en tu máquina, cero servidores externos
- ✅ **Cero Costo**: Sin infraestructura cloud ni bases de datos

### 🔍 ¿Qué Detecta?

| Scanner | Detecta |
|---------|---------|
| **ESLint** | Errores de sintaxis, bad practices, code smells |
| **Knip** | Exports sin usar, dependencias huérfanas, archivos muertos |
| **Semgrep** | Vulnerabilidades de seguridad (SQL injection, XSS, etc.) |
| **Gitleaks** | Secretos hardcodeados (API keys, tokens, passwords) |
| **JSCPD** | Código duplicado |
| **OSV-Scanner** | Vulnerabilidades en dependencias (CVEs) |

---

## 🚀 Quick Start (5 minutos)

### Prerrequisitos

- Node.js 18+
- Git
- (Opcional) Token de GitLab si vas a analizar repos privados

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://gitlab.prestavale.mx/tools/scriptc.git
cd scriptc

# 2. Instalar dependencias
npm install

# 3. (Opcional) Instalar scanners de seguridad
bash scripts/setup-p1-tools.sh
# O simplemente asegúrate de tener Docker corriendo (usará fallback)

# 4. Configurar tu token de GitLab
cp .env.example .env
# Editar .env y poner tu GITLAB_TOKEN
```

### ✅ ¡Listo! Elige tu modo de uso:

---

## 📖 Modos de Uso

### Modo 1: Dashboard Web Local (Recomendado)

**Mejor para:** Análisis interactivo con UI bonita

```bash
# Iniciar dashboard
cd repo-scan-dashboard-main
npm run dev

# Abrir en navegador
open http://localhost:8080
```

**Workflow:**
1. Selecciona un repositorio de la lista
2. Elige modo: MRs, ramas específicas, o listar del repo
3. Configura opciones (globs, ignore patterns)
4. Click "Analizar" y observa el progreso en tiempo real
5. Descarga el reporte HTML cuando termine

![Dashboard Preview](https://via.placeholder.com/800x400?text=Dashboard+Preview)

---

### Modo 2: CLI - Análisis Rápido

**Mejor para:** Análisis ad-hoc de un proyecto

```bash
# Analizar el proyecto actual
cd ~/projects/mi-app
node ~/scriptc/generate-html-lint-report.js \
  --globs 'src/**/*.{ts,tsx}' \
  --ignore '**/*.test.ts' \
  --output reports

# Ver reporte
open reports/lint-report.html
```

**Flags útiles:**
```bash
--globs 'src/**/*.ts'              # Archivos a analizar
--ignore '**/*.test.ts,**/dist/**' # Patrones a ignorar
--output reports                   # Directorio de salida
--strict                           # Fallar si hay errores
--max-errors 10                    # Límite de errores
```

---

### Modo 3: CLI - Análisis de Ramas GitLab

**Mejor para:** Analizar múltiples ramas o MRs

```bash
# Analizar ramas específicas
node bin/review-gitlab-branches.js \
  --repo https://gitlab.prestavale.mx/Daniel_P/MiProyecto.git \
  --branches main,develop \
  --reports-dir ~/Desktop/reportes \
  --globs 'src/**/*.ts'

# Analizar todos los MRs abiertos
node bin/review-gitlab-branches.js \
  --repo https://gitlab.prestavale.mx/Daniel_P/MiProyecto.git \
  --from-gitlab-mrs \
  --gitlab-token $GITLAB_TOKEN \
  --reports-dir ~/Desktop/reportes
```

**Resultado:**
```
reportes/
├── summary.json                # Índice de todos los análisis
└── run-20260128-163245/
    ├── lint-report.html        # Reporte HTML completo
    ├── lint-summary.json       # Métricas en JSON
    └── analysis.log            # Logs de ejecución
```

---

## 🎨 Reporte HTML - Features

El reporte HTML generado incluye:

- 📊 **Dashboard de Métricas**: Errores, warnings, archivos analizados
- 🌳 **File Tree Navegable**: Con contadores de issues por archivo
- 🔍 **Filtros Interactivos**: Por herramienta (ESLint, Knip) y severidad
- 💡 **Code Snippets**: Con syntax highlighting (Shiki)
- 📈 **Reglas Más Frecuentes**: Top 10 con gráfica
- 🎯 **Secciones por Tool**: ESLint, Knip, Semgrep, Gitleaks, JSCPD
- 🌓 **Dark/Light Mode**: Toggle de tema
- 📱 **Responsive**: Funciona en mobile

**Demo:** [Ver ejemplo de reporte](reports/example.html)

---

## ⚙️ Configuración

### Archivo .env

```bash
# GitLab (necesario solo para analizar repos privados)
GITLAB_BASE=https://gitlab.prestavale.mx/api/v4
GITLAB_TOKEN=glpat-xxxxxxxxxxxxx

# Directorios
WORK_DIR=.work              # Clones temporales
STORAGE_DIR=storage         # Reportes guardados

# Opciones por defecto
DEFAULT_IGNORE=**/*.pb.ts,**/proto/**,**/node_modules/**
DEFAULT_GLOBS=src/**/*.{ts,tsx,js,jsx}

# Deshabilitar scanners (opcional)
REPORT_NO_SEMGREP=0         # 1 para deshabilitar
REPORT_NO_GITLEAKS=0
REPORT_NO_JSCPD=0
REPORT_NO_KNIP=0

# Quality Gates (opcional)
REPORT_STRICT=0             # 1 para fallar si hay errores
REPORT_MAX_ERRORS=          # Máximo de errores permitidos
REPORT_MAX_WARNINGS=        # Máximo de warnings permitidos
REPORT_MAX_SECRETS=0        # Máximo de secretos permitidos
```

### Configurar Repositorios (Dashboard)

Edita `repo-scan-dashboard-main/repos.json`:

```json
[
  {
    "slug": "mi-proyecto",
    "name": "Mi Proyecto Backend",
    "repoUrl": "https://gitlab.prestavale.mx/org/mi-proyecto.git",
    "imageUrl": "https://example.com/logo.png",
    "description": "API Backend en Node.js + TypeScript"
  }
]
```

---

## 🔧 Casos de Uso Comunes

### 1. Pre-Commit Check

```bash
# Agregar a .git/hooks/pre-commit
#!/bin/bash
node ~/scriptc/generate-html-lint-report.js \
  --strict \
  --max-errors 0 \
  --output /tmp/lint-check

if [ $? -ne 0 ]; then
  echo "❌ Lint failed. Review /tmp/lint-check/lint-report.html"
  exit 1
fi
```

### 2. Análisis Programado (Cron)

```bash
# Agregar a crontab: análisis diario a las 3 AM
0 3 * * * cd ~/scriptc && node bin/review-gitlab-branches.js \
  --repo https://gitlab.prestavale.mx/org/proyecto.git \
  --branches main \
  --reports-dir ~/reports/daily/$(date +\%Y\%m\%d)
```

### 3. Compartir Reporte con el Equipo

```bash
# Opción A: Subir a Slack
cp reports/lint-report.html /tmp/
# Adjuntar en Slack

# Opción B: GitHub Gist
gh gist create reports/lint-report.html --public

# Opción C: Email
zip -r reporte.zip reports/
# Adjuntar a email
```

### 4. Comparar Branches

```bash
# Analizar main
node bin/review-gitlab-branches.js \
  --repo <url> --branches main \
  --reports-dir reports/comparison/main

# Analizar develop
node bin/review-gitlab-branches.js \
  --repo <url> --branches develop \
  --reports-dir reports/comparison/develop

# Comparar ambos reportes manualmente
```

---

## 🛠️ Personalización

### Crear tu Propia Config de ESLint

```bash
# Generar .eslintrc.js customizado
node scripts/generate-eslintrc.js \
  --preset typescript-default \
  --no-unicorn \
  --with-sonarjs

# Usar en análisis
node generate-html-lint-report.js \
  --force-eslint-config  # Usa config interna
```

### Agregar Reglas Custom de Semgrep

```bash
# Crear reglas custom en semgrep-rules.yml
# Luego ejecutar:
SEMGREP_CONFIG=./semgrep-rules.yml node generate-html-lint-report.js
```

### Modificar el HTML Template

El generador de reportes está en `lib/html-generator.ts`. Puedes customizar:
- Colores del tema
- Layout de secciones
- Estilos CSS
- Frontend JavaScript

---

## 🐳 Uso con Docker

Si prefieres no instalar nada:

```bash
# Build imagen
docker build -t scriptc .

# Ejecutar dashboard
docker run -p 8080:8080 -p 3001:3001 \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/storage:/app/storage \
  scriptc

# Acceder
open http://localhost:8080
```

---

## 🔒 Seguridad y Privacidad

### ¿Por qué es seguro ejecutar localmente?

- ✅ **Tu token GitLab nunca sale de tu máquina**
- ✅ **El código fuente se clona en `.work/` local**
- ✅ **No hay servidores externos que puedan ser hackeados**
- ✅ **No se envía telemetría ni analytics**
- ✅ **Cumple automáticamente con GDPR/compliance**

### Sandboxing

ScriptC usa un sistema de "sandboxing" con symlinks:
1. Clona el repo en `.work/[nombre-sanitizado]/`
2. Crea symlinks de `node_modules` desde ScriptC
3. Ejecuta análisis en el directorio aislado
4. Limpia todo después (opcional con `--no-cleanup`)

**El proyecto objetivo nunca es modificado.**

---

## 📊 Roadmap

### ✅ P0 - Formatos Estándar (Completado)
- CodeClimate JSON (GitLab Code Quality)
- SARIF (Code Scanning)
- Progreso real vía SSE
- Dashboard con cancelación de jobs

### ✅ P1 - Seguridad (Completado)
- Semgrep SAST
- Gitleaks secret scanning
- Docker fallback
- Quality gates configurables

### 🟡 P2 - Performance (En Progreso)
- OSV-Scanner para vulnerabilidades
- Sparse checkout
- Reuso de clones
- Concurrencia controlada

### ⬜ P3 - Monorepos
- Detección de workspaces
- Lint tipado por paquete
- Alias resolution

### ⬜ P4 - Baseline
- "Clean as You Code"
- Comparación entre branches
- Trending de métricas

---

## 🤝 Contribuir

¿Encontraste un bug? ¿Tienes una idea genial? ¡Contribuye!

1. Fork el repo
2. Crea una branch: `git checkout -b feat/nueva-funcionalidad`
3. Commit: `git commit -m "Add: nueva funcionalidad"`
4. Push: `git push origin feat/nueva-funcionalidad`
5. Abre un Merge Request

### Principios de Diseño

Sigue **Las Tres Leyes de ScriptC** (ver `GEMINI.md`):
1. **Law of Isolation**: Todo pasa por `SandboxManager`
2. **Law of Purity**: No modificar proyecto objetivo
3. **Law of Determinism**: Mismo código = mismo output

---

## 📚 Documentación Completa

- **[DOCUMENTACION_COMPLETA.md](DOCUMENTACION_COMPLETA.md)** - Arquitectura técnica detallada (1,200 líneas)
- **[GEMINI.md](GEMINI.md)** - Principios arquitectónicos y Las 3 Leyes
- **[PlanImplementacion.md](PlanImplementacion.md)** - Roadmap de fases P0-P5

---

## ❓ FAQ

### ¿Necesito instalar todos los scanners?

No. ESLint y Knip vienen con `npm install`. Semgrep y Gitleaks son opcionales:
- Si no están instalados, usará Docker (si está disponible)
- O los puedes deshabilitar: `REPORT_NO_SEMGREP=1`

### ¿Funciona con proyectos JavaScript puro?

Sí, funciona con JS, TS, JSX, TSX. Simplemente ajusta los globs:
```bash
--globs 'src/**/*.js'
```

### ¿Puedo analizar repos privados?

Sí, solo necesitas un token de GitLab con scope `read_api` y `read_repository`.

### ¿Los reportes caducan?

No, los reportes HTML son estáticos y self-contained. Puedes guardarlos indefinidamente.

### ¿Funciona offline?

Sí, si ya tienes el repo clonado y los scanners instalados, todo funciona offline.

### ¿Cuánto espacio en disco usa?

Depende del tamaño de los repos que analices. Los clones se guardan temporalmente en `.work/` (puedes borrar después).

### ¿Puedo usar en CI/CD?

Sí! Mira la sección de integración GitLab CI en la documentación completa.

---

## 📝 Licencia

MIT License - Ver [LICENSE](LICENSE)

---

## 🙋 Soporte

- **Issues**: [GitLab Issues](https://gitlab.prestavale.mx/tools/scriptc/-/issues)
- **Email**: daniel@prestavale.mx
- **Slack**: #scriptc-help

---

## ⭐ Créditos

Construido con:
- [ESLint](https://eslint.org/)
- [Knip](https://github.com/webpro/knip)
- [Semgrep](https://semgrep.dev/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [Shiki](https://shiki.matsu.io/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)

---

**¿Listo para analizar tu código?** 🚀

```bash
git clone https://gitlab.prestavale.mx/tools/scriptc.git
cd scriptc && npm install
npm run dev
```

**Happy linting! 🎯**
