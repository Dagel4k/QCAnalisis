@scriptc/dev-tools

Meta devDependency para instalar de un jalón herramientas comunes de revisión:
- ESLint + @typescript-eslint
- Plugins: sonarjs, unicorn, import
- TypeScript
- shiki (para coloreado en reportes HTML)
- ts-prune (exports sin uso)
- jscpd (duplicación de código)

Uso típico:

1) Empaquetar localmente (desde el root de este repo):
   npm run dev-tools:pack

   Esto genera un tarball como packages/dev-tools/scriptc-dev-tools-0.1.0.tgz

2) En el repo a auditar:
   npm i -D file:../ruta/al/tarball.tgz

3) Generar .eslintrc.js:
   npx dev-tools-generate-eslint

4) Ejecutar el generador de reporte HTML (desde este proyecto o copiando el script):
   node /ruta/a/generate-html-lint-report.js

Nota: este paquete sirve como agregador; no configura tu proyecto por sí solo. Úsalo junto con un .eslintrc.js apropiado.

