import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from './utils';

export interface SandboxLease {
    id: string;      // Task/Run ID
    path: string;    // Absolute path to workspace
    pid: number;     // Process ID matching this lease
    createdAt: string;
}

// Replaced Manifest with direct file system lookups in leases/ directory
// export interface SandboxManifest {
//     leases: { [id: string]: SandboxLease };
// }

export class VirtualEnvironment {
    private targetDir: string;
    private sourceNodeModules: string;
    private logger: Logger;

    constructor(targetDir: string, sourceNodeModules: string, logger: Logger) {
        this.targetDir = targetDir;
        this.sourceNodeModules = sourceNodeModules;
        this.logger = logger;
    }

    public setup(): void {
        this.logger.log(`[Sandbox] Setting up virtual environment in ${this.targetDir}`);

        const targetModules = path.join(this.targetDir, 'node_modules');

        if (!fs.existsSync(this.targetDir)) {
            fs.mkdirSync(this.targetDir, { recursive: true });
        }

        if (!fs.existsSync(targetModules)) {
            fs.mkdirSync(targetModules, { recursive: true });
        }

        if (!fs.existsSync(this.sourceNodeModules)) {
            this.logger.error(`[Sandbox] Source node_modules not found at ${this.sourceNodeModules}`);
            return;
        }

        try {
            const entries = fs.readdirSync(this.sourceNodeModules);
            // Link .bin first
            const srcBin = path.join(this.sourceNodeModules, '.bin');
            const destBin = path.join(targetModules, '.bin');
            if (fs.existsSync(srcBin) && !fs.existsSync(destBin)) {
                fs.symlinkSync(srcBin, destBin, 'junction');
            }

            // Link other top-level modules
            for (const entry of entries) {
                if (entry.startsWith('.') || entry === 'node_modules') continue;
                const srcPath = path.join(this.sourceNodeModules, entry);
                const destPath = path.join(targetModules, entry);

                if (!fs.existsSync(destPath)) {
                    fs.symlinkSync(srcPath, destPath, 'junction');
                }
            }

        } catch (e: any) {
            this.logger.error(`[Sandbox] Failed to setup virtual env: ${e.message}`);
            // Non-fatal for now, but important
        }
    }
}

export class SandboxManager {
    private rootDir: string;
    private leasesDir: string;
    private logger: Logger;

    constructor(rootDir: string, logger: Logger) {
        this.rootDir = path.resolve(rootDir);
        this.leasesDir = path.join(this.rootDir, 'leases');
        this.logger = logger;
    }

    /**
     * Initialize the manager: ensure dirs and reclaim abandoned workspaces.
     */
    public async init(): Promise<void> {
        if (!fs.existsSync(this.rootDir)) {
            fs.mkdirSync(this.rootDir, { recursive: true });
        }
        if (!fs.existsSync(this.leasesDir)) {
            fs.mkdirSync(this.leasesDir, { recursive: true });
        }

        await this.reclaimAbandoned();
    }

    /**
     * Check for abandoned leases (PID checks via lock files) and remove them.
     */
    private async reclaimAbandoned(): Promise<void> {
        try {
            const lockFiles = fs.readdirSync(this.leasesDir).filter(f => f.endsWith('.lock'));
            let reclaimedCount = 0;

            for (const file of lockFiles) {
                const lockPath = path.join(this.leasesDir, file);
                try {
                    const content = fs.readFileSync(lockPath, 'utf-8');
                    const lease: SandboxLease = JSON.parse(content);

                    // Check if process is still running
                    if (!this.isProcessRunning(lease.pid)) {
                        this.logger.log(`[Sandbox] Reclaiming abandoned workspace for ${lease.id} (PID ${lease.pid} dead)`);

                        // 1. Delete Workspace
                        await this.forceCleanup(lease.path);

                        // 2. Delete Lock File
                        fs.unlinkSync(lockPath);
                        reclaimedCount++;
                    }
                } catch (e: any) {
                    this.logger.warn(`[Sandbox] Failed to process lock file ${file}: ${e.message}. Deleting corrupt lock.`);
                    try { fs.unlinkSync(lockPath); } catch { }
                }
            }

            // Clean up untracked directories in rootDir (orphaned workspaces without locks)
            // Be careful only to delete directories that look like workspaces "ws-..."
            const dirs = fs.readdirSync(this.rootDir);
            for (const dir of dirs) {
                if (dir === 'leases' || dir === 'sandbox-manifest.json') continue; // Skip special dirs/files (legacy manifest)

                const fullPath = path.join(this.rootDir, dir);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory() && dir.startsWith('ws-')) {
                    // Check if there is a corresponding active lock
                    // We need to check all locks to see if any point to this path
                    const activeLocks = fs.readdirSync(this.leasesDir).filter(f => f.endsWith('.lock'));
                    let isLocked = false;

                    for (const lockFile of activeLocks) {
                        try {
                            const lease: SandboxLease = JSON.parse(fs.readFileSync(path.join(this.leasesDir, lockFile), 'utf-8'));
                            if (lease.path === fullPath) {
                                isLocked = true;
                                break;
                            }
                        } catch { }
                    }

                    if (!isLocked) {
                        this.logger.log(`[Sandbox] Found untracked workspace directory ${dir}, cleaning up.`);
                        await this.forceCleanup(fullPath);
                    }
                }
            }

            if (fs.existsSync(path.join(this.rootDir, 'sandbox-manifest.json'))) {
                // Remove legacy manifest if exists
                try { fs.unlinkSync(path.join(this.rootDir, 'sandbox-manifest.json')); } catch { }
            }

        } catch (e: any) {
            this.logger.error(`[Sandbox] Reclaim failed: ${e.message}`);
        }
    }

    private isProcessRunning(pid: number): boolean {
        try {
            // Signal 0 checks if process exists and we have permission
            return process.kill(pid, 0);
        } catch (e: any) {
            return e.code === 'EPERM'; // If EPERM, it exists but we can't kill it.
        }
    }

    /**
     * Obtain a lease for a new workspace.
     * Uses atomic file creation to prevent race conditions.
     */
    public async obtainLease(id: string): Promise<SandboxLease> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeId = id.replace(/[^a-zA-Z0-9-]/g, '_');
        const dirName = `ws-${safeId}-${timestamp}`;
        const absPath = path.join(this.rootDir, dirName);
        const lockFile = path.join(this.leasesDir, `${safeId}.lock`);

        // 1. Try to acquire lock
        if (fs.existsSync(lockFile)) {
            // Logic to handle existing lock? 
            // If init() ran, it should have cleared dead locks. 
            // If lock exists now, it means another active process (or this one) owns it.
            // We can check if PID is alive.
            try {
                const existing = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
                if (this.isProcessRunning(existing.pid)) {
                    throw new Error(`Lease for ${id} is currently held by PID ${existing.pid}`);
                }
                // If not running, we could theoretically steal it, but init() should have handled it.
                // However, race condition might happen if process died AFTER init().
                // Let's safe steal it if dead.
                this.logger.warn(`[Sandbox] Taking over dead lease for ${id} (PID ${existing.pid})`);
                fs.unlinkSync(lockFile);
                await this.forceCleanup(existing.path);
            } catch (e: any) {
                // Could not read or parse, assume corrupt or race, try to remove
                try { fs.unlinkSync(lockFile); } catch { }
            }
        }

        // 2. Prepare workspace
        if (fs.existsSync(absPath)) {
            await this.forceCleanup(absPath);
        }

        fs.mkdirSync(absPath, { recursive: true });

        const lease: SandboxLease = {
            id,
            path: absPath,
            pid: process.pid,
            createdAt: new Date().toISOString()
        };

        // 3. Write Lock File Atomically
        // Using 'wx' flag fails if file exists
        try {
            fs.writeFileSync(lockFile, JSON.stringify(lease, null, 2), { flag: 'wx' });
        } catch (e: any) {
            if (e.code === 'EEXIST') {
                throw new Error(`Failed to obtain lease for ${id}: Locked by another process.`);
            }
            throw e;
        }

        return lease;
    }

    /**
     * Release lease and cleanup workspace.
     */
    public async releaseLease(lease: SandboxLease): Promise<void> {
        const lockFile = path.join(this.leasesDir, `${lease.id.replace(/[^a-zA-Z0-9-]/g, '_')}.lock`);

        await this.forceCleanup(lease.path);

        if (fs.existsSync(lockFile)) {
            try {
                // Verify we own it before deleting?
                const content = fs.readFileSync(lockFile, 'utf-8');
                const held = JSON.parse(content);
                if (held.pid === process.pid) {
                    fs.unlinkSync(lockFile);
                }
            } catch (e) {
                // Ignore error if already gone
            }
        }
    }

    private async forceCleanup(dirPath: string): Promise<void> {
        if (fs.existsSync(dirPath)) {
            try {
                fs.rmSync(dirPath, { recursive: true, force: true });
            } catch (e: any) {
                this.logger.error(`[Sandbox] Failed to delete ${dirPath}: ${e.message}`);
            }
        }
    }
}
