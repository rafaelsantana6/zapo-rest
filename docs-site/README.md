# zapo-rest documentation site

Rich integration guide (SPA):

| Host | URL |
|------|-----|
| **GitHub Pages** (public) | https://rafaelsantana6.github.io/zapo-rest/ |
| API process (Docker) | `http://localhost:3000/guide/` |

- Narrative docs: architecture, auth, messages, webhooks, VoIP, FAQ
- Full HTTP catalog from OpenAPI + routes not yet in the export
- Dark / light mode (Tailwind v4)
- Links to Scalar at **`/docs`** (when served by the API)

## Develop

```bash
# from repo root
pnpm dev:docs
# → http://localhost:5174/guide/
```

Proxies `/v1`, `/docs`, `/health` to the API on `:3000`.

## Build

```bash
# Default base `/guide/` (for embedding in the API)
pnpm build:docs

# GitHub Pages project site (base `/zapo-rest/`)
DOCS_BASE=/zapo-rest/ pnpm --dir docs-site build
```

Output: `docs-site/dist`. The API (`src/app.ts`) mounts the default build at `/guide` when the dist exists.

CI: `.github/workflows/docs-pages.yml` builds with `DOCS_BASE=/zapo-rest/` and deploys to GitHub Pages on pushes to `main` that touch `docs-site/`.

## Content

| Path | Role |
|------|------|
| `src/content/pages/{pt,en,es}.tsx` | Guide articles (i18n, one module per locale) |
| `src/content/endpoints.generated.ts` | Generated from root `openapi.json` |
| `src/content/extras.ts` | Routes missing from OpenAPI export |
| `src/content/nav.ts` | Sidebar structure |

Regenerate endpoint stubs after OpenAPI changes:

```bash
# export openapi then re-run the node generator used in docs setup, or refresh openapi.json
pnpm openapi:export
```
