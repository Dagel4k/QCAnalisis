import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Repository } from '@/types';

// Lightweight .env loader to ensure server routes have tokens/config without extra deps
function loadEnvFromFile(filePath: string | undefined) {
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    });
  } catch {}
}

function getCurrentDir(): string {
  try {
    if (import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  try {
    if (typeof __dirname !== 'undefined') {
      return __dirname;
    }
  } catch {}
  return process.cwd();
}

function findProjectRoot(): string {
  const possibleRoots = [
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '..', '..'),
    process.cwd(),
  ];

  for (const root of possibleRoots) {
    const scriptPath = path.join(root, 'bin', 'review-gitlab-branches.js');
    if (fs.existsSync(scriptPath)) {
      return root;
    }
  }

  const currentDir = getCurrentDir();
  let current = currentDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(current, '..', '..', '..');
    if (fs.existsSync(path.join(candidate, 'bin', 'review-gitlab-branches.js'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return process.cwd();
}

const projectRoot = findProjectRoot();

// Preload env from common locations before exporting config
(() => {
  // Priority: DOTENV_PATH > projectRoot/.env > parent/.env
  const dotenvPath = process.env.DOTENV_PATH;
  if (dotenvPath) loadEnvFromFile(path.resolve(dotenvPath));
  loadEnvFromFile(path.join(projectRoot, '.env'));
  // Also try parent of projectRoot (useful when dashboard lives inside main repo)
  loadEnvFromFile(path.resolve(projectRoot, '..', '.env'));
})();

function resolveScriptPath(envVar: string, defaultPath: string): string {
  if (envVar && fs.existsSync(envVar)) {
    return envVar;
  }
  const resolved = path.resolve(projectRoot, defaultPath);
  if (fs.existsSync(resolved)) {
    return resolved;
  }
  return envVar || resolved;
}

export const config = {
  gitlabBase: process.env.GITLAB_BASE || '',
  gitlabToken: process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '',
  reviewScriptPath: resolveScriptPath(
    process.env.REVIEW_SCRIPT_PATH || '',
    'bin/review-gitlab-branches.js'
  ),
  reportScriptPath: resolveScriptPath(
    process.env.REPORT_SCRIPT_PATH || '',
    'generate-html-lint-report.js'
  ),
  workDir: process.env.WORK_DIR || path.join(projectRoot, '.work'),
  storageDir: process.env.STORAGE_DIR || path.join(projectRoot, 'reports'),
  defaultIgnore: process.env.DEFAULT_IGNORE || '**/*.pb.ts,**/proto/**,**/node_modules/**',
  defaultGlobs: process.env.DEFAULT_GLOBS || 'src/**/*.{ts,tsx,js,jsx}',
  installDevSpec: process.env.INSTALL_DEV_SPEC || '',
  analyzeOfflineMode: process.env.ANALYZE_OFFLINE_MODE === 'true',
  forceEslintConfig: process.env.FORCE_ESLINT_CONFIG === 'true',
};

export function getRepositories(): Repository[] {
  try {
    const reposPath = path.join(projectRoot, 'repos.json');
    if (!fs.existsSync(reposPath)) {
      const dashboardReposPath = path.join(process.cwd(), 'repos.json');
      if (fs.existsSync(dashboardReposPath)) {
        const content = fs.readFileSync(dashboardReposPath, 'utf-8');
        return JSON.parse(content);
      }
      console.warn('repos.json not found, returning empty array');
      return [];
    }
    const content = fs.readFileSync(reposPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading repos.json:', error);
    return [];
  }
}

export function getRepository(slug: string): Repository | undefined {
  const repos = getRepositories();
  return repos.find(r => r.slug === slug);
}

export function ensureDirectories() {
  if (!fs.existsSync(config.workDir)) {
    fs.mkdirSync(config.workDir, { recursive: true });
  }
  if (!fs.existsSync(config.storageDir)) {
    fs.mkdirSync(config.storageDir, { recursive: true });
  }
}
