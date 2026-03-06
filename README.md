# ScriptC

Local-first static code analysis platform integrating ESLint, Knip, Semgrep, Gitleaks, JSCPD, and OSV-Scanner.

## Overview

- **Local Execution:** Runs entirely on your machine.
- **Sandboxed:** Clones/analyzes in isolated `.work/` directories.
- **Privacy:** No external servers, analytics, or telemetry.
- **Stack:** Node.js (Orchestrator/CLI) + React/Vite (Dashboard).

## Setup

1. **Clone & Install**
   ```bash
   git clone <repo-url>
   cd scriptc
   npm install
   ```

2. **Environment Configuration**
   Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   # Set GITLAB_TOKEN if analyzing private repos
   ```

## Usage

### 1. Web Dashboard (Recommended)

Interactive UI for managing scans and viewing reports.

```bash
cd repo-scan-dashboard-main
npm run dev
# Open http://localhost:8080
```

- **Repos:** Manage via `repos.json` in the project root or the UI.
- **Reports:** Stored in `storage/<repo-slug>/`.

### 2. CLI: Ad-hoc Analysis

Analyze a local directory or specific remote branch.

```bash
# Analyze current directory
node bin/review-gitlab-branches.js \
  --repo . \
  --branches current \
  --globs 'src/**/*.{ts,tsx}' \
  --reports-dir reports

# Analyze remote GitLab branch
node bin/review-gitlab-branches.js \
  --repo https://gitlab.example.com/org/repo.git \
  --branches main \
  --reports-dir reports
```

### 3. CLI: Merge Requests

Scan all open MRs for a repository.

```bash
node bin/review-gitlab-branches.js \
  --repo <repo-url> \
  --from-gitlab-mrs \
  --gitlab-token $GITLAB_TOKEN
```

## Configuration

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_BASE` | GitLab API URL | `https://gitlab.com/api/v4` |
| `GITLAB_TOKEN` | Personal Access Token | - |
| `WORK_DIR` | Temporary clone location | `.work` |
| `STORAGE_DIR` | Persistent report storage | `storage` |
| `REPORT_NO_SEMGREP` | 1 to disable Semgrep | 0 |
| `REPORT_NO_GITLEAKS` | 1 to disable Gitleaks | 0 |

### Repositories

Manage the list of repositories available in the Dashboard by editing `repos.json` in the project root. You can copy `repos.example.json` to get started:

```bash
cp repos.example.json repos.json
```

```json
[
  {
    "slug": "backend-api",
    "name": "Backend API",
    "repoUrl": "https://gitlab.example.com/org/backend.git",
    "description": "Node.js Service"
  }
]
```

## Architecture

- **Orchestrator:** `lib/orchestrator.ts` manages the analysis lifecycle (Clone -> Sandbox -> Scan -> Report).
- **Scanners:** `lib/scanners/` contains adapters for each tool (ESLint, Knip, etc).
- **Dashboard:** `repo-scan-dashboard-main/` is a standalone React app consuming `storage/` JSON data.

For detailed architecture, see `DOCUMENTACION_COMPLETA.md`.
For design principles, see `GEMINI.md`.
