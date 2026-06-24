# Infrastructure

Backend hosting, environments, and how the frontend connects to the API.

## Environments

The backend runs on [Railway](https://railway.app) under the `ecos-de-lisboa` project. Two environments:

| Environment | Git branch | Purpose |
|-------------|------------|---------|
| `master`      | `master` / `main` | Production |
| `development` | `develop`         | Active development, auto-deploys on push |

Each environment has its own backend service and its own Postgres database. They are fully isolated — data in `development` never touches `master`.

## API URLs

### Development

- **Base URL:** `https://ecosdelisboa-development.up.railway.app`
- **Swagger docs:** https://ecosdelisboa-development.up.railway.app/docs
- **OpenAPI schema:** https://ecosdelisboa-development.up.railway.app/openapi.json

### Production (`master`)

- **Base URL:** _to be generated when ready to ship_

To get a public URL for a new environment: Railway → service → **Settings → Networking → Generate Domain**.

## Frontend setup

Put the API URL in your local `.env`:

```env
VITE_API_BASE_URL=https://ecosdelisboa-development.up.railway.app
```


### CORS

The backend's `CORS_ORIGINS` environment variable controls which frontend origins can call the API. Currently allowlisted in `development`:

- `http://localhost:5173` (Vite default)

If you run the frontend on a different port (3000, 19006, …) or deploy it to a hosted URL (Vercel, Netlify, …), ask infra to add that origin to `CORS_ORIGINS`. Format is a JSON array:

```
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000","https://your-frontend.vercel.app"]
```

CORS only cares about the URL in your browser's address bar — your physical network/location is irrelevant.

### Sanity check

From your machine:

```bash
curl https://ecosdelisboa-development.up.railway.app/docs
```

A 200 with HTML body means the API is reachable. A CORS error in the browser console means your origin isn't allowlisted yet.

## Backend service configuration

For reference (managed in Railway, not in code):

- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Source:** GitHub repo `ecosdelisboa`, branch per environment
- **Auto-deploy:** enabled on the tracked branch
- **`DATABASE_URL`:** injected by Railway from the linked Postgres service
- **`CORS_ORIGINS`:** set manually per environment

## Logs and retention policy

### Where logs live

Railway captures everything the backend writes to `stdout` / `stderr`. View them at: Railway → backend service → **Deployments → [most recent deploy]**, or the **Observability** tab.

### Retention

- Hobby / Trial plan: **7 days** (current)
- Pro plan: 30 days
- After retention expires, logs are permanently deleted

### What must NOT appear in logs

- Passwords, tokens, API keys, JWTs
- Full request bodies (may contain PII)
- Full email addresses in error messages (hash or use domain only)
- Payment / card data

### What may (and should) appear

- Errors and stack traces
- Request IDs for correlation
- Basic metrics (latency, status code)
- Startup messages

### When 7 days is not enough

Configure a log drain at Railway → **Settings → Observability → Log Drains**, pointing to one of:

- [Better Stack](https://betterstack.com) — 3 GB/month free
- [Axiom](https://axiom.co) — 500 MB/month free

Not required while traffic and incident volume stay low.

### Responsibilities

- Backend dev: ensure no PII / secrets are written to logs
- Infra: monitor usage, decide when to enable an external log drain

## Secrets policy

Where secrets live:

- Railway env vars (production runtime)
- Password manager (Bitwarden or equivalent) — single source of truth

Distinct values for `development` and `master` whenever feasible.

### Generation

Use `openssl rand -base64 48` (or the PowerShell equivalent below) to generate strong values.

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

### Rotation

- Scheduled: every 90 days for all secrets
- Immediate if: leak suspected, exposure in logs, plan or account change

### Current inventory

- `ADMIN_SECRET_KEY` — Railway dev/master (distinct) + password manager
- `ADMIN_INITIAL_PASSWORD` — Railway dev/master (distinct) + password manager
- `SENTRY_DSN` — Railway dev/master (same) + password manager
- `GEMINI_API_KEY` — Railway dev/master (same) + password manager

## Gemini quotas (free tier)

Model: `gemini-2.0-flash`.

| Limit | Value |
|---|---|
| Requests per minute (RPM) | 15 |
| Tokens per minute (TPM) | 1,000,000 |
| Requests per day (RPD) | 1,500 |
| Daily reset | Midnight Pacific (08:00 Lisbon, 04:00 São Paulo) |
| Scope | Per GCP project (not per API key) |

## Who to ping

- Backend / Railway / database access → infra (Joel)
- Adding a new frontend origin to CORS → infra (Joel)
