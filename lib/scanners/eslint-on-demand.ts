/**
 * eslint-on-demand.ts — Motor de análisis ESLint para el servidor LSP.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  DIAGNÓSTICO DEL PROBLEMA RAÍZ (por qué fallaban los intentos anteriores)  ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                              ║
 * ║  ESLint v8 tiene una limitación arquitectónica fundamental:                 ║
 * ║                                                                              ║
 * ║  Cuando se llama a `eslint.lintText(text, { filePath: '/proyecto-externo/  ║
 * ║  test.ts' })`, el motor de ESLint usa el `filePath` como BASE de resolución ║
 * ║  de plugins, INCLUSO con `useEslintrc: false` y `overrideConfigFile`.       ║
 * ║                                                                              ║
 * ║  Esto ocurre porque `CascadingConfigArrayFactory` (interna de ESLint v8)   ║
 * ║  mezcla el directorio del `filePath` con el del archivo de config al        ║
 * ║  calcular los `modulePaths` para `require.resolve`. Al no existir           ║
 * ║  `node_modules` en `/proyecto-externo/`, la resolución falla.              ║
 * ║                                                                              ║
 * ║  `resolvePluginsRelativeTo` solo afecta la resolución del array `plugins:` ║
 * ║  en el config, pero NOT los strings del array `extends:`.                   ║
 * ║  ('extends: plugin:unicorn/recommended' siempre usa el filePath como base). ║
 * ║                                                                              ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  SOLUCIÓN: API `Linter` (clase interna de ESLint, diferente de `ESLint`)   ║
 * ║                                                                              ║
 * ║  La clase `Linter` (no `ESLint`) es el motor síncrono puro de ESLint.      ║
 * ║  Acepta plugins y parsers como OBJETOS JavaScript inyectados directamente   ║
 * ║  vía `linter.defineRule()` y `linter.defineParser()`.                       ║
 * ║  No realiza NINGUNA llamada a `require()` internamente para resolver        ║
 * ║  plugins. El `filePath` en `linter.verify()` solo sirve para el formateo   ║
 * ║  de mensajes y la selección de sobreescrituras, nunca para resolución de    ║
 * ║  módulos. Es 100% agnóstico al sistema de ficheros del proyecto del usuario.║
 * ║                                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { Linter, ESLint, Rule } from 'eslint';
import { fileURLToPath } from 'url';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/**
 * Resultado de diagnóstico normalizado. Todas las posiciones son 1-based
 * (formato nativo de ESLint). La conversión a 0-based para el protocolo LSP
 * es responsabilidad del servidor LSP (lsp-server.ts).
 */
export interface EslintDiagnosticItem {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    /** 1 = warning, 2 = error */
    severity: 1 | 2;
    message: string;
    ruleId: string | null;
}

// ---------------------------------------------------------------------------
// Fallback Linter: inicialización singleton con inyección directa de plugins
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlugin = Record<string, any>;

/**
 * Registra todas las reglas de un plugin en el Linter con su prefijo canónico.
 * Ej: { 'detect-eval': ruleDef } → linter.defineRule('security/detect-eval', ruleDef)
 * `defineRule` acepta el objeto de regla directamente, sin resolución de filesystem.
 */
function registerPluginRules(linter: Linter, prefix: string, plugin: AnyPlugin): void {
    const rules = plugin.rules as Record<string, Rule.RuleModule> | undefined;
    if (!rules) return;
    for (const [name, rule] of Object.entries(rules)) {
        linter.defineRule(`${prefix}/${name}`, rule);
    }
}

/**
 * Extrae el objeto `rules` del config recomendado de un plugin.
 * Prefiere el formato `recommended-legacy` (eslintrc) si existe, luego `recommended`.
 * En ambos, el campo `.rules` tiene el mismo esquema `{ ruleId: severity | [severity, opts] }`.
 */
function extractRecommendedRules(plugin: AnyPlugin): Partial<Linter.RulesRecord> {
    const config: AnyPlugin =
        (plugin.configs?.['recommended-legacy'] as AnyPlugin) ??
        (plugin.configs?.recommended as AnyPlugin) ??
        {};
    return (config.rules as Partial<Linter.RulesRecord>) ?? {};
}

/**
 * Construye el Linter singleton de ScriptC con plugins inyectados en memoria.
 * Se ejecuta UNA SOLA VEZ al cargar el módulo (en el arranque del servidor LSP).
 *
 * ⚠️  NOTA SOBRE UNICORN: eslint-plugin-unicorn v55+ requiere ESLint >=9.x.
 *     El proyecto usa ESLint 8.x, por lo que unicorn NO está incluido en el
 *     fallback para evitar errores de incompatibilidad en `Linter.verify()`.
 *     Unicorn seguirá funcionando en la Fase 1 (config del proyecto) si el
 *     proyecto analizado tiene ESLint 9 y unicorn configurado por su cuenta.
 *
 * Si algún plugin no está instalado, retorna `null` para fallo suave.
 */
function tryBuildFallbackLinter(): { linter: Linter; rules: FallbackRules } | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sonarjs = require('eslint-plugin-sonarjs') as AnyPlugin;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const security = require('eslint-plugin-security') as AnyPlugin;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const tsPlugin = require('@typescript-eslint/eslint-plugin') as AnyPlugin;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const tsParser = require('@typescript-eslint/parser') as Linter.Parser;

        const linter = new Linter();

        // Registrar el parser de TypeScript por nombre para que `verify()` pueda
        // referenciarlo como `parser: '@typescript-eslint/parser'` en el config.
        linter.defineParser('@typescript-eslint/parser', tsParser);

        // Inyectar todas las reglas con su prefijo canónico.
        // Linter.defineRule() acepta objetos de regla directamente, SIN filesystem.
        registerPluginRules(linter, 'sonarjs', sonarjs);
        registerPluginRules(linter, 'security', security);
        registerPluginRules(linter, '@typescript-eslint', tsPlugin);

        // Pre-computar el conjunto de reglas recomendadas una sola vez para
        // no recalcularlo en cada petición de análisis.
        const baseRules: Partial<Linter.RulesRecord> = {
            ...extractRecommendedRules(sonarjs),
            ...extractRecommendedRules(security),
            // Reglas base útiles añadidas manualmente
            'no-unused-vars': 1,     // 1 = Warning
            'no-var': 2,             // 2 = Error
            'eqeqeq': 1,             // 1 = Warning
            'no-console': 1          // 1 = Warning
        };

        const rules: FallbackRules = {
            base: baseRules,
            typescript: {
                ...baseRules,
                ...extractRecommendedRules(tsPlugin),
                '@typescript-eslint/no-unused-vars': 1, // 1 = Warning
                'no-unused-vars': 0 // Se apaga la base para evitar duplicados en TS
            }
        };

        return { linter, rules };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[ScriptC] No se pudo inicializar el fallback Linter: ${msg}\n`);
        return null;
    }
}

interface FallbackRules {
    base: Partial<Linter.RulesRecord>;
    typescript: Partial<Linter.RulesRecord>;
}

// Singleton — inicializado al cargar el módulo, reutilizado en cada petición
const fallback = tryBuildFallbackLinter();

/**
 * Construye el config para `Linter.verify()` según el tipo de archivo.
 * NO usa `extends` (que requiere resolución de filesystem), sino reglas inlineadas.
 */
function buildLinterConfig(isTypeScript: boolean): Linter.LegacyConfig {
    if (!fallback) {
        throw new Error(
            '[ScriptC] Los plugins de ESLint no están disponibles. ' +
            'Ejecuta `npm install` en el directorio de QCAnalisis.'
        );
    }

    const common: Linter.LegacyConfig = {
        env: { es2021: true, browser: true, node: true },
        parserOptions: {
            ecmaVersion: 2021,
            sourceType: 'module',
            ecmaFeatures: { jsx: true }
        },
        rules: isTypeScript ? fallback.rules.typescript : fallback.rules.base
    };

    if (isTypeScript) {
        // El parser de TS fue registrado con defineParser(), lo referenciamos por nombre
        return { ...common, parser: '@typescript-eslint/parser' };
    }

    return common;
}

// ---------------------------------------------------------------------------
// Helpers de mapeo
// ---------------------------------------------------------------------------

function isConfigResolutionError(error: Error): boolean {
    return (
        error.message.includes('Failed to load config') ||
        error.message.includes('Cannot find module') ||
        error.message.includes('find the module') ||
        error.message.includes('No ESLint configuration found') ||
        ('code' in error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND')
    );
}

function mapMessages(messages: Linter.LintMessage[]): EslintDiagnosticItem[] {
    const items: EslintDiagnosticItem[] = [];

    for (const msg of messages) {
        // Filtrar el ruido de "Definition for rule X was not found"
        // (puede ocurrir si alguna regla del plugin recomendado no existe en esta versión)
        if (msg.message.startsWith('Definition for rule') && msg.ruleId === null) {
            continue;
        }

        const startLine = msg.line ?? 1;
        const startCol = msg.column ?? 1;

        items.push({
            line: startLine,
            column: startCol,
            endLine: msg.endLine ?? startLine,
            endColumn: msg.endColumn ?? startCol + 1,
            severity: msg.severity as 1 | 2,
            message: msg.message,
            ruleId: msg.ruleId ?? null
        });
    }

    return items;
}

function mapEslintResults(results: ESLint.LintResult[]): EslintDiagnosticItem[] {
    const items: EslintDiagnosticItem[] = [];
    for (const result of results) {
        items.push(...mapMessages(result.messages));
    }
    return items;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Analiza texto en memoria usando ESLint. Estrategia en dos fases:
 *
 * **Fase 1 — Config del proyecto**: intenta usar la configuración ESLint del proyecto
 * del usuario (si existe). Respeta las reglas y plugins que el equipo ya tiene.
 *
 * **Fase 2 — Fallback ScriptC (Linter puro)**: si el proyecto no tiene ESLint
 * configurado (o la config falla por dependencias no instaladas), usa el `Linter`
 * interno de ESLint con plugins inyectados en memoria.
 *
 * La Fase 2 es 100% agnóstica del ecosistema del proyecto del usuario:
 * no realiza NINGUNA búsqueda en los `node_modules` de la máquina del usuario.
 *
 * @param text    Contenido actual del archivo (en memoria).
 * @param fileUri URI del archivo en formato LSP (`file:///ruta/al/archivo.ts`).
 *                Determina el parser y el nombre en los mensajes de error.
 */
export async function runEslintOnDemand(
    text: string,
    fileUri: string
): Promise<EslintDiagnosticItem[]> {
    const filePath = fileURLToPath(fileUri);
    const cwd = path.dirname(filePath);

    // --- Fase 1: Config del proyecto ---
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opts: any = { cwd, fix: false, useEslintrc: true, errorOnUnmatchedPattern: false };
        const eslint = new ESLint(opts);
        const results = await eslint.lintText(text, { filePath });
        return mapEslintResults(results);
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!isConfigResolutionError(error)) {
            throw err;
        }
    }

    // --- Fase 2: Fallback con Linter puro + plugins inyectados ---
    // Linter.verify() es SÍNCRONO, pero lo envolvemos en async para mantener
    // la interfaz consistente con la Fase 1.
    const isTypeScript =
        filePath.endsWith('.ts') ||
        filePath.endsWith('.tsx');

    const config = buildLinterConfig(isTypeScript);

    // filename en verify() solo afecta los mensajes de salida, NUNCA la resolución
    // de módulos. Esto es lo que nos libera del problema de los node_modules externos.
    const messages = fallback!.linter.verify(text, config, { filename: filePath });

    return mapMessages(messages);
}
