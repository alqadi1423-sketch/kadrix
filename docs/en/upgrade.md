# Upgrading and backups

## Versions

Veloq uses semantic versions (`MAJOR.MINOR.PATCH`). Each release lists its
changes in [CHANGELOG.md](../../CHANGELOG.md), with anything you need to do
by hand marked **Upgrade note**. Database migrations run on their own when
the new version starts; they only move forward, so back up first.

## Back up

The database holds everything except uploaded files, which live in `DATA_DIR`.

With Docker:

```bash
docker compose exec -T db pg_dump -U veloq -Fc veloq > veloq-$(date +%F).dump
docker run --rm -v veloq_veloq-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/veloq-files-$(date +%F).tgz -C /data .
```

Without Docker:

```bash
pg_dump -Fc "$DATABASE_URL" > veloq-$(date +%F).dump
tar czf veloq-files-$(date +%F).tgz -C /opt/veloq/data .
```

Keep a copy of `AUTH_SECRET` with your backups. Without it, saved webhook
and integration secrets cannot be read.

## Restore

```bash
docker compose stop veloq
docker compose exec -T db pg_restore -U veloq -d veloq --clean --if-exists < veloq-2026-10-16.dump
docker compose start veloq
```

## Upgrade

With Docker:

```bash
docker compose pull          # or: git pull && docker compose build
docker compose up -d
docker compose logs -f veloq # migrations are logged on start
```

To stay on one version, set `VELOQ_VERSION=0.1.0` in `.env`.

Without Docker:

```bash
cd /opt/veloq/app
sudo -u veloq git fetch --tags && sudo -u veloq git checkout v0.1.0
sudo -u veloq /opt/veloq/bin/pnpm install --frozen-lockfile
sudo -u veloq /opt/veloq/bin/pnpm build
sudo systemctl restart veloq
```

Upgrade one minor version at a time if you are several behind, and read the
upgrade notes of each.
