<div dir="rtl">

# الواجهة البرمجية

كل ما يفعله تطبيق الويب يمر بواجهة JSON تحت `/api`، ووصفها بصيغة OpenAPI في `/api/openapi.json`.

## التوثيق

أنشئ رمزًا من **الإعدادات ← رموز الوصول البرمجي** وأرسله كرمز Bearer:

</div>

```bash
curl -H "Authorization: Bearer vlq_..." https://veloq.example.com/api/workspaces
```

<div dir="rtl">

كل رمز مرتبط بمساحة عمل واحدة وبشخص واحد أو وكيل، ورموز القراءة فقط لا تقبل إلا طلبات GET.

## اللغة

أرسل `x-veloq-locale: ar` أو `en` للنصوص التي يصنعها الخادم، مثل أسماء الحالات الافتراضية لمشروع جديد. الأخطاء رموز ثابتة مثل `{"error":"notFound"}`، وترجمتها في `errors.*` داخل `packages/i18n`.

## أمثلة

</div>

```bash
# البحث في المهام بمرشح JSON
curl -G -H "Authorization: Bearer $T" \
  --data-urlencode 'filter={"search":"تسجيل الدخول","includeClosed":false}' \
  https://veloq.example.com/api/workspaces/acme/issues

# إنشاء مهمة
curl -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"projectId":"…","title":"إصلاح صفحة الدخول","priority":2}' \
  https://veloq.example.com/api/workspaces/acme/issues
```

<div dir="rtl">

## الخطافات البرمجية

يضيف المشرف الخطافات من **الإعدادات ← الخطافات البرمجية**. كل إرسال موقّع بـ HMAC-SHA256 في الترويسة `x-veloq-signature`، ويُعاد عند الفشل بفواصل متزايدة، ويمكن إرساله JSON عاديًا أو منسقًا لـ Slack أو Discord.

## عميل JavaScript

الحزمة `packages/client` عميل صغير بأنواع محددة يعمل في أي بيئة فيها `fetch`:

</div>

```ts
import { createClient } from "@veloq/client";
const veloq = createClient({ baseUrl: "https://veloq.example.com", token: process.env.VELOQ_TOKEN, locale: "ar" });
const found = await veloq.issues("acme", { search: "تسجيل الدخول" });
```
