# Electron Build Guide

## Desarrollo

### Instalar dependencias

```bash
npm install
```

### Ejecutar en modo desarrollo

```bash
npm run dev:electron
```

Esto iniciará:
- El servidor Express en `http://localhost:3001`
- El cliente Vite en `http://localhost:8080`
- La aplicación Electron conectada al cliente de desarrollo

## Build para producción

### Compilar aplicación Electron

```bash
npm run build:electron
```

Esto compila:
- Frontend React (dist/)
- Proceso principal de Electron (dist-electron/)

### Ejecutar aplicación compilada

```bash
npm run electron
```

### Empaquetar ejecutables

#### Todas las plataformas
```bash
npm run electron:pack
```

#### macOS
```bash
npm run electron:pack:mac
```

#### Windows
```bash
npm run electron:pack:win
```

#### Linux
```bash
npm run electron:pack:linux
```

Los ejecutables se generan en `release/`.

## Almacenamiento Local

En modo Electron, todos los datos se almacenan en el directorio de datos del usuario:

- **macOS**: `~/Library/Application Support/QCAnalisis/`
- **Windows**: `%APPDATA%/QCAnalisis/`
- **Linux**: `~/.config/QCAnalisis/`

Estructura:
```
userData/
├── repos.json          # Configuración de repositorios
├── storage/            # Reportes HTML generados
│   └── [repo-slug]/
│       ├── summary.json
│       └── [branch-or-mr]/
│           └── lint-report.html
└── .work/              # Clones temporales de repositorios
```

## Configuración

La aplicación Electron detecta automáticamente:
- Rutas de scripts del proyecto raíz (si están disponibles)
- Directorio de datos del usuario para almacenamiento
- Variables de entorno desde `.env` (si existe)

Para configurar GitLab:
1. Crea un archivo `.env` en el directorio raíz del proyecto
2. Agrega:
   ```
   GITLAB_BASE=https://gitlab.com/api/v4
   GITLAB_TOKEN=tu_token_aqui
   ```

## Troubleshooting

### Error: "tsx not found"
Asegúrate de que `tsx` esté instalado:
```bash
npm install --save-dev tsx
```

### Error: "Cannot find module"
Verifica que las rutas de scripts en `electron/main.ts` sean correctas para tu estructura de proyecto.

### Servidor no inicia
Revisa los logs en la consola de Electron (DevTools) para ver errores del servidor.
