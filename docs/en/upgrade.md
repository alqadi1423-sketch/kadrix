# Upgrading and backups

## Versions

Kadrix uses semantic versions (`MAJOR.MINOR.PATCH`). Each release lists its
changes in [CHANGELOG.md](../../CHANGELOG.md), with anything you need to do
by hand marked **Upgrade note**. Database migrations run on their own when
the new version starts; they only move forward, so back up first.

## Back up

The database holds everything except uploaded files, which live in `DATA_DIR`.

With Docker:

```bash
docker compose exec -T db pg_dump -U kadrix -Fc kadrix > kadrix-$(date +%F).dump
docker run --rm -v "$(basename "$PWD")_kadrix-data":/data -v "$PWD":/backup alpine \
  tar czf /backup/kadrix-files-$(date +%F).tgz -C /data .
```

Without Docker:

```bash
pg_dump -Fc "$DATABASE_URL" > kadrix-$(date +%F).dump
tar czf kadrix-files-$(date +%F).tgz -C /opt/kadrix/data .
```

Keep a copy of `AUTH_SECRET` with your backups. Without it, saved webhook
and integration secrets cannot be read.

## Restore

```bash
docker compose stop kadrix
docker compose exec -T db pg_restore -U kadrix -d kadrix --clean --if-exists < kadrix-2026-10-16.dump
docker compose start kadrix
```

## Upgrade

With Docker:

```bash
docker compose pull          # or: git pull && docker compose build
docker compose up -d
docker compose logs -f kadrix # migrations are logged on start
```

To stay on one version, set `KADRIX_VERSION=0.1.0` in `.env`.

Without Docker:

```bash
cd /opt/kadrix/app
sudo -u kadrix git fetch --tags && sudo -u kadrix git checkout v0.1.0
sudo -u kadrix /opt/kadrix/bin/pnpm install --frozen-lockfile
sudo -u kadrix /opt/kadrix/bin/pnpm build
sudo systemctl restart kadrix
```

Upgrade one minor version at a time if you are several behind, and read the
upgrade notes of each.
