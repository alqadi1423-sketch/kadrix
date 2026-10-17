# Installing Kadrix

Kadrix is one Node.js server (API and web app together) and a PostgreSQL
database. You can run it with Docker or directly on a Linux server.

**Minimum:** 1 CPU, 1 GB RAM, 5 GB disk, for a team of up to about 50 people.

- [With Docker (recommended)](#with-docker)
- [Without Docker](#without-docker)
- [Behind a reverse proxy (HTTPS)](#behind-a-reverse-proxy)
- [First steps](#first-steps)

## With Docker

You need Docker with the Compose plugin.

```bash
git clone https://github.com/alqadi1423-sketch/kadrix.git
cd kadrix
cp .env.example .env
```

Edit `.env` and set at least these two values:

```bash
AUTH_SECRET=$(openssl rand -base64 48)   # paste the output, keep it secret
POSTGRES_PASSWORD=$(openssl rand -base64 24)
BASE_URL=https://kadrix.example.com       # the address people will use
```

Start it:

```bash
docker compose up -d
```

Open `BASE_URL` (or http://localhost:3000) and create the first account.
Database migrations run automatically every time the server starts.

Your data lives in two Docker volumes: `kadrix-db` (the database) and
`kadrix-data` (uploaded files). Back up both; see [Upgrading and backups](upgrade.md).

## Without Docker

Tested on Ubuntu 24.04 and Debian 12. You need:

- Node.js 22 or newer
- pnpm 10 (`corepack enable` gives you the right version)
- PostgreSQL 16 or newer

### 1. Database

```bash
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER kadrix WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE kadrix OWNER kadrix;"
```

Kadrix creates the extension it needs (`pg_trgm`) in its first migration.
If your database user cannot create extensions, run this once as a superuser:

```bash
sudo -u postgres psql -d kadrix -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### 2. Build

```bash
sudo useradd --system --create-home --home-dir /opt/kadrix kadrix
sudo -u kadrix git clone https://github.com/alqadi1423-sketch/kadrix.git /opt/kadrix/app
cd /opt/kadrix/app
sudo -u kadrix corepack enable --install-directory /opt/kadrix/bin
sudo -u kadrix /opt/kadrix/bin/pnpm install --frozen-lockfile
sudo -u kadrix /opt/kadrix/bin/pnpm build
```

### 3. Configure

Create `/opt/kadrix/kadrix.env` (readable only by the `kadrix` user):

```bash
DATABASE_URL=postgres://kadrix:choose-a-password@localhost:5432/kadrix
AUTH_SECRET=paste-the-output-of-openssl-rand-base64-48
BASE_URL=https://kadrix.example.com
PORT=3000
WEB_DIST=/opt/kadrix/app/apps/web/dist
MIGRATIONS_DIR=/opt/kadrix/app/packages/db/migrations
DATA_DIR=/opt/kadrix/data
NODE_ENV=production
```

```bash
sudo chmod 600 /opt/kadrix/kadrix.env && sudo chown kadrix /opt/kadrix/kadrix.env
sudo -u kadrix mkdir -p /opt/kadrix/data
```

All settings are listed in [Configuration](configuration.md).

### 4. Run as a service

`/etc/systemd/system/kadrix.service`:

```ini
[Unit]
Description=Kadrix
After=network.target postgresql.service

[Service]
User=kadrix
WorkingDirectory=/opt/kadrix/app
EnvironmentFile=/opt/kadrix/kadrix.env
ExecStart=/usr/bin/node apps/server/dist/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/kadrix/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kadrix
curl http://localhost:3000/api/health
```

## Behind a reverse proxy

Put Kadrix behind a proxy that handles HTTPS, and set `TRUST_PROXY=1` so
Kadrix sees each visitor's real address (used for rate limits). WebSockets
must be passed through (live updates and shared editing use them).

Caddy (gets certificates automatically):

```
kadrix.example.com {
  reverse_proxy localhost:3000
}
```

Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name kadrix.example.com;
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
