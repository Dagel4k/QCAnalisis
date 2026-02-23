import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const setupRouter = Router();

// Helper to find .env file
function getEnvPath() {
    // If we are in dist/server/routes, we need to go up
    // But config.ts uses process.cwd() or similar. 
    // Let's assume project root is CWD for simplicity as per npm run dev
    return path.resolve(process.cwd(), '.env');
}

// Helper to read token from .env file
function readTokenFromEnv(): string | null {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) {
        return null;
    }
    
    try {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            if (trimmed.startsWith('GITLAB_TOKEN=')) {
                const value = trimmed.substring('GITLAB_TOKEN='.length).trim();
                if (value) {
                    const unquoted = value.replace(/^["']|["']$/g, '');
                    return unquoted || null;
                }
            }
            if (trimmed.startsWith('GITLAB_PRIVATE_TOKEN=')) {
                const value = trimmed.substring('GITLAB_PRIVATE_TOKEN='.length).trim();
                if (value) {
                    const unquoted = value.replace(/^["']|["']$/g, '');
                    return unquoted || null;
                }
            }
        }
    } catch {
        // Fallback to process.env if file read fails
    }
    
    return null;
}

// GET /api/setup/status
setupRouter.get('/status', (req, res) => {
    const tokenFromFile = readTokenFromEnv();
    const tokenFromEnv = process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN;
    const token = tokenFromFile || tokenFromEnv;
    const configured = !!(token && token.trim().length > 0);
    res.json({ configured });
});

// POST /api/setup
setupRouter.post('/', (req, res) => {
    try {
        const { token } = req.body;
        if (!token || typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ error: 'Token is required' });
        }

        const envPath = getEnvPath();
        let content = '';

        // Check if .env exists
        if (fs.existsSync(envPath)) {
            content = fs.readFileSync(envPath, 'utf8');
            // Remove existing GITLAB_TOKEN lines to avoid duplicates
            const lines = content.split('\n').filter(line =>
                !line.trim().startsWith('GITLAB_TOKEN=') &&
                !line.trim().startsWith('GITLAB_PRIVATE_TOKEN=')
            );
            content = lines.join('\n');
            if (content && !content.endsWith('\n')) content += '\n';
        } else {
            // If it doesn't exist, maybe copy from .env.example? 
            // For now, just create it.
        }

        // Append new token
        const newContent = content + `GITLAB_TOKEN=${token.trim()}\n`;
        fs.writeFileSync(envPath, newContent, 'utf8');

        // Update in-memory process.env so it works immediately
        process.env.GITLAB_TOKEN = token.trim();

        return res.json({ success: true });
    } catch (error) {
        console.error('Setup error:', error);
        return res.status(500).json({ error: 'Failed to save configuration' });
    }
});
