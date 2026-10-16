/**
 * Turns a webhook payload into a short chat message for Slack or Discord,
 * in the webhook's chosen language. Unknown events fall back to the name.
 */
type Payload = { event: string; data: Record<string, any> };

const T = {
  en: {
    "issue.created": (i: any) => `New issue ${i.key}: ${i.title}`,
    "issue.updated": (i: any) => `${i.key} updated: ${i.title} (${i.stateName})`,
    "issue.deleted": (i: any) => `${i.key} was deleted: ${i.title}`,
    "comment.created": (i: any) => `New comment on ${i.key}: ${i.title}`,
    "release.published": (r: any) => `Release ${r.version} published`,
    "cycle.completed": () => "A cycle was completed",
    ping: () => "Kadrix webhook test",
  },
  ar: {
    "issue.created": (i: any) => `مهمة جديدة ${i.key}: ${i.title}`,
    "issue.updated": (i: any) => `تحديث ${i.key}: ${i.title} (${i.stateName})`,
    "issue.deleted": (i: any) => `حُذفت المهمة ${i.key}: ${i.title}`,
    "comment.created": (i: any) => `تعليق جديد على ${i.key}: ${i.title}`,
    "release.published": (r: any) => `نُشر الإصدار ${r.version}`,
    "cycle.completed": () => "اكتملت دورة عمل",
    ping: () => "تجربة خطاف Kadrix",
  },
} as const;

export function chatText(p: Payload, locale: string, baseUrl: string, slug: string | null): string {
  const lang = locale === "ar" ? T.ar : T.en;
  const fn = (lang as Record<string, (x: any) => string>)[p.event];
  const subject = p.data?.issue ?? p.data?.release ?? {};
  const line = fn ? fn(subject) : p.event;
  const link = p.data?.issue?.key && slug ? `${baseUrl}/w/${slug}/i/${p.data.issue.key}` : null;
  return link ? `${line}\n${link}` : line;
}

export function chatBody(format: string, text: string): Record<string, unknown> {
  return format === "discord" ? { content: text.slice(0, 1900) } : { text };
}
