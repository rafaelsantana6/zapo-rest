# zapo-rest documentation site

Rich integration guide (SPA) + static Scalar OpenAPI:

| Host | Guide | Scalar |
|------|-------|--------|
| **GitHub Pages** (public) | https://rafaelsantana6.github.io/zapo-rest/ | https://rafaelsantana6.github.io/zapo-rest/docs/ |
| API process (Docker) | `http://localhost:3000/guide/` | `http://localhost:3000/docs` |

- Narrative docs: architecture, auth, messages, webhooks, VoIP, FAQ
- Full HTTP catalog from OpenAPI + routes not yet in the export
- Dark / light mode (Tailwind v4)
- Header **Scalar** link resolves to the co-hosted UI on Pages, or `/docs` on the API
- Static Scalar page: `scalar/index.html` (CDN) + root `openapi.json` staged into `dist/docs/` in CI

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
# then stage Scalar + OpenAPI:
mkdir -p docs-site/dist/docs
cp docs-site/scalar/index.html docs-site/dist/docs/index.html
cp openapi.json docs-site/dist/docs/openapi.json
cp openapi.json docs-site/dist/docs/json
```

Output: `docs-site/dist`. The API (`src/app.ts`) mounts the default build at `/guide` when the dist exists.

CI: `.github/workflows/docs-pages.yml` builds with `DOCS_BASE=/zapo-rest/`, copies `openapi.json` into `dist/docs/`, and deploys to GitHub Pages on pushes to `main` that touch `docs-site/` or `openapi.json`.

## Content

| Path | Role |
|------|------|
| `src/content/pages/{pt,en,es}.tsx` | Guide articles (i18n, one module per locale) |
| `src/content/endpoints.generated.ts` | Generated from root `openapi.json` |
| `src/content/extras.ts` | Routes missing from OpenAPI export |
| `src/content/nav.ts` | Sidebar structure |

Engineering “why” (CAS, outbox, SSE/WS, LID) for visitors: architecture + media pages; canonical repo doc: [`docs/DESIGN-DECISIONS.md`](../docs/DESIGN-DECISIONS.md).

Regenerate endpoint stubs after OpenAPI changes:

```bash
# export openapi then re-run the node generator used in docs setup, or refresh openapi.json
pnpm openapi:export
```
