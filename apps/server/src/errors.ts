import type { ErrorCode } from "@veloq/i18n";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Thrown by route code; turned into `{ error: code }` with the given status.
 * The web app translates `code` through the `errors.*` messages, so the API
 * never sends user-facing text in one language only.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
  ) {
    super(code);
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized");
export const forbidden = () => new ApiError(403, "forbidden");
export const notFound = () => new ApiError(404, "notFound");
export const invalid = () => new ApiError(400, "invalid");
