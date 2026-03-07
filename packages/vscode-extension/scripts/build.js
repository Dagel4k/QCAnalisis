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
    external: ['vscode'], // No bundleamos vscode, es proveído por el entorno
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
    // Empaquetamos todo el código de QCAnalisis necesario, incl. plugins de ESLint
    const serverCtx = await esbuild.context({
        ...commonOptions,
        entryPoints: ['../../bin/lsp-server.ts'],
        outfile: 'dist/server.js',
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
