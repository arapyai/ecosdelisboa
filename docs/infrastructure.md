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

## Who to ping

- Backend / Railway / database access → infra (Joel)
- Adding a new frontend origin to CORS → infra (Joel)
