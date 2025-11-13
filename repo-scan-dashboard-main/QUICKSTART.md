# ⚡ Inicio Rápido

Sigue estos pasos para tener el analizador corriendo en **menos de 5 minutos**.

## ✅ Pre-requisitos

- [ ] Node.js 18+ instalado
- [ ] Git instalado
- [ ] Token de GitLab con permisos `read_api` y `read_repository`
- [ ] Scripts del analizador (`review-gitlab-branches.js` y `generate-html-lint-report.js`)

## 📦 Paso 1: Instalar Dependencias

```bash
npm install
```

## ⚙️ Paso 2: Configurar Scripts en package.json

Abre `package.json` y agrega estos scripts (ver `SCRIPTS_SETUP_INSTRUCTIONS.md` para detalles):

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:backend\"",
    "dev:frontend": "vite",
    "dev:backend": "tsx watch server/index.ts"
  }
}
```

## 🔧 Paso 3: Configurar Variables de Entorno

```bash
cp .env.example .env
```

Edita `.env` y configura **al menos** estas variables:

```env
GITLAB_TOKEN=glpat-xxxxxxxxxxxxx
REVIEW_SCRIPT_PATH=/ruta/absoluta/a/review-gitlab-branches.js
REPORT_SCRIPT_PATH=/ruta/absoluta/a/generate-html-lint-report.js
```

💡 **Tip**: Si copiaste los scripts a `scripts/` en este proyecto:
```env
REVIEW_SCRIPT_PATH=/Users/tu-usuario/path/al/proyecto/scripts/review-gitlab-branches.js
REPORT_SCRIPT_PATH=/Users/tu-usuario/path/al/proyecto/scripts/generate-html-lint-report.js
```

## 📋 Paso 4: Configurar Repositorios

```bash
cp repos.json.example repos.json
```

Edita `repos.json` con tu repo de prueba:

```json
[
  {
    "slug": "test-repo",
    "name": "Repositorio de Prueba",
    "repoUrl": "https://gitlab.com/tu-org/tu-repo.git",
    "description": "Repo para probar el analizador"
  }
]
```

## 🚀 Paso 5: Iniciar la Aplicación

```bash
npm run dev
```

Deberías ver:
```
[0] 
[0]   VITE v5.x.x  ready in xxx ms
[0] 
[0]   ➜  Local:   http://localhost:8080/
[1] 
[1] 🚀 Server running on http://localhost:3001
```

## 🎉 Paso 6: Primera Ejecución

1. Abre http://localhost:8080 en tu navegador
2. Verás tu repositorio listado
3. Haz clic en el card del repositorio
4. Selecciona "Merge Requests abiertos" (o el modo que prefieras)
5. Haz clic en **"Analizar repositorio"**
6. Observa el progreso en tiempo real
7. Cuando termine, haz clic en **"Ver Reporte"**

## ❓ ¿Algo salió mal?

### Error: "Cannot find module"
**Causa**: Rutas incorrectas en `.env`
**Solución**: Usa rutas absolutas completas
```bash
# Ver ruta absoluta del archivo
realpath scripts/review-gitlab-branches.js
```

### Error: "Repository not found"
**Causa**: `repos.json` no existe o es inválido
**Solución**: Verifica que el archivo existe y es JSON válido
```bash
cat repos.json | jq .
```

### Error: "GITLAB_TOKEN required"
**Causa**: Token no configurado
**Solución**: 
1. Ve a GitLab → Settings → Access Tokens
2. Crea token con scopes: `read_api`, `read_repository`
3. Copia el token a `.env`

### Frontend carga pero no conecta con backend
**Causa**: Backend no está corriendo
**Solución**: Verifica que ambos procesos están activos
```bash
# Deberías ver 2 procesos en la terminal
# [0] Vite (frontend)
# [1] tsx (backend)
```

### Análisis falla inmediatamente
**Causa**: Permisos del script o git no instalado
**Solución**:
```bash
# Dar permisos de ejecución
chmod +x scripts/*.js

# Verificar git
git --version
```

## 📚 Siguiente Pasos

Una vez que tengas el primer análisis funcionando:

- [ ] Lee `README.md` para entender todas las opciones
- [ ] Explora `ARCHITECTURE.md` para entender cómo funciona
- [ ] Revisa `DEPLOYMENT.md` para poner en producción
- [ ] Consulta `SETUP.md` para configuración avanzada

## 💡 Tips Pro

### Análisis más rápido
```env
# En .env
ANALYZE_OFFLINE_MODE=true  # Skip install de dependencies
```

### Múltiples repos
Agrega más repos a `repos.json`:
```json
[
  { "slug": "repo1", ... },
  { "slug": "repo2", ... },
  { "slug": "repo3", ... }
]
```

### Análisis específico
En vez de analizar todos los MRs, analiza solo ramas específicas:
1. Selecciona "Ramas específicas"
2. Escribe: `main, develop, feature/importante`
3. Analizar

### Ver logs detallados
```bash
# Terminal 1: Backend con logs
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

## 🆘 Soporte

Si sigues teniendo problemas:

1. Revisa `TROUBLESHOOTING.md`
2. Verifica logs en la consola del navegador (F12)
3. Verifica logs del servidor en la terminal
4. Busca el error específico en la documentación

---

**¿Todo funcionó?** 🎉 ¡Genial! Ahora tienes un analizador de código funcionando.
