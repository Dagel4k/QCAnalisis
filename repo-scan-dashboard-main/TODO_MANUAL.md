# ⚠️ ACCIONES MANUALES REQUERIDAS

Estos archivos no pueden ser editados automáticamente. Por favor, realiza estos cambios manualmente:

## 1. Agregar scripts a package.json

Abre `package.json` y agrega estos scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:backend\"",
    "dev:frontend": "vite",
    "dev:backend": "tsx watch server/index.ts",
    "build": "tsc && vite build",
    "build:backend": "tsc -p server/tsconfig.json",
    "start": "concurrently \"npm run start:frontend\" \"npm run start:backend\"",
    "start:frontend": "vite preview --port 8080",
    "start:backend": "node server/dist/index.js"
  }
}
```

## 2. Agregar líneas a .gitignore

Agrega estas líneas al final de `.gitignore`:

```
# Environment and config
.env
repos.json

# Storage
storage/
.work/
server/dist/
```

## 3. Crear archivos de configuración

```bash
cp .env.example .env
cp repos.json.example repos.json
```

Luego edita `.env` y `repos.json` con tus datos reales.

## ✅ Verificar instalación

```bash
npm install
npm run dev
```

Abre http://localhost:8080
