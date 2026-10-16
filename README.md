# Veloq

Open-source project management for tech teams. Arabic and English as equals, built to run on your own server.

> Status: early development. Not ready for production use yet.

[العربية](#بالعربية)

## Why Veloq

- **Two languages, one product.** Full right-to-left Arabic and English, with neither one treated as a translation of the other.
- **Yours to host.** One app container plus PostgreSQL. No search cluster, no message queue, no 16 GB server.
- **Built for software work.** Issues, cycles, roadmaps and Git integration are the core, not add-ons.
- **Open to agents.** A clean API so AI coding agents can read and work on issues.

## Run it

```bash
git clone https://github.com/<owner>/veloq.git
cd veloq
cp .env.example .env        # set AUTH_SECRET to a long random value
docker compose up -d
```

Open http://localhost:3000 and create an account.

## Develop

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
export DATABASE_URL=postgres://veloq:veloq@localhost:5432/veloq
export AUTH_SECRET=$(openssl rand -base64 48)
pnpm --filter @veloq/server dev     # API on :3000, runs migrations
pnpm --filter @veloq/web dev        # web on :5173
```

Checks (the same ones CI runs):

```bash
export TEST_DATABASE_URL=postgres://veloq:veloq@localhost:5432/veloq_test
pnpm check
```

## Layout

| Path | What it is |
|---|---|
| `apps/server` | HTTP API (Hono), authentication (Better Auth) |
| `apps/web` | Web app (React, Vite, Tailwind) |
| `packages/core` | Permissions, validation, edition flag |
| `packages/db` | Database schema and migrations (Drizzle, PostgreSQL) |
| `packages/i18n` | Arabic and English messages |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require agreeing to the [CLA](CLA.md).

## License

[GNU AGPL v3 or later](LICENSE). If you run a modified Veloq for others over a network, you must offer them its source code.

---

## بالعربية

Veloq
أداة مفتوحة المصدر لإدارة المشاريع التقنية. العربية والإنجليزية فيها بمستوى واحد، وتعمل على خادمك الخاص.

> الحالة: تطوير مبكر، غير جاهزة للاستخدام الفعلي بعد.

### لماذا

- **لغتان في منتج واحد:** عربية كاملة من اليمين لليسار، وإنجليزية، دون أن تكون إحداهما ترجمة للأخرى.
- **تستضيفها بنفسك:** حاوية للتطبيق وقاعدة بيانات واحدة فقط.
- **مصممة للعمل البرمجي:** المهام والدورات وخرائط الطريق والربط مع
Git
في صلبها.
- **مفتوحة للوكلاء الذكيين:** واجهة برمجية واضحة يعمل عليها وكلاء البرمجة.

### التشغيل

انسخ الملف
`.env.example`
إلى
`.env`
وضع قيمة طويلة عشوائية في
`AUTH_SECRET`
ثم شغّل:

```bash
docker compose up -d
```

وافتح
http://localhost:3000

### الرخصة

GNU AGPL v3

إذا شغّلت نسخة معدّلة لآخرين عبر الشبكة، يلزمك إتاحة الكود المصدري لهم.
