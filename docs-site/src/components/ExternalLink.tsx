import type { ReactNode } from 'react'
import { resolveExternalDocsHref } from '../lib/api-docs'

/** Full-page navigation off the SPA (Scalar, OpenAPI JSON, etc.) */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const resolved = resolveExternalDocsHref(href)
  return (
    <a href={resolved} className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
      {children}
    </a>
  )
}
