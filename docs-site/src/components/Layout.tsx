import { type ReactNode, useEffect, useState } from 'react'
import { useLocale } from '../i18n/context'
import { openApiJsonHref, REPO_URL, scalarHref } from '../lib/api-docs'
import { applyTheme, getPreferredTheme, type Theme, toggleTheme } from '../lib/theme'
import { LanguageSelector } from './LanguageSelector'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  // Match FOUC script in index.html to avoid wrong icon / flash
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const next = getPreferredTheme()
    applyTheme(next)
    setTheme(next)
  }, [])

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} query={query} onQuery={setQuery} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur sm:gap-3 dark:border-zinc-800 dark:bg-zinc-950/80">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white lg:hidden dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() => setSidebarOpen(true)}
            aria-label={t.openMenu}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-500 dark:text-zinc-400">{t.topbarSubtitle}</div>
          </div>

          <LanguageSelector />

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 sm:px-3 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            title={t.openGitHub}
          >
            <GitHubIcon />
            <span className="hidden sm:inline">{t.openGitHub}</span>
          </a>

          <a
            href={scalarHref()}
            className="hidden rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 transition hover:bg-brand-100 sm:inline-flex dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200 dark:hover:bg-brand-900"
          >
            Scalar
          </a>
          <ThemeToggle
            theme={theme}
            onToggle={() => {
              setTheme((current) => toggleTheme(current))
            }}
          />
        </header>

        <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>

        <footer className="border-t border-zinc-200 px-6 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
          {t.footerDocs} ·{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 hover:underline dark:text-brand-400"
          >
            {t.footerRepo}
          </a>{' '}
          ·{' '}
          <a href={scalarHref()} className="text-brand-600 hover:underline dark:text-brand-400">
            {t.footerOpenApi}
          </a>{' '}
          ·{' '}
          <a href={openApiJsonHref()} className="text-brand-600 hover:underline dark:text-brand-400">
            {t.footerJson}
          </a>
        </footer>
      </div>
    </div>
  )
}
