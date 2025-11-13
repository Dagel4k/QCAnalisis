# Instrucciones para agregar scripts a package.json

Dado que `package.json` no se puede editar directamente, debes agregar manualmente estos scripts.

Abre `package.json` y en la sección `"scripts"`, agrega lo siguiente:

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

**Importante**: Mantén cualquier otro script que ya esté en tu `package.json` (como `lint`, etc.)

## Scripts disponibles después de la configuración:

- `npm run dev` - Inicia frontend y backend en desarrollo
- `npm run dev:frontend` - Solo frontend (Vite)
- `npm run dev:backend` - Solo backend (Express con hot-reload)
- `npm run build` - Build de producción (frontend + backend)
- `npm run start` - Inicia ambos servidores en modo producción

## Verificación

Después de agregar los scripts, ejecuta:
```bash
npm run dev
```

Deberías ver:
- Frontend en http://localhost:8080
- Backend en http://localhost:3001
