# 4. Extensión Cliente (VS Code Plugin)

## Responsabilidades del Cliente
El cliente es la extensión `.vsix` que el usuario instala desde el Marketplace o de forma local. Su arquitectura será intencionalmente simple y "tonta".

**Lo que NO hará:**
*   Traer dependencias analíticas en su `node_modules` (Ej. No incluirá `eslint` ni `semgrep`).
*   Analizar código por sí misma.
*   Leer configuración compleja de reglas.

**Lo que SÍ hará:**
*   Actuar como lanzador del proceso Node.js del *Language Server* local (`ScriptC`).
*   Gestionar el ciclo de vida del proceso secundario (arrancarlo, reiniciarlo si falla, apagarlo al cerrar el editor).
*   Proveer configuraciones de UI nativas en VS Code (como la ruta al ejecutable de `ScriptC` global, si no está en el `PATH` default).

## Estructura del Cliente

Utilizaremos el boilerplate oficial de Microsoft, que incluye la librería `vscode-languageclient`.

### 1. Puntos de Entrada
El archivo `package.json` de la extensión definirá:
*   `activationEvents: ["onLanguage:javascript", "onLanguage:typescript", ...]`: La extensión solo "despertará" cuando el programador abra un archivo que sepamos analizar, conservando memoria valiosa en otros casos.

### 2. Arranque del Servidor
En `src/extension.ts` (función `activate`), se buscará el ejecutable de ScriptC local (probablemente en la red local de repositorios de la empresa, o instalado vía `npm install -g @scriptc/core`).

```typescript
// Pseudocódigo del Cliente VS Code
const serverOptions: ServerOptions = {
    // Apuntamos al ejecutable CLI de ScriptC que actúa de Servidor LSP
    command: 'node', 
    args: ['Ruta/A/QCAnalisis/bin/lsp-server.js', '--stdio']
};

const clientOptions: LanguageClientOptions = {
    // Registramos la extensión para tipos de archivo concretos
    documentSelector: [{ scheme: 'file', language: 'typescript' }, ...],
    synchronize: {
        // Le avisamos al servidor si cambian archivos de configuración (ej. .scriptcrc)
        fileEvents: workspace.createFileSystemWatcher('**/.scriptcrc')
    }
};

const client = new LanguageClient('ScriptCLSP', 'ScriptC Language Server', serverOptions, clientOptions);
client.start();
```

### 3. Configuraciones Visuales (El "UX")
Además de iniciar el servidor, el cliente aprovechará las APIs nativas de VS Code para proveer:
*   **Comandos en la Paleta:** (Ej. *`ScriptC: Restart Server`*, *`ScriptC: Force Full Scan`*).
*   **Settings Nativas:** (`.vscode/settings.json`) Donde el tech lead pueda configurar `scriptc.path` o `scriptc.trace.server` para debugear logs de comunicación entre el Servidor Local y el Cliente VS Code.

## Siguientes Pasos (El Plan de Implementación)
1.  **Crear el Servidor LSP (Node.js Core):** Empezaremos creando `bin/lsp-server.ts` dentro de la carpeta actual de `QCAnalisis`, implementando `vscode-languageserver`.
2.  **Adaptar Scanners a "On-Demand":** Modiremos los ejecutores actuales (`lib/scanners/*`) para que acepten un `string` o la ruta a un único archivo temporal, en lugar de rutas de clonado completas.
3.  **Andamiaje del Cliente VS Code:** Finalizaremos creando la carpeta de la extensión en sí, implementando la conexión.
