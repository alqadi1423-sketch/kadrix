<div dir="rtl">

# الواجهة البرمجية

كل ما يفعله تطبيق الويب يمر بواجهة JSON تحت `/api`، ووصفها بصيغة OpenAPI في `/api/openapi.json`.

## التوثيق

أنشئ رمزًا من **الإعدادات ← رموز الوصول البرمجي** وأرسله كرمز Bearer:

</div>

```bash
curl -H "Authorization: Bearer kdx_..." https://kadrix.example.com/api/workspaces
```

<div dir="rtl">

كل رمز مرتبط بمساحة عمل واحدة وبشخص واحد أو وكيل، ورموز القراءة فقط لا تقبل إلا طلبات GET.

## اللغة

أرسل `x-kadrix-locale: ar` أو `en` للنصوص التي يصنعها الخادم، مثل أسماء الحالات الافتراضية لمشروع جديد. الأخطاء رموز ثابتة مثل `{"error":"notFound"}`، وترجمتها في `errors.*` داخل `packages/i18n`.

## أمثلة

</div>

```bash
# البحث في المهام بمرشح JSON
curl -G -H "Authorization: Bearer $T" \
  --data-urlencode 'filter={"search":"تسجيل الدخول","includeClosed":false}' \
  https://kadrix.example.com/api/workspaces/acme/issues

# إنشاء مهمة
curl -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"projectId":"…","title":"إصلاح صفحة الدخول","priority":2}' \
  https://kadrix.example.com/api/workspaces/acme/issues
```

<div dir="rtl">

## الخطافات البرمجية

يضيف المشرف الخطافات من **الإعدادات ← الخطافات البرمجية**. كل إرسال موقّع بـ HMAC-SHA256 في الترويسة `x-kadrix-signature`، ويُعاد عند الفشل بفواصل متزايدة، ويمكن إرساله JSON عاديًا أو منسقًا لـ Slack أو Discord.

## عميل JavaScript

الحزمة `packages/client` عميل صغير بأنواع محددة يعمل في أي بيئة فيها `fetch`:

</div>

```ts
import { createClient } from "@kadrix/client";
const kadrix = createClient({ baseUrl: "https://kadrix.example.com", token: process.env.KADRIX_TOKEN, locale: "ar" });
const found = await kadrix.issues("acme", { search: "تسجيل الدخول" });
```
