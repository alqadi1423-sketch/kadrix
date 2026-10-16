<div dir="rtl">

# تثبيت Veloq

يتكون Veloq من خادم Node.js واحد (الواجهة البرمجية وتطبيق الويب معًا) وقاعدة بيانات PostgreSQL. يمكنك تشغيله عبر Docker أو مباشرة على خادم Linux.

**الحد الأدنى:** معالج واحد، وذاكرة 1 جيجابايت، ومساحة 5 جيجابايت، لفريق يصل إلى نحو 50 شخصًا.

- [عبر Docker (المفضّل)](#عبر-docker)
- [بدون Docker](#بدون-docker)
- [خلف خادم وكيل مع HTTPS](#خلف-خادم-وكيل)
- [الخطوات الأولى](#الخطوات-الأولى)

## عبر Docker

تحتاج Docker مع إضافة Compose.

</div>

```bash
git clone https://github.com/alqadi1423-sketch/veloq.git
cd veloq
cp .env.example .env
```

<div dir="rtl">

عدّل الملف `.env` واضبط هذه القيم على الأقل:

</div>

```bash
AUTH_SECRET=$(openssl rand -base64 48)   # الصق الناتج واحفظه سرًا
POSTGRES_PASSWORD=$(openssl rand -base64 24)
BASE_URL=https://veloq.example.com       # العنوان الذي سيستخدمه الناس
```

<div dir="rtl">

شغّله:

</div>

```bash
docker compose up -d
```

<div dir="rtl">

افتح العنوان `BASE_URL` (أو http://localhost:3000) وأنشئ الحساب الأول. ترحيلات قاعدة البيانات تعمل تلقائيًا في كل مرة يبدأ فيها الخادم.

بياناتك محفوظة في وحدتي تخزين: `veloq-db` (قاعدة البيانات) و`veloq-data` (الملفات المرفوعة). انسخهما احتياطيًا، وانظر [الترقية والنسخ الاحتياطي](upgrade.md).

## بدون Docker

جُرّب على Ubuntu 24.04 وDebian 12. تحتاج:

- Node.js 22 أو أحدث
- pnpm 10 (الأمر `corepack enable` يجلب الإصدار الصحيح)
- PostgreSQL 16 أو أحدث

### 1. قاعدة البيانات

</div>

```bash
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER veloq WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE veloq OWNER veloq;"
```

<div dir="rtl">

ينشئ Veloq الامتداد الذي يحتاجه (`pg_trgm`) في أول ترحيل. إن لم يكن لمستخدم قاعدة البيانات صلاحية إنشاء الامتدادات، نفّذ هذا مرة واحدة بصلاحية المشرف:

</div>

```bash
sudo -u postgres psql -d veloq -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

<div dir="rtl">

### 2. البناء

</div>

```bash
sudo useradd --system --create-home --home-dir /opt/veloq veloq
sudo -u veloq git clone https://github.com/alqadi1423-sketch/veloq.git /opt/veloq/app
cd /opt/veloq/app
sudo -u veloq corepack enable --install-directory /opt/veloq/bin
sudo -u veloq /opt/veloq/bin/pnpm install --frozen-lockfile
sudo -u veloq /opt/veloq/bin/pnpm build
```

<div dir="rtl">

### 3. الإعداد

أنشئ الملف `/opt/veloq/veloq.env` (يقرؤه المستخدم `veloq` فقط):

</div>

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

<div dir="rtl">

كل الإعدادات مشروحة في [الإعدادات](configuration.md).

### 4. التشغيل كخدمة

الملف `/etc/systemd/system/veloq.service`:

</div>

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

<div dir="rtl">

## خلف خادم وكيل

ضع Veloq خلف خادم وكيل يتولى HTTPS، واضبط `TRUST_PROXY=1` حتى يرى Veloq العنوان الحقيقي لكل زائر (يُستخدم في حدود الطلبات). يجب تمرير اتصالات WebSocket، فالتحديثات المباشرة والتحرير المشترك يعتمدان عليها.

Caddy (يجلب الشهادات تلقائيًا):

</div>

```
veloq.example.com {
  reverse_proxy localhost:3000
}
```

<div dir="rtl">

Nginx:

</div>

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

<div dir="rtl">

اضبط `TRUST_PROXY` على العدد الحقيقي للخوادم الوكيلة فقط، فالرقم الأعلى يسمح للزوار بتزوير عناوينهم.

## الخطوات الأولى

1. أنشئ حسابك ثم مساحة عمل. لا يمكن تغيير عنوان المساحة لاحقًا.
2. أضف الأعضاء من **الإعدادات ← الأعضاء** (يحتاج كل منهم حسابًا أولًا).
3. أنشئ مشروعًا، ويأخذ رمزًا مثل `WEB` يظهر في أرقام المهام مثل `WEB-12`.
4. فعّل التحقق بخطوتين لحسابك من **الإعدادات ← تفضيلاتك**.
5. اختياريًا: اربط GitHub أو GitLab من **الإعدادات ← ربط Git**، أو أضف وكيل ذكاء اصطناعي من **الإعدادات ← الوكلاء** ([الدليل](agents.md))، أو استورد المهام من **الإعدادات ← الاستيراد**.

</div>
