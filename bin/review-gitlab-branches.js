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

const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---- Simple .env loader (sin dependencia a dotenv) ----
function loadEnvFromFile(filePath) {
  try {
    if (!filePath) return;
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // remove surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    });
  } catch {}
}

// Cargar .env temprano (permite --env-file <ruta> o DOTENV_PATH)
(function preloadDotEnv() {
  let envFile;
  const argv = process.argv;
  const idx = argv.indexOf('--env-file');
  if (idx !== -1 && idx + 1 < argv.length) {
    envFile = path.resolve(argv[idx + 1]);
  } else if (process.env.DOTENV_PATH) {
    envFile = path.resolve(process.env.DOTENV_PATH);
  } else {
    envFile = path.resolve(process.cwd(), '.env');
  }
  loadEnvFromFile(envFile);
})();

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
    installDev: process.env.INSTALL_DEV_SPEC || undefined, // npm spec (e.g. file:../packages/dev-tools/dev-tools-0.1.0.tgz)
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
    forceEslintConfig: false,
    onlyChanged: process.env.ANALYZE_ONLY_CHANGED === 'true',
    help: false,
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
    else if (a === '--force-eslint-config') opts.forceEslintConfig = true;
    else if (a === '--only-changed') opts.onlyChanged = true;
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

function pad2(n) { return n.toString().padStart(2, '0'); }
function makeRunId(base) {
  const d = new Date();
  const ts = `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${sanitizeName(base)}-${ts}`;
}

function run(cmd, opts = {}) {
  const timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : parseInt(process.env.CMD_TIMEOUT_MS || '0', 10) || undefined;
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const res = spawnSync('bash', ['-lc', cmd], { stdio: 'inherit', cwd: opts.cwd, env, timeout });
  if (res.error) throw res.error;
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd}`);
  }
  return res;
}

function runNodeAsync(scriptPath, { cwd, env = {}, args = [], logFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe', // Use pipe to capture output
    });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(text);
      if (logFile) {
        try { fs.appendFileSync(logFile, text.endsWith('\n') ? text : text + '\n'); } catch {}
      }
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      console.error(text);
      if (logFile) {
        try { fs.appendFileSync(logFile, `[ERROR] ${text.endsWith('\n') ? text : text + '\n'}`); } catch {}
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Fallo al ejecutar: node ${scriptPath} (código ${code})`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Fallo al iniciar el script: node ${scriptPath}`, { cause: err }));
    });
  });
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
  let history = [];

  // Resolver ruta del script de reporte
  let reportScript = opts.reportScript || process.env.REPORT_SCRIPT_PATH;
  if (!reportScript) {
    const localCandidate = path.join(rootDir, 'generate-html-lint-report.js');
    if (fs.existsSync(localCandidate)) reportScript = localCandidate;
  }
  if (!reportScript || !fs.existsSync(reportScript)) {
    console.error('No se encontró el script de reporte. Pasa --report-script "/ruta/a/generate-html-lint-report.js" o define REPORT_SCRIPT_PATH.');
    process.exit(1);
  }
  console.log(`Usando script de reporte: ${reportScript}`);

  // Cargar historial previo si existe
  try {
    const existingSummaryPath = path.join(opts.reportsDir, 'summary.json');
    if (fs.existsSync(existingSummaryPath)) {
      const prev = JSON.parse(fs.readFileSync(existingSummaryPath, 'utf8'));
      if (Array.isArray(prev.history)) history = prev.history;
      // mantener compat: si había branches/mrs, conservarlos como último snapshot
      if (Array.isArray(prev.branches)) summary.branches = prev.branches;
      if (Array.isArray(prev.mrs)) summary.mrs = prev.mrs;
    }
  } catch {}

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
    const baseName = task.type === 'mr' ? task.slug : sanitizeName(task.branch);
    const runId = makeRunId(baseName);
    const taskReportsDir = path.join(opts.reportsDir, runId);
    if (!fs.existsSync(taskReportsDir)) fs.mkdirSync(taskReportsDir, { recursive: true });
    const logFile = path.join(taskReportsDir, 'analysis.log');
    const appendLog = (msg, isError = false) => {
      const line = `${isError ? '[ERROR] ' : ''}${msg}`;
      try { fs.appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n'); } catch {}
      if (isError) console.error(msg); else console.log(msg);
    };

    const branchName = task.type === 'mr' ? task.sourceBranch : task.branch;

    try {
      appendLog(`\n==== Clonando ${task.repoUrl} @ ${branchName} (${task.slug}) ====`);
      const reuseClones = process.env.REUSE_CLONES === '1';
      if (fs.existsSync(cloneDir)) {
        if (reuseClones) {
          appendLog(`Reusando clone existente en: ${cloneDir}`);
          try {
            run(`git -C ${cloneDir} remote set-url origin ${cloneUrl}`);
            run(`git -C ${cloneDir} fetch --prune origin`, { timeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '120000', 10) });
            // Asegurar ref y reset
            const refCheck = spawnSync('bash', ['-lc', `git -C ${cloneDir} rev-parse --verify origin/${branchName}`], { encoding: 'utf8' });
            if (refCheck.status !== 0) throw new Error(`No existe origin/${branchName} en el clone`);
            run(`git -C ${cloneDir} reset --hard origin/${branchName}`);
            run(`git -C ${cloneDir} clean -fdx`);
          } catch (e) {
            appendLog(`Fallo al reusar clone, recreando: ${e?.message || e}`, true);
            fs.rmSync(cloneDir, { recursive: true, force: true });
          }
        } else {
          appendLog(`Directorio ya existe, eliminando: ${cloneDir}`);
          fs.rmSync(cloneDir, { recursive: true, force: true });
        }
      }

      // Shallow clone branch (silencioso para evitar falsos "ERROR" por salida en stderr)
      // Evitar cuelgues por prompts interactivos de credenciales
      // Si hay token de GitLab y la URL es HTTPS, usar auth embebida oauth2:<token>
      let cloneUrl = task.repoUrl;
      try {
        if (opts.gitlabToken && /^https?:/i.test(task.repoUrl)) {
          const u = new URL(task.repoUrl);
          u.username = 'oauth2';
          u.password = opts.gitlabToken;
          cloneUrl = u.toString();
        }
      } catch {}
      appendLog(`git clone --depth ${opts.depth} --branch ${branchName} --single-branch ${cloneUrl} ${cloneDir}`);
      if (!fs.existsSync(cloneDir)) {
        const cloneExtra = process.env.SPARSE_CHECKOUT === '1' || process.env.GIT_FILTER_BLOB_NONE === '1' ? '--filter=blob:none' : '';
        run(
          `git clone --quiet ${cloneExtra} --depth ${opts.depth} --branch ${branchName} --single-branch ${cloneUrl} ${cloneDir}`,
          { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: parseInt(process.env.CLONE_TIMEOUT_MS || '300000', 10) }
        );
      }

      // Opcional: instalar meta dev dependency (para ESLint, ts-prune, jscpd, etc.)
      if (opts.installDev && process.env.ANALYZE_OFFLINE_MODE !== 'true') {
        try {
          let spec = String(opts.installDev || '').trim();
          // Normalizar: remover saltos de línea o espacios accidentales dentro del spec
          // (p. ej. "scriptc-dev-\n  tools-0.1.0.tgz")
          spec = spec.replace(/\s+/g, '');
          if (spec.startsWith('file:')) {
            const p = spec.slice(5);
            const abs = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
            if (!fs.existsSync(abs)) {
              console.warn(`No existe el tarball indicado en --install-dev: ${abs}. Se omite instalación.`);
              spec = undefined;
            } else {
              spec = `file:${abs}`;
            }
          }
          if (spec) {
            console.log(`Instalando dev tools: ${spec}`);
            const { spawnSync } = require('child_process');
            const pkgMgr = (process.env.PACKAGE_MANAGER || process.env.PKG_MGR || 'npm').trim();
            const extraFlags = (process.env.NPM_INSTALL_FLAGS || '').trim();

            let cmd = pkgMgr;
            let args;
            if (pkgMgr === 'pnpm') {
              args = ['add', '-D'];
              if (extraFlags) args.push(...extraFlags.split(/\s+/));
              args.push(spec);
              const res = spawnSync(cmd, args, { cwd: cloneDir, stdio: 'inherit' });
              if (res.status !== 0) throw new Error('pnpm add dev tools falló');
            } else if (pkgMgr === 'yarn') {
              args = ['add', '--dev'];
              if (extraFlags) args.push(...extraFlags.split(/\s+/));
              args.push(spec);
              const res = spawnSync(cmd, args, { cwd: cloneDir, stdio: 'inherit' });
              if (res.status !== 0) throw new Error('yarn add dev tools falló');
            } else {
              // npm por defecto
              args = ['i', '-D', '--prefer-offline', '--no-audit', '--no-fund'];
              if (extraFlags) args.push(...extraFlags.split(/\s+/));
              args.push(spec);
              let res = spawnSync('npm', args, { cwd: cloneDir, stdio: 'inherit' });
              if (res.status !== 0) {
                console.warn('npm install falló; reintentando con --legacy-peer-deps');
                const retryArgs = args.includes('--legacy-peer-deps') ? args : [...args.slice(0, -1), '--legacy-peer-deps', spec];
                res = spawnSync('npm', retryArgs, { cwd: cloneDir, stdio: 'inherit' });
                if (res.status !== 0) throw new Error('npm install dev tools falló');
              }
            }
          }
        } catch (err) {
          console.warn('No se pudieron instalar dev tools (continuando de todos modos):', err.message);
        }
      }

      // Preparar NODE_PATH para resolver deps desde el meta-paquete si no están hoisted
      const nodeModules = path.join(cloneDir, 'node_modules');
      const metaNodeModules = path.join(nodeModules, '@scriptc', 'dev-tools', 'node_modules');
      const extraPaths = [nodeModules];
      if (fs.existsSync(metaNodeModules)) extraPaths.push(metaNodeModules);
      // Añadir posibles rutas del proyecto raíz para resolver dependencias compartidas en modo offline
      const rootNodeModules = path.join(rootDir, 'node_modules');
      const localDevToolsNodeModules = path.join(rootDir, 'packages', 'dev-tools', 'node_modules');
      if (fs.existsSync(rootNodeModules)) extraPaths.push(rootNodeModules);
      if (fs.existsSync(localDevToolsNodeModules)) extraPaths.push(localDevToolsNodeModules);

      // Generar .eslintrc.js (si no existe)
      const eslintConfigPath = path.join(cloneDir, '.eslintrc.js');
      if (!fs.existsSync(eslintConfigPath)) {
        appendLog('Generando .eslintrc.js en el repo clonado...');
        await runNodeAsync(path.join(rootDir, 'scripts', 'generate-eslintrc.js'), {
          cwd: cloneDir,
          args: ['--preset', 'typescript-default'],
          logFile,
        });
      } else {
        appendLog('.eslintrc.js ya existe; se usará tal cual.');
      }

      // Opcional: si es MR y se pidió sólo archivos cambiados, calcular lista
      let overrideGlobs = undefined;
      if (opts.onlyChanged && task.type === 'mr' && task.targetBranch) {
        try {
          appendLog(`Calculando archivos cambiados vs ${task.targetBranch}...`);
          run(`git fetch --quiet origin ${task.targetBranch} --depth 1`, { cwd: cloneDir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '120000', 10) });
          const { spawnSync } = require('child_process');
          const diffRes = spawnSync('git', ['diff', '--name-only', `origin/${task.targetBranch}...HEAD`], { cwd: cloneDir, encoding: 'utf-8' });
          if (diffRes.status === 0) {
            const raw = (diffRes.stdout || '');
            const files = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const filtered = files.filter(f => /\.(ts|tsx|js|jsx)$/i.test(f));
            if (filtered.length > 0) {
              overrideGlobs = filtered.join(',');
              appendLog(`Analizando sólo ${filtered.length} archivo(s) cambiado(s).`);
            } else {
              appendLog('No se detectaron archivos de código cambiados; se analizará con globs por defecto.');
            }
          } else {
            appendLog('git diff no pudo calcular cambios; se usarán globs por defecto.', true);
          }
        } catch (e) {
          appendLog(`No se pudo calcular archivos cambiados: ${e?.message || e}`, true);
        }
      }

      // Ejecutar el generador de reporte HTML, asegurando que pueda resolver dependencias del clone
      appendLog('Ejecutando reporte ESLint + extras...');
      const nodePath = extraPaths.join(path.delimiter);
      const ignoreArgs = opts.ignore.length ? ['--ignore', opts.ignore.join(',')] : [];
      const globsValue = overrideGlobs || opts.globs;
      const globArgs = globsValue ? ['--globs', globsValue] : [];
      try {
        await runNodeAsync(reportScript, {
          cwd: cloneDir,
          env: { NODE_PATH: nodePath, REPORT_USE_INTERNAL_ESLINT_CONFIG: opts.forceEslintConfig ? '1' : '' },
          args: [...ignoreArgs, ...globArgs],
          logFile,
        });
      } catch (e) {
        appendLog(`Generación de reporte finalizó con error (continuando): ${e?.message || e}`, true);
      }

      // Copiar reporte a carpeta central
      const sourceReport = path.join(cloneDir, 'reports', 'lint-report.html');
      if (fs.existsSync(sourceReport)) {
        const targetReport = path.join(taskReportsDir, 'lint-report.html');
        fs.copyFileSync(sourceReport, targetReport);
        appendLog(`Reporte copiado: ${targetReport}`);
        // Copiar resumen JSON si existe
        const sourceSummaryJson = path.join(cloneDir, 'reports', 'lint-summary.json');
        let metrics = undefined;
        if (fs.existsSync(sourceSummaryJson)) {
          const targetSummaryJson = path.join(taskReportsDir, 'lint-summary.json');
          fs.copyFileSync(sourceSummaryJson, targetSummaryJson);
          try { metrics = JSON.parse(fs.readFileSync(sourceSummaryJson, 'utf8')); } catch {}
        }

        // Agregar a history
        const entry = {
          id: runId,
          type: task.type,
          report: path.relative(rootDir, targetReport),
          generatedAt: metrics?.generatedAt || new Date().toISOString(),
          metrics,
        };
        if (task.type === 'mr') {
          entry.iid = task.iid;
          entry.title = task.title;
          entry.sourceBranch = task.sourceBranch;
          entry.targetBranch = task.targetBranch;
          entry.name = task.sourceBranch;
        } else {
          entry.branch = task.branch;
          entry.name = task.branch;
        }
        history.push(entry);

        if (task.type === 'mr') {
          summary.mrs.push({ iid: task.iid, title: task.title, sourceBranch: task.sourceBranch, targetBranch: task.targetBranch, report: path.relative(rootDir, targetReport) });
        } else {
          summary.branches.push({ branch: task.branch, report: path.relative(rootDir, targetReport) });
        }
      } else {
        appendLog('No se encontró lint-report.html en el clone.', true);
      }

    } catch (err) {
      appendLog(`Error con la tarea ${task.slug}: ${err.message}`, true);
      if (task.type === 'mr') summary.mrs.push({ iid: task.iid, error: err.message });
      else summary.branches.push({ branch: task.branch, error: err.message });
    } finally {
      if (opts.cleanup) {
        appendLog('Limpiando clone...');
        try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch {}
      } else {
        appendLog(`Conservado clone en: ${cloneDir}`);
      }
    }
  }

  // Guardar resumen
  const summaryPath = path.join(opts.reportsDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ repo: opts.repo, ...summary, history, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\n📄 Resumen guardado en: ${summaryPath}`);
}

main().catch((e) => {
  console.error('Fallo no controlado:', e);
  process.exit(1);
});
