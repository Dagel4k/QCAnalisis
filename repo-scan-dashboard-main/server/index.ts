import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { reposRouter } from './routes/repos.js';
import { analyzeRouter } from './routes/analyze.js';
import { jobsRouter } from './routes/jobs.js';
import { branchesRouter } from './routes/branches.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Trust proxy so req.secure reflects X-Forwarded-Proto in reverse proxies (support multi-hop)
app.set('trust proxy', true);

// Remove X-Powered-By header
app.disable('x-powered-by');

// Optional runtime compression without adding hard dependency during dev
let compressionMiddleware: import('express').RequestHandler | undefined;
try {
  // Top-level await is fine in ESM/tsx
  const mod = await import('compression');
  compressionMiddleware = mod.default();
  console.log('✅ Compression middleware enabled');
} catch {
  console.log('ℹ️ compression package not installed; skipping gzip/brotli');
}

// Ensure caches vary on Origin when CORS is dynamic
app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  next();
});

// CORS: restrict to explicit allow-list (set CORS_ALLOWED_ORIGINS="https://foo,https://bar")
const defaultDevOrigins = ['http://localhost:5173', 'http://localhost:3000'];
// Always include localhost dev origins when running locally, even in production mode
const baseAllowed = (process.env.CORS_ALLOWED_ORIGINS || (isProd ? '' : defaultDevOrigins.join(',')))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = new Set<string>(baseAllowed);
if ((process.env.HOST || '').includes('localhost') || (process.env.NODE_ENV !== 'production')) {
  defaultDevOrigins.forEach((o) => allowedOrigins.add(o));
}

// Per-request CORS options (needs access to req to allow same-origin)
const corsOptionsDelegate = (req: express.Request, callback: (err: Error | null, options?: cors.CorsOptions) => void) => {
  const origin = req.header('Origin') || '';
  const forwardedProto = (req.headers['x-forwarded-proto'] as string) || '';
  const reqProto = forwardedProto.split(',')[0]?.trim() || req.protocol;
  const selfOrigin = `${reqProto}://${req.headers.host}`;

  const wildcard = (process.env.CORS_ALLOWED_ORIGINS || '').trim() === '*';
  const isSameOrigin = origin === selfOrigin;
  const isLocalDev = origin.startsWith('http://localhost:');
  const isAllowed = !origin || origin === 'null' || isSameOrigin || wildcard || allowedOrigins.has(origin) || (!isProd && isLocalDev);
  if (!isAllowed) {
    return callback(new Error('Not allowed by CORS'), { origin: false });
  }
  return callback(null, {
    origin: !!origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type'],
  });
};

// Apply CORS to API routes only
app.use('/api', cors(corsOptionsDelegate));

// Handle CORS origin errors cleanly for API
app.use('/api', (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof Error && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS not allowed' });
  }
  return next(err);
});

// Security headers
app.use((req, res, next) => {
  // Reasonable defaults; relax in dev to not break Vite HMR
  const csp = isProd
    ? [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'self' https: wss:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    : [
        "default-src 'self' data: blob:",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'self' http: https: ws: wss:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS only for HTTPS requests in production
  const proto = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
  if (isProd && proto.includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
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
