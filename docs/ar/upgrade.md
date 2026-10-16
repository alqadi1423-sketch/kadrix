<div dir="rtl">

# الترقية والنسخ الاحتياطي

## الإصدارات

يستخدم Veloq ترقيم الإصدارات الدلالي (`MAJOR.MINOR.PATCH`). كل إصدار يسرد تغييراته في [CHANGELOG.md](../../CHANGELOG.md)، وما يحتاج تدخلًا يدويًا يُعلَّم بعبارة **Upgrade note**. ترحيلات قاعدة البيانات تعمل تلقائيًا عند تشغيل الإصدار الجديد وتسير للأمام فقط، فانسخ احتياطيًا قبلها.

## النسخ الاحتياطي

قاعدة البيانات تحفظ كل شيء ما عدا الملفات المرفوعة، وهي في `DATA_DIR`.

مع Docker:

</div>

```bash
docker compose exec -T db pg_dump -U veloq -Fc veloq > veloq-$(date +%F).dump
docker run --rm -v veloq_veloq-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/veloq-files-$(date +%F).tgz -C /data .
```

<div dir="rtl">

بدون Docker:

</div>

```bash
pg_dump -Fc "$DATABASE_URL" > veloq-$(date +%F).dump
tar czf veloq-files-$(date +%F).tgz -C /opt/veloq/data .
```

<div dir="rtl">

احفظ نسخة من `AUTH_SECRET` مع النسخ الاحتياطية، فبدونه لا يمكن قراءة أسرار الخطافات والتكاملات المحفوظة.

## الاستعادة

</div>

```bash
docker compose stop veloq
docker compose exec -T db pg_restore -U veloq -d veloq --clean --if-exists < veloq-2026-10-16.dump
docker compose start veloq
```

<div dir="rtl">

## الترقية

مع Docker:

</div>

```bash
docker compose pull          # أو: git pull && docker compose build
docker compose up -d
docker compose logs -f veloq # الترحيلات تظهر في السجل عند البدء
```

<div dir="rtl">

للبقاء على إصدار محدد اضبط `VELOQ_VERSION=0.1.0` في `.env`.

بدون Docker:

</div>

```bash
cd /opt/veloq/app
sudo -u veloq git fetch --tags && sudo -u veloq git checkout v0.1.0
sudo -u veloq /opt/veloq/bin/pnpm install --frozen-lockfile
sudo -u veloq /opt/veloq/bin/pnpm build
sudo systemctl restart veloq
```

<div dir="rtl">

إن كنت متأخرًا عدة إصدارات فرقِّ إصدارًا فرعيًا واحدًا في كل مرة، واقرأ ملاحظات الترقية لكل منها.

</div>
