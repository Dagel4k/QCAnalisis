# 🔧 Troubleshooting

Guía de resolución de problemas comunes.

## 🚨 Problemas de Instalación

### Error: "Cannot find module '@types/node'"

**Causa**: Dependencias de desarrollo no instaladas

**Solución**:
```bash
npm install --save-dev @types/node @types/express @types/cors
```

### Error: "concurrently: command not found"

**Causa**: Script `dev` no puede ejecutarse porque falta concurrently

**Solución**:
```bash
npm install --save-dev concurrently
```

## 🔌 Problemas de Conexión

### Frontend carga página en blanco

**Diagnóstico**:
1. Abre DevTools (F12)
2. Ve a Console
3. Busca errores

**Soluciones comunes**:
```bash
# Build error - revisa la terminal
# Solución: Corrige errores de TypeScript

# CORS error
# Solución: Verifica que backend está en puerto 3001
```

### API devuelve 404

**Causa**: Backend no está corriendo o puerto incorrecto

**Verificación**:
```bash
# Test el backend directamente
curl http://localhost:3001/api/health

# Debería devolver:
# {"status":"ok","timestamp":"..."}
```

**Solución**:
```bash
# Reinicia el backend
npm run dev:backend
```

### "Failed to fetch" en todas las llamadas

**Causa**: API_URL apunta al lugar equivocado

**Solución**:
```typescript
// Verifica src/lib/config-client.ts
export const API_URL = 'http://localhost:3001';
```

## 📝 Problemas de Configuración

### "Repository not found"

**Diagnóstico**:
```bash
# Verifica que repos.json existe
ls -la repos.json

# Verifica que es JSON válido
cat repos.json | jq .
```

**Solución**:
```bash
# Si no existe
cp repos.json.example repos.json

# Si es inválido, valida JSON
# https://jsonlint.com/
```

### "GITLAB_TOKEN required"

**Causa**: Variable de entorno no configurada o mal configurada

**Verificación**:
```bash
# Verifica que .env existe
ls -la .env

# Verifica contenido (sin mostrar token)
grep GITLAB_TOKEN .env
# Debería mostrar: GITLAB_TOKEN=glpat-xxxxx
```

**Solución**:
1. Ve a GitLab → User Settings → Access Tokens
2. Crea token con scopes: `read_api`, `read_repository`
3. Expira en 1 año (o más)
4. Copia token
5. Agrega a `.env`: `GITLAB_TOKEN=tu_token_aqui`

### "Cannot find script"

**Error completo**:
```
Error: ENOENT: no such file or directory
spawn /path/to/review-gitlab-branches.js ENOENT
```

**Causa**: Rutas en `.env` son incorrectas o relativas

**Solución**:
```bash
# Usa rutas ABSOLUTAS
# ❌ NO USES:
REVIEW_SCRIPT_PATH=./scripts/review-gitlab-branches.js

# ✅ USA:
REVIEW_SCRIPT_PATH=/Users/tu-usuario/proyecto/scripts/review-gitlab-branches.js

# Tip: obtener ruta absoluta
realpath scripts/review-gitlab-branches.js
```

## 🏃 Problemas Durante Análisis

### "Repository already being analyzed"

**Causa**: Ya hay un análisis corriendo para ese repo

**Solución**:
- Espera a que termine el análisis actual
- O reinicia el servidor: `Ctrl+C` y `npm run dev`

### Análisis se queda en "Analizando..." indefinidamente

**Diagnóstico**:
```bash
# Revisa logs del backend en la terminal
# Busca errores o warnings
```

**Causas comunes**:
1. **Clone failed**: Repo privado sin acceso
2. **Dependencies failed**: npm install falló en el repo
3. **Timeout**: Repo muy grande

**Soluciones**:
```bash
# 1. Verifica acceso al repo
git clone <tu-repo-url>

# 2. Aumenta timeout en .env
ANALYSIS_TIMEOUT=900000  # 15 minutos

# 3. Usa offline mode
ANALYZE_OFFLINE_MODE=true
```

### "Error: Command failed: git clone"

**Causas**:
1. Token sin permisos
2. Repo no existe
3. Git no instalado

**Soluciones**:
```bash
# Verificar git
git --version

# Verificar acceso con tu token
git clone https://oauth2:TU_TOKEN@gitlab.com/org/repo.git

# Verificar permisos del token en GitLab
```

### Reportes no aparecen después de análisis exitoso

**Diagnóstico**:
```bash
# Verifica que summary.json existe
ls -la storage/tu-repo-slug/summary.json

# Verifica contenido
cat storage/tu-repo-slug/summary.json | jq .
```

**Solución**:
```bash
# Si no existe, el CLI falló silenciosamente
# Corre el CLI manualmente para ver el error:
node scripts/review-gitlab-branches.js \
  --repo <url> \
  --branches main \
  --reports-dir ./test-reports \
  --report-script scripts/generate-html-lint-report.js
```

## 🖥️ Problemas de Permisos

### "EACCES: permission denied"

**Causa**: Sin permisos para escribir en storage/ o .work/

**Solución**:
```bash
# Crear directorios con permisos correctos
mkdir -p storage .work
chmod 755 storage .work

# O cambiar owner
sudo chown -R $USER:$USER storage .work
```

### "ENOENT: no such file or directory, mkdir 'storage'"

**Causa**: Directorios no existen y no se pueden crear automáticamente

**Solución**:
```bash
# Crear manualmente
mkdir -p storage/.keep .work/.keep
echo '*' > .work/.gitignore
```

## 🐳 Problemas con Docker

### Build falla

**Error**: "npm ERR! Missing script"

**Solución**:
Verifica que agregaste los scripts a `package.json`:
```json
{
  "scripts": {
    "build": "tsc && vite build",
    "build:backend": "tsc -p server/tsconfig.json",
    "start": "concurrently \"npm run start:frontend\" \"npm run start:backend\"",
    "start:frontend": "vite preview --port 8080",
    "start:backend": "node server/dist/index.js"
  }
}
```

### Container inicia pero no responde

**Diagnóstico**:
```bash
# Ver logs
docker logs gitlab-analyzer

# Entrar al container
docker exec -it gitlab-analyzer sh

# Verificar procesos
ps aux | grep node
```

**Solución**:
```bash
# Asegúrate de montar .env
docker run -v $(pwd)/.env:/app/.env ...

# Verifica que repos.json está montado
docker run -v $(pwd)/repos.json:/app/repos.json ...
```

### Volúmenes no persisten

**Causa**: Rutas relativas mal configuradas

**Solución**:
```bash
# Usa rutas absolutas
docker run \
  -v $(pwd)/storage:/app/storage \
  -v $(pwd)/.work:/app/.work \
  ...
```

## 🚀 Problemas de Performance

### Análisis muy lento (>10 minutos)

**Optimizaciones**:
```env
# .env
ANALYZE_OFFLINE_MODE=true  # Skip install dependencies
```

```bash
# Usar depth shallow
--depth 1

# Limitar archivos analizados
--globs "src/**/*.ts"

# Ignorar directorios grandes
--ignore "**/node_modules/**,**/dist/**"
```

### Disco lleno

**Causa**: `.work/` tiene muchos clones antiguos

**Solución**:
```bash
# Limpiar manualmente
rm -rf .work/*

# O crear cron job diario
0 2 * * * find /path/to/.work -type d -mtime +7 -exec rm -rf {} +
```

### Memoria alta

**Causa**: Múltiples análisis concurrentes

**Solución**:
Edita `server/routes/analyze.ts`:
```typescript
// Limitar a 1 job global (no solo por repo)
const MAX_GLOBAL_JOBS = 1;
if (runningJobsCount >= MAX_GLOBAL_JOBS) {
  return res.status(429).json({ error: 'Too many concurrent jobs' });
}
```

## 🔍 Debug Avanzado

### Habilitar logs detallados

Backend:
```typescript
// server/index.ts
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});
```

CLI:
```bash
# Corre manualmente con output completo
node scripts/review-gitlab-branches.js ... 2>&1 | tee analysis.log
```

### Inspeccionar estado del job manager

```typescript
// server/routes/debug.ts (crear para debugging)
router.get('/api/debug/jobs', (req, res) => {
  const allJobs = Array.from(jobManager['jobs'].values());
  res.json(allJobs);
});
```

### Verificar SSE stream

```bash
# Test SSE endpoint directamente
curl -N http://localhost:3001/api/jobs/JOB_ID/stream
```

## 📊 Checklist de Diagnóstico

Cuando algo no funciona, ejecuta este checklist:

```bash
# 1. Node y npm
node --version  # >= 18
npm --version

# 2. Git
git --version

# 3. Archivos de config
ls -la .env repos.json

# 4. Dependencias
npm list | grep -E "express|vite|tsx|concurrently"

# 5. Permisos
ls -ld storage .work

# 6. Backend health
curl http://localhost:3001/api/health

# 7. Frontend build
npm run build  # No debería tener errores

# 8. Scripts CLI existen
ls -la scripts/*.js

# 9. GitLab connectivity
curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  https://gitlab.com/api/v4/user
```

Si todo lo anterior pasa y aún tienes problemas, probablemente sea un bug. Revisa:
- Logs completos del servidor
- Console del navegador
- Network tab en DevTools
- Contenido de summary.json generado

## 🆘 Última Opción

```bash
# Reset completo
rm -rf node_modules package-lock.json
rm -rf storage .work
npm install
cp .env.example .env
cp repos.json.example repos.json
# Configurar .env y repos.json
npm run dev
```

Si después de esto sigue sin funcionar, hay un problema de configuración del sistema (permisos, rutas, etc.) que necesita revisión manual.
