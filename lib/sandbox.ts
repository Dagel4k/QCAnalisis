import * as fs from 'fs';
import * as path from 'path';
import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { Logger } from './utils';

export class VirtualEnvironment {
    private targetDir: string;
    private sourceNodeModules: string;
    private logger: Logger;

    constructor(targetDir: string, sourceNodeModules: string, logger: Logger) {
        this.targetDir = targetDir;
        this.sourceNodeModules = sourceNodeModules;
        this.logger = logger;
    }

    /**
     * Creates a virtual node_modules environment using symlinks
     */
    public setup(): void {
        this.logger.log(`[Sandbox] Setting up virtual environment in ${this.targetDir}`);
        
        const targetModules = path.join(this.targetDir, 'node_modules');
        
        if (!fs.existsSync(this.targetDir)) {
            fs.mkdirSync(this.targetDir, { recursive: true });
        }

        if (!fs.existsSync(targetModules)) {
            fs.mkdirSync(targetModules, { recursive: true });
        }

        // If source node_modules doesn't exist, we can't link
        if (!fs.existsSync(this.sourceNodeModules)) {
            this.logger.error(`[Sandbox] Source node_modules not found at ${this.sourceNodeModules}`);
            return;
        }

        try {
            const entries = fs.readdirSync(this.sourceNodeModules);
            for (const entry of entries) {
                if (entry.startsWith('.')) continue;
                const srcPath = path.join(this.sourceNodeModules, entry);
                const destPath = path.join(targetModules, entry);
                
                if (!fs.existsSync(destPath)) {
                    fs.symlinkSync(srcPath, destPath, 'junction');
                }
            }
            
            const srcBin = path.join(this.sourceNodeModules, '.bin');
            const destBin = path.join(targetModules, '.bin');
            if (fs.existsSync(srcBin) && !fs.existsSync(destBin)) {
                 fs.symlinkSync(srcBin, destBin, 'junction');
            }

        } catch (e: any) {
            this.logger.error(`[Sandbox] Failed to setup virtual env: ${e.message}`);
            throw e;
        }
    }
}

export class SandboxManager {
    private workDir: string;
    private logger: Logger;

    constructor(workDir: string, logger: Logger) {
        this.workDir = workDir;
        this.logger = logger;
    }

    public async initialize(): Promise<void> {
        if (!fs.existsSync(this.workDir)) {
            fs.mkdirSync(this.workDir, { recursive: true });
        }
    }

    public async cleanup(): Promise<void> {
        if (fs.existsSync(this.workDir)) {
            try {
                fs.rmSync(this.workDir, { recursive: true, force: true });
            } catch (e: any) {
                this.logger.error(`[Sandbox] Cleanup failed: ${e.message}`);
            }
        }
    }

    /**
     * Spawns a process within the sandbox
     */
    public runProcess(
        command: string, 
        args: string[], 
        env: NodeJS.ProcessEnv = {}, 
        options: { cwd?: string, pipeLogs?: boolean } = {}
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const cwd = options.cwd || this.workDir;
            const child = spawn(command, args, {
                cwd,
                env: { ...process.env, ...env },
                stdio: options.pipeLogs ? ['ignore', 'pipe', 'pipe'] : 'ignore'
            });

            if (options.pipeLogs && child.stdout && child.stderr) {
                child.stdout.on('data', (d) => this.logger.log(d.toString().trim()));
                child.stderr.on('data', (d) => this.logger.log(`[STDERR] ${d.toString().trim()}`));
            }

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Process ${command} exited with code ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }
}
