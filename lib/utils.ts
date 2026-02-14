import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple Logger class to standardize output
 */
export class Logger {
  private logFilePath: string | null;

  constructor(logFilePath: string | null = null) {
    this.logFilePath = logFilePath;
  }

  private _write(msg: string, isError: boolean = false): void {
    const prefix = isError ? '[ERROR] ' : '';
    const line = `${prefix}${msg}`;
    console[isError ? 'error' : 'log'](msg);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, line.endsWith('\n') ? line : line + '\n');
      } catch (e: any) {
        // Fallback if we can't write to log file, just console error but don't crash
        console.error(`[LOGGER FAIL] Could not write to log file: ${e.message}`);
      }
    }
  }

  log(msg: string): void {
    this._write(msg, false);
  }

  warn(msg: string): void {
    this._write(`[WARN] ${msg}`, false);
  }

  error(msg: string): void {
    this._write(msg, true);
  }

  setLogFile(path: string): void {
    this.logFilePath = path;
  }
}


/**
 * Sanitize strings for use in filenames/branch slugs
 */
export function sanitizeName(s: string): string {
  if (!s) return 'unknown';
  return s.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Simple .env loader (dependency-free)
 */
export function loadEnvFromFile(filePath: string): void {
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
  } catch (e: any) {
    console.warn(`[WARN] Failed to load env file ${filePath}: ${e.message}`);
  }
}

/**
 * Generate a run ID based on date
 */
export function makeRunId(base: string): string {
  const padding = (n: number) => n.toString().padStart(2, '0');
  const d = new Date();
  const ts = `${d.getFullYear()}${padding(d.getMonth() + 1)}${padding(d.getDate())}-${padding(d.getHours())}${padding(d.getMinutes())}${padding(d.getSeconds())}`;
  return `${sanitizeName(base)}-${ts}`;
}
