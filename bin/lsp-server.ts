/**
 * ScriptC Language Server Protocol (LSP) — Punto de entrada principal.
 *
 * Este proceso es un daemon de fondo que se comunica con el cliente (extensión
 * de VS Code) a través de STDIO usando el protocolo JSON-RPC estándar de Microsoft.
 *
 * Responsabilidades:
 *  - Mantener un proceso Node.js vivo y en escucha permanente.
 *  - Recibir el contenido de archivos en memoria a medida que el usuario escribe.
 *  - Ejecutar el análisis ESLint on-demand y devolver diagnósticos al cliente.
 *  - Nunca crashear, incluso si el código del usuario tiene errores de sintaxis graves
 *    (Ley de Purity de ScriptC).
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { runEslintOnDemand } from '../lib/scanners/eslint-on-demand';

// --- Conexión y gestión de documentos ---

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// --- Inicialización del servidor ---

connection.onInitialize((_params: InitializeParams): InitializeResult => {
    connection.console.log('[ScriptC LSP] Servidor inicializado. Escuchando cambios de documentos...');

    return {
        capabilities: {
            // Full: el cliente envía el texto completo del archivo en cada cambio.
            // Es más simple que Incremental y suficiente para archivos individuales.
            textDocumentSync: TextDocumentSyncKind.Full
        }
    };
});

// --- Lógica de debounce por documento ---
// Evita que una ráfaga de pulsaciones de teclado genere múltiples análisis simultáneos
// para el mismo archivo. Solo se lanza el análisis tras un silencio de DEBOUNCE_MS.

const DEBOUNCE_MS = 300;
const pendingValidations = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleValidation(document: TextDocument): void {
    const uri = document.uri;

    // Cancela cualquier análisis pendiente para este URI
    const existing = pendingValidations.get(uri);
    if (existing !== undefined) {
        clearTimeout(existing);
    }

    const handle = setTimeout(() => {
        pendingValidations.delete(uri);
        // Capturamos la versión actual para evitar usar una versión stale del documento
        void validateDocument(document);
    }, DEBOUNCE_MS);

    pendingValidations.set(uri, handle);
}

// --- Validación principal ---

async function validateDocument(document: TextDocument): Promise<void> {
    const diagnostics: Diagnostic[] = [];

    try {
        const items = await runEslintOnDemand(document.getText(), document.uri);

        for (const item of items) {
            // ESLint usa líneas/columnas 1-based; LSP usa 0-based.
            const diagnostic: Diagnostic = {
                range: {
                    start: {
                        line: item.line - 1,
                        character: item.column - 1
                    },
                    end: {
                        line: item.endLine - 1,
                        character: item.endColumn - 1
                    }
                },
                severity: item.severity === 2
                    ? DiagnosticSeverity.Error
                    : DiagnosticSeverity.Warning,
                source: 'ScriptC (ESLint)',
                message: item.message,
                // ruleId como código permite que VS Code muestre "Ver regla" en el hover
                code: item.ruleId ?? undefined
            };

            diagnostics.push(diagnostic);
        }
    } catch (error: unknown) {
        // --- Ley de Purity ---
        // Bajo ninguna circunstancia el servidor debe crashear debido a un error de análisis.
        // Atrapamos cualquier excepción, la registramos en el canal de debug del servidor,
        // y la surfaceamos como un único diagnóstico informativo al usuario.
        const message = error instanceof Error ? error.message : String(error);

        connection.console.error(
            `[ScriptC LSP] Error durante el análisis de "${document.uri}": ${message}`
        );

        diagnostics.push({
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            },
            severity: DiagnosticSeverity.Information,
            source: 'ScriptC',
            message: `ScriptC no pudo analizar este archivo: ${message}`
        });
    }

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// --- Suscripción a eventos de documentos ---

documents.onDidChangeContent(change => {
    scheduleValidation(change.document);
});

// Cuando se cierra un documento, limpiamos sus diagnósticos y cualquier timer pendiente
documents.onDidClose(event => {
    const uri = event.document.uri;

    const pending = pendingValidations.get(uri);
    if (pending !== undefined) {
        clearTimeout(pending);
        pendingValidations.delete(uri);
    }

    // Enviar lista vacía para limpiar los diagnósticos del panel de VS Code
    connection.sendDiagnostics({ uri, diagnostics: [] });
});

// --- Arranque ---

documents.listen(connection);
connection.listen();
