# 3. Integración CLI -> Servidor LSP (Layer 3)

## El Reto
Actualmente, nuestro CLI principal analiza repositorios completos clonándolos en una carpeta `.work`. Para integrarse con un editor en tiempo real, necesita poder:
1.  Mantenerse abierto (proceso en vivo).
2.  Escuchar cambios en archivos individuales.
3.  Analizar fragmentos de código en memoria o en copias temporales sincronizadas.

## Diseño de la Arquitectura del Servidor LSP

Construiremos un nuevo punto de entrada en nuestro Core de Node.js, por ejemplo: `bin/lsp-server.ts`.

### 1. Inicialización y Conexión
*   Utilizaremos el paquete oficial `vscode-languageserver` de Microsoft.
*   Al iniciar, el servidor establecerá una conexión IPC (Inter-Process Communication) o STDIO con el cliente de VS Code.
*   Negociará las "Capabilities" (Capacidades): le diremos a VS Code "Oye, soy capaz de proveer 'Diagnostics' (errores) y necesito que me avises cada vez que cambie un archivo y se guarde (ó en cada pulsación, si el rendimiento lo permite)".

### 2. Sincronización de Documentos
*   Implementaremos un `TextDocuments` manager.
*   En el evento `onDidChangeContent` (El usuario ha escrito algo):
    1.  El servidor LSP recibe el contenido actualizado del archivo en memoria.
    2.  Debido a que herramientas como Gitleaks o Semgrep a menudo necesitan un archivo físico para analizar (no trabajan tan bien con stdin o streams puramente en memoria en algunas de sus configuraciones avanzadas), el servidor LSP creará un **Espejo Temporal** del archivo específico en `.work/lsp/` o simplemente pasará el texto a través de `stdin` si la herramienta lo permite de forma nativa (ESLint y Semgrep lo permiten).

### 3. Pipeline de Escaneo On-Demand
Al recibir el texto de un archivo único (`fileUri`):
1.  **Enrutamiento:** Determinar qué escáneres aplican. Si es `.js`/`.ts`, corremos ESLint y Semgrep.
2.  **Ejecución Rápida:**
    *   `ESLint`: Instanciar la API Node.js de ESLint (`new ESLint()`) y ejecutar `lintText()`.
    *   `Semgrep`: Ejecutar el binario pasándole el archivo único apuntando a nuestras reglas en memoria.
3.  **Conversión de Resultados:**
    Los escáneres devuelven resultados en formatos distintos. El servidor debe mapearlos al formato universal del LSP:
    ```typescript
    interface Diagnostic {
        range: Range; // Línea y carácter de inicio/fin
        severity: DiagnosticSeverity; // Error, Warning, Information, Hint
        code?: number | string; // Ej: "semgrep:javascript.sql-injection"
        source?: string; // "ScriptC"
        message: string; // Explicación humana del error
    }
    ```

### 4. Retorno al Cliente
Una vez que se genera el arreglo de `Diagnostic`, el servidor invoca `connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })`. VS Code recibe esto mágicamente y subraya el error en la interfaz.

## Leyes de ScriptC en el Servidor LSP
*   **Ley de Aislamiento:** El LSP solo lee. Si crea archivos temporales para el escaneo, lo hará estrictamente en `.work/lsp/` y los limpiará al cerrarse.
*   **Ley de Purity (Falla Suave):** Si un escáner temporalmente explota por un error de sintaxis del usuario mientras escribe, el servidor lo atrapará silenciosamente y no "crasheará" el daemon entero, simplemente retornará un error genérico o limpiará el estado.
