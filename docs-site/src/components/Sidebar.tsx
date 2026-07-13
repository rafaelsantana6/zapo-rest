import { NavLink } from 'react-router-dom'
import { getNav } from '../content/nav'
import { useLocale } from '../i18n/context'
import { REPO_URL, resolveExternalDocsHref, scalarHref } from '../lib/api-docs'
import { cn } from '../lib/cn'

export function Sidebar({
  open,
  onClose,
  query,
  onQuery,
}: {
  open: boolean
  onClose: () => void
  query: string
  onQuery: (q: string) => void
}) {
  const { locale, t } = useLocale()
  const nav = getNav(locale)
  const q = query.trim().toLowerCase()

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label={t.closeMenu}
          onClick={onClose}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="border-b border-zinc-100 px-4 py-4 dark:border-zinc-800">
          <a href={import.meta.env.BASE_URL} className="block">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
              zapo-rest
            </div>
            <div className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t.brandDocs}</div>
          </a>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t.searchNav}
            className="mt-3 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none ring-brand-500/30 placeholder:text-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => {
            const items = group.items.filter(
              (item) =>
                !q ||
                item.title.toLowerCase().includes(q) ||
                item.href.toLowerCase().includes(q) ||
                group.title.toLowerCase().includes(q),
            )
            if (!items.length) return null
            return (
              <div key={group.title} className="mb-5">
                <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {group.title}
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const external = item.external === true
                    if (external) {
                      return (
                        <li key={item.id}>
                          <a
                            href={resolveExternalDocsHref(item.href)}
                            className="block rounded-lg px-2 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                            onClick={onClose}
                          >
                            {item.title}
                            <span className="ml-1 text-[10px] text-zinc-400">↗</span>
                          </a>
                        </li>
                      )
                    }
                    const to = item.href.replace(/^\/guide\/?/, '/') || '/'
                    return (
                      <li key={item.id}>
                        <NavLink
                          to={to}
                          end={to === '/'}
                          onClick={onClose}
                          className={({ isActive }) =>
                            cn(
                              'block rounded-lg px-2 py-1.5 text-sm transition',
                              isActive
                                ? 'bg-brand-50 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200'
                                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white',
                            )
                          }
                        >
                          {item.title}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        <div className="flex flex-col gap-1.5 border-t border-zinc-100 p-3 text-xs text-zinc-500 dark:border-zinc-800">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t.openGitHub} ↗
          </a>
          <a href={scalarHref()} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t.openScalar} ↗
          </a>
        </div>
      </aside>
    </>
  )
}
