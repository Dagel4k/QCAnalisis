const fs = require('fs');
const path = require('path');

/**
 * Simple Logger class to standardize output
 */
class Logger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
  }

  _write(msg, isError = false) {
    const prefix = isError ? '[ERROR] ' : '';
    const line = `${prefix}${msg}`;
    console[isError ? 'error' : 'log'](msg);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, line.endsWith('\n') ? line : line + '\n');
      } catch (e) {
        // Fallback if we can't write to log file, just console error but don't crash
        console.error(`[LOGGER FAIL] Could not write to log file: ${e.message}`);
      }
    }
  }

  log(msg) {
    this._write(msg, false);
  }

  error(msg) {
    this._write(msg, true);
  }

  setLogFile(path) {
    this.logFilePath = path;
  }
}

/**
 * Sanitize strings for use in filenames/branch slugs
 */
function sanitizeName(s) {
  if (!s) return 'unknown';
  return s.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Simple .env loader (dependency-free)
 */
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
  } catch (e) {
    console.warn(`[WARN] Failed to load env file ${filePath}: ${e.message}`);
  }
}

/**
 * Generate a run ID based on date
 */
function makeRunId(base) {
    const padding = (n) => n.toString().padStart(2, '0');
    const d = new Date();
    const ts = `${d.getFullYear()}${padding(d.getMonth()+1)}${padding(d.getDate())}-${padding(d.getHours())}${padding(d.getMinutes())}${padding(d.getSeconds())}`;
    return `${sanitizeName(base)}-${ts}`;
}

module.exports = {
  Logger,
  sanitizeName,
  loadEnvFromFile,
  makeRunId
};
