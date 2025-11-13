# Guía de Deployment

## Opción 1: Docker (Recomendado)

### Build de la imagen

```bash
docker build -t gitlab-analyzer:latest .
```

### Ejecutar con Docker

```bash
docker run -d \
  --name gitlab-analyzer \
  -p 8080:8080 \
  -p 3001:3001 \
  -v $(pwd)/storage:/app/storage \
  -v $(pwd)/.work:/app/.work \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/repos.json:/app/repos.json \
  -v $(pwd)/scripts:/app/scripts \
  --restart unless-stopped \
  gitlab-analyzer:latest
```

**Importante**: Los volúmenes son necesarios para:
- `storage/` - Persistir reportes generados
- `.work/` - Directorio temporal de clones
- `.env` - Configuración (tokens, rutas, etc.)
- `repos.json` - Lista de repositorios
- `scripts/` - Scripts del analizador

### Docker Compose (Alternativa)

Crea `docker-compose.yml`:

```yaml
version: '3.8'

services:
  gitlab-analyzer:
    build: .
    ports:
      - "8080:8080"
      - "3001:3001"
    volumes:
      - ./storage:/app/storage
      - ./.work:/app/.work
      - ./.env:/app/.env
      - ./repos.json:/app/repos.json
      - ./scripts:/app/scripts
    restart: unless-stopped
    environment:
      - NODE_ENV=production
```

Ejecutar:
```bash
docker-compose up -d
```

## Opción 2: VPS / Servidor Linux

### 1. Preparar el servidor

```bash
# Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar git
sudo apt-get install -y git

# Instalar PM2 para gestión de procesos
sudo npm install -g pm2
```

### 2. Clonar el proyecto

```bash
cd /opt
git clone <tu-repo> gitlab-analyzer
cd gitlab-analyzer
```

### 3. Configurar

```bash
# Instalar dependencias
npm ci --only=production

# Configurar archivos
cp .env.example .env
cp repos.json.example repos.json

# Editar configuración
nano .env
nano repos.json
```

### 4. Build

```bash
npm run build
npm run build:backend
```

### 5. Iniciar con PM2

```bash
# Crear ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'gitlab-analyzer-frontend',
      script: 'npm',
      args: 'run start:frontend',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'gitlab-analyzer-backend',
      script: 'server/dist/index.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
EOF

# Iniciar
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 6. Configurar Nginx (Reverse Proxy)

```nginx
# /etc/nginx/sites-available/gitlab-analyzer
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activar:
```bash
sudo ln -s /etc/nginx/sites-available/gitlab-analyzer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. SSL con Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Opción 3: Serverless / Cloud

### Vercel (Frontend Only)

El frontend puede desplegarse en Vercel, pero necesitarás hostear el backend en otro lugar (Railway, Render, etc.)

1. Instala Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel --prod`
3. Configura variable de entorno `VITE_API_URL` apuntando a tu backend

### Railway (Full Stack)

1. Conecta tu repo a Railway
2. Configura build command: `npm run build && npm run build:backend`
3. Configura start command: `npm run start`
4. Agrega variables de entorno desde el dashboard
5. Monta volúmenes para `storage/` y `.work/`

## Monitoreo y Mantenimiento

### Logs con PM2

```bash
pm2 logs gitlab-analyzer-backend
pm2 logs gitlab-analyzer-frontend
```

### Backup de reportes

```bash
# Backup periódico de storage/
rsync -avz /opt/gitlab-analyzer/storage/ /backup/gitlab-analyzer/$(date +%Y%m%d)/
```

### Limpiar clones antiguos

```bash
# Agregar a cron (diario)
0 2 * * * find /opt/gitlab-analyzer/.work -type d -mtime +7 -exec rm -rf {} +
```

## Troubleshooting Production

### Backend no inicia
- Verifica que `.env` existe y tiene las rutas correctas
- Verifica permisos: `chmod +x scripts/*.js`
- Revisa logs: `pm2 logs gitlab-analyzer-backend --lines 100`

### Análisis fallan
- Verifica que git está instalado: `git --version`
- Verifica conectividad a GitLab: `curl -I https://gitlab.com`
- Revisa token GitLab: debe tener permisos `read_api`, `read_repository`

### Performance
- Limita análisis concurrentes en `server/routes/analyze.ts`
- Aumenta depth mínimo para clones más rápidos
- Usa ANALYZE_OFFLINE_MODE=true si no necesitas install-dev

## Seguridad en Producción

- [ ] No exponer puerto 3001 directamente (usar nginx/reverse proxy)
- [ ] Configurar CORS restrictivo en servidor
- [ ] Usar HTTPS (SSL)
- [ ] Rotar tokens GitLab periódicamente
- [ ] Limitar acceso a dashboard con autenticación
- [ ] Hacer backups regulares de storage/
- [ ] Monitorear uso de disco (.work puede crecer)

## Variables de Entorno para Producción

Además de las variables básicas, considera:

```env
# Performance
MAX_CONCURRENT_JOBS=3
CLONE_TIMEOUT=300000
ANALYSIS_TIMEOUT=600000

# Monitoring
SENTRY_DSN=https://...
LOG_LEVEL=info

# Storage
STORAGE_MAX_SIZE_GB=50
AUTO_CLEANUP_DAYS=30
```
