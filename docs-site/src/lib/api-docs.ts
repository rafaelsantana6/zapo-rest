/**
 * Resolve Scalar / OpenAPI URLs for the two deploy shapes:
 * - API/Docker: guide at `/guide/`, Scalar at site root `/docs`
 * - GitHub Pages: guide + Scalar co-hosted under `DOCS_BASE` (e.g. `/zapo-rest/`)
 */

/** Public source repo — primary entry for stars, issues, Docker tags. */
export const REPO_URL = 'https://github.com/rafaelsantana6/zapo-rest'

function viteBase(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** True when the guide is the whole site (Pages), not `/guide` under the API. */
export function isStandaloneDocsSite(): boolean {
  const base = viteBase()
  return base !== '/guide/'
}

/** Interactive Scalar UI. */
export function scalarHref(): string {
  if (!isStandaloneDocsSite()) return '/docs'
  return `${viteBase()}docs/`
}

/** Machine-readable OpenAPI document. */
export function openApiJsonHref(): string {
  // API: `/docs/json`. Pages: same path under base (workflow copies the file as `json`).
  if (!isStandaloneDocsSite()) return '/docs/json'
  return `${viteBase()}docs/json`
}

/**
 * Rewrite hard-coded API paths used in content (`/docs`, `/docs/json`) so the
 * same TSX works on Docker and GitHub Pages.
 */
export function resolveExternalDocsHref(href: string): string {
  if (href === '/docs' || href === '/docs/') return scalarHref()
  if (href === '/docs/json') return openApiJsonHref()
  return href
}
