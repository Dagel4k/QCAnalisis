#!/usr/bin/env bash
set -euo pipefail

echo "[P1/P2] Setup Semgrep + Gitleaks + OSV-Scanner"

have_cmd() { command -v "$1" >/dev/null 2>&1; }

if have_cmd semgrep; then
  echo "- semgrep found: $(semgrep --version 2>/dev/null || true)"
else
  echo "- semgrep not found"
  if have_cmd brew; then
    echo "  Installing via Homebrew..."
    brew install semgrep || true
  elif have_cmd apt-get; then
    echo "  Installing via apt-get..."
    sudo apt-get update && sudo apt-get install -y python3-pip || true
    pip3 install semgrep || true
  elif have_cmd choco; then
    echo "  Installing via Chocolatey..."
    choco install semgrep -y || true
  else
    echo "  Skipping auto-install. You can use Docker fallback or install manually: https://semgrep.dev/docs/getting-started/"
  fi
fi

if have_cmd gitleaks; then
  echo "- gitleaks found: $(gitleaks version 2>/dev/null || true)"
else
  echo "- gitleaks not found"
  if have_cmd brew; then
    echo "  Installing via Homebrew..."
    brew install gitleaks || true
  elif have_cmd apt-get; then
    echo "  Installing via apt-get (download latest release)..."
    tmp=$(mktemp -d)
    cd "$tmp"
    curl -sSL -o gitleaks.tar.gz https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_$(uname -s)_$(uname -m).tar.gz || true
    tar -xzf gitleaks.tar.gz || true
    sudo install -m 0755 gitleaks /usr/local/bin/gitleaks || true
    cd - >/dev/null || true
  elif have_cmd choco; then
    echo "  Installing via Chocolatey..."
    choco install gitleaks -y || true
  else
    echo "  Skipping auto-install. You can use Docker fallback or install manually: https://github.com/gitleaks/gitleaks"
  fi
fi

echo "\nIf binaries are not installed, the analyzer can run them via Docker automatically if Docker is available."
echo "Done."

# --- OSV-Scanner ---
if have_cmd osv-scanner; then
  echo "- osv-scanner found: $(osv-scanner --version 2>/dev/null | head -n1 || true)"
else
  echo "- osv-scanner not found"
  if have_cmd brew; then
    echo "  Installing via Homebrew..."
    brew install osv-scanner || true
  elif have_cmd apt-get; then
    echo "  Installing via release tarball..."
    tmp=$(mktemp -d)
    cd "$tmp"
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64|amd64) OSV_ARCH="x86_64" ;;
      aarch64|arm64) OSV_ARCH="arm64" ;;
      *) OSV_ARCH="x86_64" ;;
    esac
    URL="https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_Linux_${OSV_ARCH}.tar.gz"
    echo "  Downloading $URL"
    curl -sSL -o osv-scanner.tar.gz "$URL" || true
    tar -xzf osv-scanner.tar.gz || true
    if [ -f osv-scanner ]; then
      sudo install -m 0755 osv-scanner /usr/local/bin/osv-scanner || true
      echo "  Installed /usr/local/bin/osv-scanner"
    else
      echo "  Could not extract osv-scanner binary; please install manually: https://github.com/google/osv-scanner"
    fi
    cd - >/dev/null || true
  elif have_cmd choco; then
    echo "  Installing via Chocolatey..."
    choco install osv-scanner -y || true
  else
    echo "  Skipping auto-install. Please install manually: https://github.com/google/osv-scanner"
  fi
fi

echo "\nSetup finished. Verify: semgrep --version | gitleaks version | osv-scanner --version"
