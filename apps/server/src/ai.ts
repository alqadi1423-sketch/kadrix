import type { AiProvider, AiProviderId, AiRequest } from "@veloq/core";

export interface AiConfig {
  provider: AiProviderId | null;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

/** Null unless an administrator switched a provider on. */
export function createAiProvider(cfg: AiConfig, doFetch: typeof fetch = fetch): AiProvider | null {
  if (!cfg.provider || !cfg.model) return null;
  const timeout = () => AbortSignal.timeout(60_000);

  if (cfg.provider === "anthropic") {
    if (!cfg.apiKey) return null;
    const base = (cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    return {
      id: "anthropic",
      model: cfg.model,
      async complete(req: AiRequest) {
        const res = await doFetch(`${base}/v1/messages`, {
          method: "POST",
          signal: timeout(),
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: cfg.model, max_tokens: req.maxTokens ?? 800, system: req.system, messages: req.messages }),
        });
        if (!res.ok) throw new Error(`ai ${res.status}`);
        const data = (await res.json()) as { content?: { type: string; text?: string }[] };
        return (data.content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
      },
    };
  }

  if (!cfg.baseUrl) return null;
  const base = cfg.baseUrl.replace(/\/$/, "");
  return {
    id: "openai-compatible",
    model: cfg.model,
    async complete(req: AiRequest) {
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        signal: timeout(),
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: req.maxTokens ?? 800,
          messages: [{ role: "system", content: req.system }, ...req.messages],
        }),
      });
      if (!res.ok) throw new Error(`ai ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}
