ScriptC Code Reviewer

Objetivo: herramienta CLI para revisar ramas de GitLab (o cualquier repo Git), generar un reporte HTML tipo Sonar (ESLint + ts-prune + jscpd) y limpiar los clones temporales. Incluye:
- CLI `review-gitlab-branches` para clonar ramas, correr análisis y consolidar reportes.
- Generador `generate-eslint-config` para crear `.eslintrc.js` bajo demanda.
- Paquete meta `@scriptc/dev-tools` para instalar múltiples devDependencies con una sola.
  - Incluye plugins: @typescript-eslint, import, unicorn, sonarjs y security.

Requisitos
- Node 18+
- git instalado y accesible en PATH
- Conexión a npm registry (para instalar dependencias en los repos auditados)
 - Opcional: archivo `.env` en el root para variables como `GITLAB_TOKEN`

Instalación local
1) (Opcional) Empaqueta el meta paquete:
   npm run dev-tools:pack

2) En el repo que audites puedes instalar el tarball resultante (file:...) como devDependency para obtener eslint, plugins, typescript, ts-prune, jscpd, etc.
   - Nota: Si se actualizan las dependencias del meta paquete (por ejemplo, se añadió `eslint-plugin-security`), vuelve a ejecutar `npm run dev-tools:pack` para generar un tarball actualizado.

Uso rápido

Generar .eslintrc.js (en CWD):
- npm run eslint:gen
- o: npx generate-eslint-config --preset typescript-default --no-unicorn (para personalizar)

Generar reporte HTML (en CWD del proyecto auditado):
- npm run report:html
  Crea `reports/lint-report.html` con:
  - Issues ESLint con fragmentos de código resaltados (Shiki)
  - Reglas más frecuentes
  - ts-prune: exports no usados
  - jscpd: duplicación de código
  - Seguridad: reglas `eslint-plugin-security` y escaneo de secretos (AWS keys, GitHub tokens, JWTs, etc.)

Flags útiles del generador (`generate-html-lint-report.js`):
- `--ignore <p1,p2>`: patrones a ignorar (globs simples). Se aplican al filtrado de resultados ESLint y al arbol de archivos.
- `--globs <g1,g2>`: globs o lista de archivos a analizar (por defecto `src/**/*.ts`).
- `--no-ts-prune` / `--no-jscpd`: desactiva herramientas adicionales.
- `--no-secret-scan`: desactiva el escaneo heurístico de secretos/credenciales.
- `--max-issues-per-file <n>`: limita issues mostrados por archivo (default 100).
  - Alternativas por entorno: `REPORT_USE_INTERNAL_ESLINT_CONFIG=1`, `REPORT_NO_TSPRUNE=1`, `REPORT_NO_JSCPD=1`, `REPORT_MAX_ISSUES_PER_FILE=50`.
 - Quality gates opcionales:
   - `--strict` (falla si hay errores ESLint)
   - `--max-errors <n>` / `--max-warnings <n>`
   - `--max-unused-exports <n>` (ts-prune)
   - `--max-dup-percent <n>` (jscpd %)
   - `--max-secrets <n>` (secretos detectados por escaneo)
   - Por entorno: `REPORT_STRICT=1`, `REPORT_MAX_ERRORS`, `REPORT_MAX_WARNINGS`, `REPORT_MAX_UNUSED_EXPORTS`, `REPORT_MAX_DUP_PERCENT`, `REPORT_MAX_SECRETS`, `REPORT_NO_SECRET_SCAN=1`.

Revisar varias ramas desde un repo Git (clona, corre, copia reportes y limpia):
- node bin/review-gitlab-branches.js \
    --repo https://gitlab.com/org/proyecto.git \
    --branches feature/uno,feature/dos \
    --install-dev "file:$(pwd)/packages/dev-tools/scriptc-dev-tools-0.1.0.tgz" \
    --ignore "**/*.pb.ts,**/proto/**" \
    --report-script "/Users/daniel/Downloads/scriptCCode/generate-html-lint-report.js"

Modo GitLab (traer ramas desde MRs automáticamente):
- Variables de entorno soportadas: `GITLAB_BASE` (ej. `https://gitlab.prestavale.mx/api/v4`) y `GITLAB_TOKEN`.
 - El CLI carga automáticamente variables desde `.env` en el directorio actual. También puedes pasar una ruta específica con `--env-file /ruta/a/.env` o `DOTENV_PATH`.
- Ejemplo para tu instancia y repo de pruebas:
  - `node bin/review-gitlab-branches.js \
      --repo https://gitlab.prestavale.mx/Daniel_P/TestPagos.git \
      --from-gitlab-mrs \
      --gitlab-token $GITLAB_TOKEN \
      --ignore "**/*.pb.ts,**/proto/**" \
      --globs "src/**/*.{ts,tsx}" \
      --report-script "/Users/daniel/Downloads/scriptCCode/generate-html-lint-report.js"`
  - Por defecto toma MRs `opened`. Puedes filtrar:
    - `--mr-state opened|merged|closed`
    - `--mr-target-branch main`
    - `--mr-labels bug,backend`

Modo GitLab (traer ramas del repo):
- Usa `--from-gitlab-branches` para listar ramas del proyecto (requiere token).
- Puedes filtrar con regex: `--branch-filter "^feature/|^hotfix/"`.
- Ejemplo:
  - `node bin/review-gitlab-branches.js \
      --repo https://gitlab.prestavale.mx/Daniel_P/TestPagos.git \
      --from-gitlab-branches \
      --gitlab-base https://gitlab.prestavale.mx/api/v4 \
      --install-dev "file:$(pwd)/packages/dev-tools/scriptc-dev-tools-0.1.0.tgz" \
      --ignore "**/*.pb.ts,**/proto/**" --globs "**/*.{ts,tsx,js,jsx}" \
      --report-script "/Users/daniel/Downloads/scriptCCode/generate-html-lint-report.js"`
  - Si no hay selección explícita, intenta con la default_branch del proyecto.

Parámetros CLI:
- --repo <url>              URL git del repo (GitLab, GitHub, etc.)
- --branches a,b,c          Lista de ramas a revisar
- --branches-file <path>    Archivo con una rama por línea
- --work-dir <path>         Directorio de clones (default ./.work)
- --reports-dir <path>      Directorio de salida de reportes (default ./reports)
- --ignore p1,p2            Patrones a ignorar para ESLint/ts-prune/jscpd
- --install-dev <spec>      Especificación npm del meta paquete (file:..., git:..., @scriptc/dev-tools@ver)
- --no-cleanup              Conserva el clone tras el análisis
 - --depth <n>               Depth del shallow clone (default 1)
 - --only-changed           (MR) Analiza sólo archivos cambiados vs rama destino
 - --force-eslint-config    Ignora la config del proyecto y usa una mínima interna (útil si falta "react-app" u otros presets)
 - --env-file <path>        Cargar variables de entorno desde un archivo .env antes de ejecutar (alternativa: variable env DOTENV_PATH)

Notas importantes
- `generate-html-lint-report.js` requiere `eslint`, `@typescript-eslint`, plugins, `shiki`, `ts-prune`, `jscpd` disponibles en `node_modules` del repo analizado. Instálalos con el meta paquete o individualmente.
- Si `ts-prune` o `jscpd` no están disponibles, el reporte sigue generándose y mostrará 0 con un warning en logs.
- El reporte asume código TypeScript bajo `src/**/*.ts`. Ajusta la ruta en el script si tu layout difiere.
  - Alternativamente pasa `--globs "src/**/*.{ts,tsx,js,jsx}"` al comando para personalizar.
- Si usas `--install-dev` con un tarball local, pásalo en una sola línea y preferiblemente con ruta absoluta: `--install-dev "file:$(pwd)/packages/dev-tools/scriptc-dev-tools-0.1.0.tgz"`.
  - También puedes definir `INSTALL_DEV_SPEC` en el entorno para no repetir el flag.
 - Para ejecutar sin instalar dependencias en el clone, define `ANALYZE_OFFLINE_MODE=true`.
 - Para analizar sólo archivos cambiados en MRs, añade `--only-changed` o `ANALYZE_ONLY_CHANGED=true`.
 - Si la config ESLint del proyecto falla (por ejemplo, `extends: 'react-app'` y no están instaladas sus deps), el generador ahora hace fallback automático a una configuración interna mínima. También puedes forzarlo con `--force-eslint-config`.
 - La instalación del meta‑paquete reintenta con `--legacy-peer-deps` si hay conflictos de peer deps. Puedes pasar flags extra a npm via `NPM_INSTALL_FLAGS`.
  - Puedes elegir el gestor de paquetes con `PACKAGE_MANAGER=npm|pnpm|yarn`.
