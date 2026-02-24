#!/usr/bin/env node
/*
  CLI para:
  - Clonar ramas de un repo (GitLab/Git) de forma shallow
  - Generar reporte HTML (ESLint + ts-prune + jscpd) usando generate-html-lint-report.js
  - Copiar reportes a una carpeta central
  - Limpiar clones temporales

  Uso rápido:
  node bin/review-gitlab-branches.js \
    --repo https://gitlab.com/org/proyecto.git \
    --branches feature/x,bugfix/y \
    --install-dev "file:../packages/dev-tools/dev-tools-0.1.0.tgz"
*/

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo: undefined,
    branches: [],
    branchesFile: undefined,
    workDir: path.resolve(process.cwd(), '.work'),
    reportsDir: path.resolve(process.cwd(), 'reports'),
    ignore: [],
    cleanup: true,
    depth: 1,
    installDev: undefined, // npm spec (e.g. file:../packages/dev-tools/dev-tools-0.1.0.tgz)
    // GitLab MR integration
    fromGitlabMrs: false,
    fromGitlabBranches: false,
    gitlabBase: process.env.GITLAB_BASE || undefined,
    gitlabToken: process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || undefined,
    mrState: 'opened',
    mrTargetBranch: undefined,
    mrLabels: [],
    globs: undefined,
    branchFilter: undefined, // regex string to include branches
    fallbackDefault: true,
    reportScript: process.env.REPORT_SCRIPT || undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo') opts.repo = args[++i];
    else if (a === '--branches') opts.branches = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--branches-file') opts.branchesFile = args[++i];
    else if (a === '--work-dir') opts.workDir = path.resolve(args[++i]);
    else if (a === '--reports-dir') opts.reportsDir = path.resolve(args[++i]);
    else if (a === '--ignore') opts.ignore = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--no-cleanup') opts.cleanup = false;
    else if (a === '--depth') opts.depth = parseInt(args[++i], 10) || 1;
    else if (a === '--install-dev') opts.installDev = args[++i];
    else if (a === '--from-gitlab-mrs') opts.fromGitlabMrs = true;
    else if (a === '--from-gitlab-branches') opts.fromGitlabBranches = true;
    else if (a === '--gitlab-base') opts.gitlabBase = args[++i];
    else if (a === '--gitlab-token') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.gitlabToken = args[++i];
      } else {
        console.warn('Flag --gitlab-token sin valor; se usará $GITLAB_TOKEN si está definido.');
      }
    }
    else if (a === '--mr-state') opts.mrState = args[++i];
    else if (a === '--mr-target-branch') opts.mrTargetBranch = args[++i];
    else if (a === '--mr-labels') opts.mrLabels = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--globs') opts.globs = args[++i];
    else if (a === '--branch-filter') opts.branchFilter = args[++i];
    else if (a === '--no-fallback-default') opts.fallbackDefault = false;
    else if (a === '--report-script') opts.reportScript = args[++i];
  }

  if (!opts.repo) {
    console.error('Falta --repo <git_url>');
    process.exit(1);
  }

  if (opts.branchesFile && fs.existsSync(opts.branchesFile)) {
    const fileContent = fs.readFileSync(opts.branchesFile, 'utf8');
    const list = fileContent.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    opts.branches.push(...list);
  }

  opts.branches = Array.from(new Set(opts.branches));
  if (!opts.fromGitlabMrs && !opts.fromGitlabBranches && opts.branches.length === 0) {
    console.warn('No se especificaron ramas ni MRs. Puedes usar --branches, --branches-file, --from-gitlab-mrs o --from-gitlab-branches.');
  }

  return opts;
}

function ensureCmd(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  return res.status === 0;
}

function sanitizeName(s) {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runNode(scriptPath, { cwd, env = {}, args = [] } = {}) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`Fallo al ejecutar: node ${scriptPath}`);
  }
}

// ---------- GitLab helpers ----------
const https = require('https');

function parseProjectPathFromRepoUrl(repoUrl) {
  try {
    const u = new URL(repoUrl);
    // trim leading '/'
    let p = u.pathname.replace(/^\//, '');
    // drop .git suffix
    p = p.replace(/\.git$/i, '');
    return { host: `${u.protocol}//${u.host}`, projectPath: p };
  } catch {
    return { host: undefined, projectPath: undefined };
  }
}

function gitlabApiGetJson(baseUrl, token, pathname, query = {}) {
  // Asegurar que mantenemos /api/v4 en la URL
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const pathNoLead = pathname.replace(/^\//, '');
  const urlObj = new URL(base + pathNoLead);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}`.length) urlObj.searchParams.set(k, v);
  });

  const headers = token ? { 'PRIVATE-TOKEN': token } : {};

  return new Promise((resolve, reject) => {
    const req = https.get(urlObj, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({ json, headers: res.headers });
          } catch (e) {
            reject(new Error(`Respuesta no JSON de ${urlObj.href}`));
          }
        } else {
          reject(new Error(`GitLab API ${urlObj.href} -> ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchMrSourceTasks(opts) {
  const { host: repoHost, projectPath } = parseProjectPathFromRepoUrl(opts.repo);
  const gitlabBase = opts.gitlabBase || (repoHost ? `${repoHost}/api/v4` : undefined);
  if (!gitlabBase) throw new Error('No se pudo determinar gitlab base. Usa --gitlab-base o URL de repo https://host/...');
  if (!opts.gitlabToken) console.warn('Advertencia: sin --gitlab-token ni $GITLAB_TOKEN, podría fallar si el proyecto es privado.');

  const projectIdEnc = encodeURIComponent(projectPath);
  // MRs
  const { json: mrs } = await gitlabApiGetJson(gitlabBase, opts.gitlabToken, `/projects/${projectIdEnc}/merge_requests`, {
    state: opts.mrState || 'opened',
    per_page: 100,
    target_branch: opts.mrTargetBranch,
    labels: opts.mrLabels && opts.mrLabels.length ? opts.mrLabels.join(',') : undefined,
  });

  // Map de projectId -> repoUrl
  const sourceProjectIds = Array.from(new Set(mrs.map(m => m.source_project_id).filter(Boolean)));
  const projectMap = {};
  for (const pid of sourceProjectIds) {
    if (`${pid}` === `${mrs[0]?.target_project_id}`) {
      projectMap[pid] = opts.repo;
      continue;
    }
    try {
      const { json: proj } = await gitlabApiGetJson(gitlabBase, opts.gitlabToken, `/projects/${pid}`);
      projectMap[pid] = proj.http_url_to_repo || proj.ssh_url_to_repo;
    } catch {
      projectMap[pid] = opts.repo; // fallback
    }
  }

  const tasks = mrs.map((mr) => ({
    type: 'mr',
    iid: mr.iid,
    title: mr.title,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    repoUrl: projectMap[mr.source_project_id] || opts.repo,
    slug: `mr-${mr.iid}-${sanitizeName(mr.source_branch)}`,
  }));

  return tasks;
}

async function fetchGitlabBranches(opts) {
  const { host: repoHost, projectPath } = parseProjectPathFromRepoUrl(opts.repo);
  const gitlabBase = opts.gitlabBase || (repoHost ? `${repoHost}/api/v4` : undefined);
  if (!gitlabBase) throw new Error('No se pudo determinar gitlab base. Usa --gitlab-base o URL de repo https://host/...');
  if (!opts.gitlabToken) console.warn('Advertencia: sin --gitlab-token ni $GITLAB_TOKEN, podría fallar si el proyecto es privado.');

  const projectIdEnc = encodeURIComponent(projectPath);
  const { json: branches } = await gitlabApiGetJson(gitlabBase, opts.gitlabToken, `/projects/${projectIdEnc}/repository/branches`, { per_page: 100 });
  let list = branches.map(b => b.name);
  if (opts.branchFilter) {
    try {
      const re = new RegExp(opts.branchFilter);
      list = list.filter(name => re.test(name));
    } catch {
      console.warn('branch-filter no es un regex válido, se ignorará.');
    }
  }
  return list.map((name) => ({
    type: 'branch',
    branch: name,
    repoUrl: opts.repo,
    slug: `branch-${sanitizeName(name)}`,
  }));
}

async function main() {
  const opts = parseArgs();

  if (!ensureCmd('git')) {
    console.error('git no está disponible en PATH.');
    process.exit(1);
  }

  if (!fs.existsSync(opts.workDir)) fs.mkdirSync(opts.workDir, { recursive: true });
  if (!fs.existsSync(opts.reportsDir)) fs.mkdirSync(opts.reportsDir, { recursive: true });

  const rootDir = process.cwd();
  const summary = { branches: [], mrs: [] };

  // Resolver ruta del script de reporte
  let reportScript = opts.reportScript;
  const absolutePreferred = '/Users/daniel/Downloads/scriptCCode/generate-html-lint-report.js';
  if (!reportScript) {
    if (fs.existsSync(absolutePreferred)) {
      reportScript = absolutePreferred;
    } else {
      const localCandidate = path.join(rootDir, 'generate-html-lint-report.js');
      if (fs.existsSync(localCandidate)) reportScript = localCandidate;
    }
  }
  if (!reportScript || !fs.existsSync(reportScript)) {
    console.error('No se encontró el script de reporte. Pasa --report-script "/ruta/a/generate-html-lint-report.js"');
    process.exit(1);
  }
  console.log(`Usando script de reporte: ${reportScript}`);

  const manualTasks = opts.branches.map((branch) => ({
    type: 'branch',
    branch,
    repoUrl: opts.repo,
    slug: `branch-${sanitizeName(branch)}`,
  }));
  let mrTasks = [];
  let branchTasks = [];
  if (opts.fromGitlabMrs) {
    try {
      mrTasks = await fetchMrSourceTasks(opts);
      console.log(`MRs a revisar: ${mrTasks.length}`);
    } catch (e) {
      console.error('Fallo al obtener MRs de GitLab:', e.message);
      process.exit(1);
    }
  }
  if (opts.fromGitlabBranches) {
    try {
      branchTasks = await fetchGitlabBranches(opts);
      console.log(`Ramas a revisar (GitLab): ${branchTasks.length}`);
    } catch (e) {
      console.error('Fallo al obtener ramas de GitLab:', e.message);
      process.exit(1);
    }
  }

  let tasks = [...mrTasks, ...branchTasks, ...manualTasks];

  if (tasks.length === 0 && opts.fallbackDefault) {
    try {
      const { host: repoHost, projectPath } = parseProjectPathFromRepoUrl(opts.repo);
      const gitlabBase = opts.gitlabBase || (repoHost ? `${repoHost}/api/v4` : undefined);
      const projectIdEnc = encodeURIComponent(projectPath);
      const { json: proj } = await gitlabApiGetJson(gitlabBase, opts.gitlabToken, `/projects/${projectIdEnc}`);
      if (proj?.default_branch) {
        const def = proj.default_branch;
        console.log(`Sin tareas explícitas, usando default_branch: ${def}`);
        tasks = [{ type: 'branch', branch: def, repoUrl: opts.repo, slug: `branch-${sanitizeName(def)}` }];
      }
    } catch (e) {
      console.warn('No se pudo obtener default_branch; intenta con --branches main');
    }
  }
  if (tasks.length === 0) {
    console.error('No hay tareas para ejecutar.');
    process.exit(1);
  }

  for (const task of tasks) {
    const repoName = sanitizeName(path.basename(task.repoUrl, path.extname(task.repoUrl)) || 'repo');
    const cloneDirName = `${repoName}-${task.slug}`;
    const cloneDir = path.join(opts.workDir, cloneDirName);
    const destDirName = task.type === 'mr' ? task.slug : sanitizeName(task.branch);
    const taskReportsDir = path.join(opts.reportsDir, destDirName);
    if (!fs.existsSync(taskReportsDir)) fs.mkdirSync(taskReportsDir, { recursive: true });

    const branchName = task.type === 'mr' ? task.sourceBranch : task.branch;

    try {
      console.log(`\n==== Clonando ${task.repoUrl} @ ${branchName} (${task.slug}) ====`);
      if (fs.existsSync(cloneDir)) {
        console.log(`Directorio ya existe, eliminando: ${cloneDir}`);
        fs.rmSync(cloneDir, { recursive: true, force: true });
      }

      // Shallow clone branch (silencioso para evitar falsos "ERROR" por salida en stderr)
      const cloneRes = spawnSync('git', [
        'clone', '--quiet', '--depth', String(opts.depth),
        '--branch', branchName, '--single-branch', task.repoUrl, cloneDir
      ], { stdio: 'inherit' });
      if (cloneRes.error) throw cloneRes.error;
      if (cloneRes.status !== 0) throw new Error(`Git clone failed with status ${cloneRes.status}`);

      // Opcional: instalar meta dev dependency (para ESLint, ts-prune, jscpd, etc.)
      if (opts.installDev) {
        try {
          let spec = opts.installDev;
          if (spec.startsWith('file:')) {
            const p = spec.slice(5);
            const abs = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
            spec = `file:${abs}`;
          }
          console.log(`Instalando dev tools: ${spec}`);
          run(`npm i -D --prefer-offline --no-audit --no-fund ${spec}`, { cwd: cloneDir });
        } catch (err) {
          console.warn('No se pudieron instalar dev tools (continuando de todos modos):', err.message);
        }
      }

      // Preparar NODE_PATH para resolver deps desde el meta-paquete si no están hoisted
      const nodeModules = path.join(cloneDir, 'node_modules');
      const metaNodeModules = path.join(nodeModules, '@scriptc', 'dev-tools', 'node_modules');
      const extraPaths = [nodeModules];
      if (fs.existsSync(metaNodeModules)) extraPaths.push(metaNodeModules);

      // Generar .eslintrc.js (si no existe)
      const eslintConfigPath = path.join(cloneDir, '.eslintrc.js');
      if (!fs.existsSync(eslintConfigPath)) {
        console.log('Generando .eslintrc.js en el repo clonado...');
        runNode(path.join(rootDir, 'scripts', 'generate-eslintrc.js'), {
          cwd: cloneDir,
          args: ['--preset', 'typescript-default']
        });
      } else {
        console.log('.eslintrc.js ya existe; se usará tal cual.');
      }

      // Ejecutar el generador de reporte HTML, asegurando que pueda resolver dependencias del clone
      console.log('Ejecutando reporte ESLint + extras...');
      const nodePath = extraPaths.join(path.delimiter);
      const ignoreArgs = opts.ignore.length ? ['--ignore', opts.ignore.join(',')] : [];
      const globArgs = opts.globs ? ['--globs', opts.globs] : [];
      runNode(reportScript, {
        cwd: cloneDir,
        env: { NODE_PATH: nodePath },
        args: [...ignoreArgs, ...globArgs],
      });

      // Copiar reporte a carpeta central
      const sourceReport = path.join(cloneDir, 'reports', 'lint-report.html');
      if (fs.existsSync(sourceReport)) {
        const targetReport = path.join(taskReportsDir, 'lint-report.html');
        fs.copyFileSync(sourceReport, targetReport);
        console.log(`Reporte copiado: ${targetReport}`);
        if (task.type === 'mr') {
          summary.mrs.push({ iid: task.iid, title: task.title, sourceBranch: task.sourceBranch, targetBranch: task.targetBranch, report: path.relative(rootDir, targetReport) });
        } else {
          summary.branches.push({ branch: task.branch, report: path.relative(rootDir, targetReport) });
        }
      } else {
        console.warn('No se encontró lint-report.html en el clone.');
      }

    } catch (err) {
      console.error(`Error con la tarea ${task.slug}:`, err.message);
      if (task.type === 'mr') summary.mrs.push({ iid: task.iid, error: err.message });
      else summary.branches.push({ branch: task.branch, error: err.message });
    } finally {
      if (opts.cleanup) {
        console.log('Limpiando clone...');
        try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch (e) { /* noop */ }
      } else {
        console.log(`Conservado clone en: ${cloneDir}`);
      }
    }
  }

  // Guardar resumen
  const summaryPath = path.join(opts.reportsDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ repo: opts.repo, ...summary }, null, 2));
  console.log(`\n📄 Resumen guardado en: ${summaryPath}`);
}

main().catch((e) => {
  console.error('Fallo no controlado:', e);
  process.exit(1);
});
