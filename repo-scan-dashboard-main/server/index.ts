import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { reposRouter } from './routes/repos';
import { analyzeRouter } from './routes/analyze';
import { jobsRouter } from './routes/jobs';
import { branchesRouter } from './routes/branches';

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Optional runtime compression without adding hard dependency during dev
let compressionMiddleware: import('express').RequestHandler | undefined;
try {
  // Top-level await is fine in ESM/tsx
  const mod = await import('compression');
  compressionMiddleware = mod.default();
  // eslint-disable-next-line no-console
  console.log('✅ Compression middleware enabled');
} catch {
  // eslint-disable-next-line no-console
  console.log('ℹ️ compression package not installed; skipping gzip/brotli');
}

app.use(cors());
if (compressionMiddleware) app.use(compressionMiddleware);
app.use(express.json());

// API routes
app.use('/api/repos', reposRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/branches', branchesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static client when dist exists (robusto si el cwd cambia)
(() => {
  const distDir = path.resolve(rootDir, 'dist');
  if (!fs.existsSync(distDir)) return; // no build present
  const clientIndex = path.join(distDir, 'index.html');

  app.use(
    express.static(distDir, {
      index: false,
      etag: true,
      lastModified: true,
      cacheControl: true,
      setHeaders: (res, resourcePath) => {
        if (/\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|webp|svg)($|\?)/i.test(resourcePath)) {
          res.setHeader('Cache-Control', isProd ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
        } else {
          res.setHeader('Cache-Control', isProd ? 'public, max-age=300' : 'no-store');
        }
      },
    })
  );

  // SPA fallback (Express 5): usar app.use sin patrón y no interceptar /api
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(clientIndex);
  });
})();

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
