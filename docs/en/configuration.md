# Configuration

Kadrix reads its settings from environment variables. With Docker, put them in
`.env`; otherwise in the service's environment file.

## Required

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection, e.g. `postgres://kadrix:password@localhost:5432/kadrix` |
| `AUTH_SECRET` | At least 32 random characters. Signs sessions and encrypts webhook and integration secrets. Changing it signs everyone out and makes stored secrets unreadable. |
| `BASE_URL` | The public address, e.g. `https://kadrix.example.com`. Used for links in emails, webhook URLs and request origin checks. |

## Server

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for uploaded files |
| `WEB_DIST` | none | Folder of the built web app; the server serves it when set |
| `MIGRATIONS_DIR` | built in | Folder of database migrations |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of Kadrix. Set `1` behind one Nginx, Caddy or Cloudflare hop |
| `TRUSTED_ORIGINS` | none | Extra addresses, comma separated, allowed to send requests besides `BASE_URL`. Needed behind proxies that rewrite the Origin header, such as GitHub Codespaces |

## Security and limits

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | `600` | API requests per minute per person (or per address when signed out). `0` turns it off |
| `AUTH_ATTEMPTS_PER_5_MIN` | `20` | Sign-in, sign-up and password reset attempts per address. `0` turns off auth rate limiting |
| `PASSWORD_BREACH_CHECK` | off | `1` refuses new passwords found in known data breaches. Asks the Have I Been Pwned service with k-anonymity: only the first 5 characters of a hash leave the server |
| `WEBHOOK_ALLOW_PRIVATE` | off | `1` lets webhooks reach private network addresses (for internal tools) |

Passwords must be 15 to 128 characters, in any language, and common or
easily guessed ones are refused (following NIST SP 800-63B-4). Long
phrases are easiest: several unrelated words.

## Email

| Variable | Meaning |
|---|---|
| `SMTP_URL` | e.g. `smtps://user:password@smtp.example.com:465`. When set, people get a daily digest of unread notifications in their language (they can turn it off) |
| `MAIL_FROM` | Sender, e.g. `Kadrix <kadrix@example.com>` |

## AI (off by default)

Nothing is sent to any AI service unless you set a provider. When on, issue
pages get a **Summarize** button and new issues a **Write it up for me** button.

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `openai-compatible` (OpenAI, a local model through Ollama or vLLM, and others) or `anthropic` |
| `AI_BASE_URL` | Required for `openai-compatible`, e.g. `http://localhost:11434/v1` for Ollama |
| `AI_API_KEY` | Key for the provider, if it needs one |
| `AI_MODEL` | Model name |

## Edition

`KADRIX_EDITION` is `self-hosted` (the default). `cloud` is reserved for a
future managed service.
