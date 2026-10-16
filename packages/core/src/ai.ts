/**
 * AI provider interface. Kadrix ships with no provider switched on; a
 * self-hosted install can point it at any OpenAI-compatible server (for
 * example a local model) or Anthropic's API. Features that use it are
 * hidden while it is off.
 */
export const AI_PROVIDERS = ["openai-compatible", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiProvider {
  id: AiProviderId | "test";
  model: string;
  complete(req: AiRequest): Promise<string>;
}

/** Wraps untrusted text so instructions inside it are treated as data. */
export function fenced(label: string, text: string): string {
  const safe = text.replaceAll("</" + label + ">", "");
  return `<${label}>\n${safe}\n</${label}>`;
}

/** Splits a model's "title on the first line, body after" answer. */
export function splitDraft(text: string): { title: string; description: string } {
  const lines = text.trim().split("\n");
  const title = (lines.shift() ?? "")
    .replace(/^#+\s*/, "")
    .replace(/^(title|العنوان)\s*[:：]\s*/i, "")
    .trim()
    .slice(0, 250);
  return { title, description: lines.join("\n").trim() };
}
