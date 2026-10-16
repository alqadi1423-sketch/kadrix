# Installing Veloq

Veloq is one Node.js server (API and web app together) and a PostgreSQL
database. You can run it with Docker or directly on a Linux server.

**Minimum:** 1 CPU, 1 GB RAM, 5 GB disk, for a team of up to about 50 people.

- [With Docker (recommended)](#with-docker)
- [Without Docker](#without-docker)
- [Behind a reverse proxy (HTTPS)](#behind-a-reverse-proxy)
- [First steps](#first-steps)

## With Docker

You need Docker with the Compose plugin.

```bash
git clone https://github.com/alqadi1423-sketch/veloq.git
cd veloq
cp .env.example .env
```

Edit `.env` and set at least these two values:

```bash
AUTH_SECRET=$(openssl rand -base64 48)   # paste the output, keep it secret
POSTGRES_PASSWORD=$(openssl rand -base64 24)
BASE_URL=https://veloq.example.com       # the address people will use
```

Start it:

```bash
docker compose up -d
```

Open `BASE_URL` (or http://localhost:3000) and create the first account.
Database migrations run automatically every time the server starts.

Your data lives in two Docker volumes: `veloq-db` (the database) and
`veloq-data` (uploaded files). Back up both; see [Upgrading and backups](upgrade.md).

## Without Docker

Tested on Ubuntu 24.04 and Debian 12. You need:

- Node.js 22 or newer
- pnpm 10 (`corepack enable` gives you the right version)
- PostgreSQL 16 or newer

### 1. Database

```bash
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER veloq WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE veloq OWNER veloq;"
```

Veloq creates the extension it needs (`pg_trgm`) in its first migration.
If your database user cannot create extensions, run this once as a superuser:

```bash
sudo -u postgres psql -d veloq -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### 2. Build

```bash
sudo useradd --system --create-home --home-dir /opt/veloq veloq
sudo -u veloq git clone https://github.com/alqadi1423-sketch/veloq.git /opt/veloq/app
cd /opt/veloq/app
sudo -u veloq corepack enable --install-directory /opt/veloq/bin
sudo -u veloq /opt/veloq/bin/pnpm install --frozen-lockfile
sudo -u veloq /opt/veloq/bin/pnpm build
```

### 3. Configure

Create `/opt/veloq/veloq.env` (readable only by the `veloq` user):

```bash
DATABASE_URL=postgres://veloq:choose-a-password@localhost:5432/veloq
AUTH_SECRET=paste-the-output-of-openssl-rand-base64-48
BASE_URL=https://veloq.example.com
PORT=3000
WEB_DIST=/opt/veloq/app/apps/web/dist
MIGRATIONS_DIR=/opt/veloq/app/packages/db/migrations
DATA_DIR=/opt/veloq/data
NODE_ENV=production
```

```bash
sudo chmod 600 /opt/veloq/veloq.env && sudo chown veloq /opt/veloq/veloq.env
sudo -u veloq mkdir -p /opt/veloq/data
```

All settings are listed in [Configuration](configuration.md).

### 4. Run as a service

`/etc/systemd/system/veloq.service`:

```ini
[Unit]
Description=Veloq
After=network.target postgresql.service

[Service]
User=veloq
WorkingDirectory=/opt/veloq/app
EnvironmentFile=/opt/veloq/veloq.env
ExecStart=/usr/bin/node apps/server/dist/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/veloq/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now veloq
curl http://localhost:3000/api/health
```

## Behind a reverse proxy

Put Veloq behind a proxy that handles HTTPS, and set `TRUST_PROXY=1` so
Veloq sees each visitor's real address (used for rate limits). WebSockets
must be passed through (live updates and shared editing use them).

Caddy (gets certificates automatically):

```
veloq.example.com {
  reverse_proxy localhost:3000
}
```

Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name veloq.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;
  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Only set `TRUST_PROXY` to the real number of proxies. A higher number lets
visitors fake their address.

## First steps

1. Create your account, then a workspace. Its address cannot be changed later.
2. Invite people in **Settings → Members** (they need an account first).
3. Create a project; it gets a key such as `WEB`, used in issue numbers like `WEB-12`.
4. Turn on two-step sign-in for your own account in **Settings → Your preferences**.
5. Optional: connect GitHub or GitLab in **Settings → Git integrations**, add an AI agent in
   **Settings → Agents** ([guide](agents.md)), or import issues in **Settings → Import**.
