/**
 * ScriptC Linter — Extensión Cliente de VS Code.
 *
 * Este archivo es intencionalmente "tonto y ligero".
 * No contiene lógica de análisis. Su única responsabilidad es:
 *  1. Arrancar el proceso del servidor LSP de ScriptC como daemon de fondo.
 *  2. Mantener activo el ciclo de vida del cliente (reiniciar si falla, apagar al cerrar).
 *  3. Registrar el canal de tracing para facilitar el debugging.
 *
 * Todo el análisis real ocurre en: QCAnalisis/bin/lsp-server.ts (proceso separado).
 */

import * as path from 'path';
import { ExtensionContext, window } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
    // context.asAbsolutePath resuelve relativo a la raíz de la extensión
    // (la carpeta donde está este package.json), no relativo a __dirname.
    //
    // Ruta absoluta resultante:
    //   .../QCAnalisis/packages/vscode-extension/  (raíz de extensión)
    //   dist/server.js    ✓ (el servidor empaquetado)
    const serverModule = context.asAbsolutePath(
        path.join('dist', 'server.js')
    );

    const serverOptions: ServerOptions = {
        // Modo producción: comunicación limpia vía stdio
        run: {
            module: serverModule,
            transport: TransportKind.stdio
        },
        // Modo debug (F5): mismo servidor, con inspector de Node.js abierto en el puerto 6009.
        // Permite adjuntar un debugger a la sesión del servidor LSP desde la terminal.
        debug: {
            module: serverModule,
            transport: TransportKind.stdio,
            options: {
                execArgv: ['--nolazy', '--inspect=6009']
            }
        }
    };

    const clientOptions: LanguageClientOptions = {
        // Activamos el cliente solo para los lenguajes que ScriptC sabe analizar
        documentSelector: [
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'javascriptreact' },
            { scheme: 'file', language: 'typescriptreact' }
        ],
        synchronize: {
            // Si el proyecto tiene un archivo .scriptcrc, notificamos al servidor
            // cuando cambia para que pueda recargar la configuración.
            fileEvents: [
                // workspace puede ser undefined si no hay carpeta abierta; el SDK lo maneja
            ]
        },
        // Canal de output visible en: Vista > Output > ScriptC Linter
        outputChannelName: 'ScriptC Linter'
    };

    client = new LanguageClient(
        'scriptcLinter',         // ID interno (usado para logs y storage)
        'ScriptC Linter',        // Nombre visible en el panel Output y la barra de estado
        serverOptions,
        clientOptions
    );

    // En vscode-languageclient v9, .start() devuelve Promise<void>.
    // El ciclo de vida se gestiona en deactivate() → client.stop().
    void client.start();

    // Canal informativo: aparece en el panel "Output" de VS Code
    const outputChannel = window.createOutputChannel('ScriptC Linter');
    outputChannel.appendLine('[ScriptC] Servidor LSP iniciando...');
    context.subscriptions.push(outputChannel);
}

/**
 * VS Code llama a deactivate() cuando el usuario desinstala la extensión
 * o cierra el workspace. Paramos el cliente (y con él, el proceso servidor).
 */
export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
