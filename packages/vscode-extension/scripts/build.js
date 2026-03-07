const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

const commonOptions = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    platform: 'node',
    target: 'node18', // VS Code >= 1.75 usa Node 16+, pero Node 18 es seguro para LS actual
    format: 'cjs',
    // vscode: provisto por el Extension Host, nunca se bundlea
    // espree: eslint/rule-tester lo referencia con require.resolve() en un path que
    //         nunca se ejecuta en producción; marcarlo external silencia el warning de esbuild
    external: ['vscode', 'espree'],
    logLevel: 'info'
};

const ctxs = [];

async function main() {
    // 1. Bundle de la Extensión Cliente
    const extensionCtx = await esbuild.context({
        ...commonOptions,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/extension.js',
        plugins: [esbuildProblemMatcherPlugin],
    });
    ctxs.push(extensionCtx);

    // 2. Bundle del Servidor LSP
    // Empaquetamos el código de QCAnalisis + sus dependencias resolubles desde el root.
    //
    // sonarjs y security se mantienen como external porque:
    //  a) Viven en packages/dev-tools/node_modules (no hoisted al root), así que esbuild
    //     no puede encontrarlos sin manipulación de nodePaths.
    //  b) sonarjs v4 usa require(`./rules/${rule}`) con template literal + array estático;
    //     esbuild lo intenta bundlear pero los archivos .js.map satélite rompen el proceso.
    //  Al declararlos external, se mantienen como require() dinámicos en el bundle y
    //  Node los resuelve en runtime desde packages/vscode-extension/node_modules/.
    const serverCtx = await esbuild.context({
        ...commonOptions,
        entryPoints: ['../../bin/lsp-server.ts'],
        outfile: 'dist/server.js',
        external: [
            ...commonOptions.external,
            'eslint-plugin-sonarjs',
            'eslint-plugin-security',
        ],
    });
    ctxs.push(serverCtx);

    if (watch) {
        await Promise.all(ctxs.map(ctx => ctx.watch()));
    } else {
        await Promise.all(ctxs.map(ctx => ctx.rebuild()));
        await Promise.all(ctxs.map(ctx => ctx.dispose()));
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
