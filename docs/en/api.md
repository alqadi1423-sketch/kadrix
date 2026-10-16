# API

Everything the web app does goes through a JSON API under `/api`. The
OpenAPI description is at `/api/openapi.json`.

## Authentication

Create a token in **Settings → API tokens** and send it as a bearer token:

```bash
curl -H "Authorization: Bearer kdx_..." https://kadrix.example.com/api/workspaces
```

Tokens belong to one workspace and one person (or agent). Read-only tokens
can only make GET requests.

## Language

Send `x-kadrix-locale: ar` or `en` for server-made text such as the default
workflow state names of a new project. Errors are stable codes, for example
`{"error":"notFound"}`; translate them with `errors.*` in `packages/i18n`.

## Examples

```bash
# Issues assigned to anyone, matching text, as JSON filter
curl -G -H "Authorization: Bearer $T" \
  --data-urlencode 'filter={"search":"login","includeClosed":false}' \
  https://kadrix.example.com/api/workspaces/acme/issues

# Create an issue
curl -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"projectId":"…","title":"Fix the login page","priority":2}' \
  https://kadrix.example.com/api/workspaces/acme/issues
```

## Webhooks

Admins add webhooks in **Settings → Webhooks**. Deliveries are signed with
HMAC-SHA256 in the `x-kadrix-signature` header, retried with backoff, and
can be sent as plain JSON or formatted for Slack or Discord.

## JavaScript client

`packages/client` is a small typed client that works anywhere `fetch` does:

```ts
import { createClient } from "@kadrix/client";
const kadrix = createClient({ baseUrl: "https://kadrix.example.com", token: process.env.KADRIX_TOKEN });
const mine = await kadrix.issues("acme", { search: "login" });
```
