import { useEffect, useMemo, useState } from 'react'
import type { Book, BookSummary, Index } from '../types'
import { href, type Route } from '../router'

const ENGINE_TONE: Record<string, string> = {
  ftbquests: 'bg-amber-glow/15 text-amber-glow border-amber-glow/30',
  patchouli: 'bg-brand-500/12 text-brand-600 border-brand-500/25 dark:text-brand-300',
  modonomicon: 'bg-purple-500/12 text-purple-600 border-purple-500/25 dark:text-purple-300',
  guideme: 'bg-sky-500/12 text-sky-600 border-sky-500/25 dark:text-sky-300',
}

export function EngineBadge({ engine, label }: { engine: string; label: string }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-px text-[0.65rem] font-medium tracking-wide ${
        ENGINE_TONE[engine] ?? 'border-ink-300 text-ink-500'
      }`}
    >
      {label}
    </span>
  )
}

export function Sidebar({
  index,
  book,
  route,
  onClose,
}: {
  index: Index
  book: Book | null
  route: Route
  onClose?: () => void
}) {
  const activeBookId = route.name === 'book' || route.name === 'entry' ? route.bookId : null
  const activeEntryId = route.name === 'entry' ? route.entryId : null

  const grouped = useMemo(() => {
    const byEngine = new Map<string, BookSummary[]>()
    for (const summary of index.books) {
      if (!byEngine.has(summary.engine)) byEngine.set(summary.engine, [])
      byEngine.get(summary.engine)!.push(summary)
    }
    return [...byEngine.entries()].map(([engine, books]) => ({
      engine,
      label: books[0].engineLabel,
      books: books.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  }, [index.books])

  return (
    <nav className="scroll-slim h-full overflow-y-auto px-3 py-4 text-sm">
      <a
        href={href({ name: 'home' })}
        onClick={onClose}
        className={`block rounded-lg px-3 py-2 font-medium transition ${
          route.name === 'home'
            ? 'bg-brand-500/12 text-brand-600 dark:text-brand-300'
            : 'hover:bg-ink-100 dark:hover:bg-ink-800'
        }`}
      >
        Overview
      </a>
      <a
        href={href({ name: 'mods' })}
        onClick={onClose}
        className={`block rounded-lg px-3 py-2 font-medium transition ${
          route.name === 'mods'
            ? 'bg-brand-500/12 text-brand-600 dark:text-brand-300'
            : 'hover:bg-ink-100 dark:hover:bg-ink-800'
        }`}
      >
        All {index.totals.mods} mods
      </a>

      {grouped.map((group) => (
        <section key={group.engine} className="mt-5">
          <h2 className="px-3 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-widest text-ink-400">
            {group.label}
          </h2>
          <ul>
            {group.books.map((summary) => (
              <li key={summary.id}>
                <a
                  href={href({ name: 'book', bookId: summary.id })}
                  onClick={onClose}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 transition ${
                    activeBookId === summary.id
                      ? 'bg-brand-500/12 font-medium text-brand-600 dark:text-brand-300'
                      : 'hover:bg-ink-100 dark:hover:bg-ink-800'
                  }`}
                >
                  <span className="truncate">{summary.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">{summary.entryCount}</span>
                </a>

                {activeBookId === summary.id && book?.id === summary.id && (
                  <BookTree book={book} activeEntryId={activeEntryId} onClose={onClose} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

function BookTree({
  book,
  activeEntryId,
  onClose,
}: {
  book: Book
  activeEntryId: string | null
  onClose?: () => void
}) {
  const activeCategory = book.entries.find((e) => e.id === activeEntryId)?.category ?? null
  const [open, setOpen] = useState<Set<string>>(new Set(activeCategory ? [activeCategory] : []))

  // Following a cross-book link should reveal the destination's section.
  useEffect(() => {
    if (activeCategory) setOpen((prev) => (prev.has(activeCategory) ? prev : new Set(prev).add(activeCategory)))
  }, [activeCategory])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <ul className="mt-1 mb-2 ml-3 border-l border-ink-200 pl-2 dark:border-ink-700">
      {book.categories.map((category) => {
        const entries = book.entries.filter((e) => e.category === category.id)
        if (!entries.length) return null
        const isOpen = open.has(category.id)
        return (
          <li key={category.id}>
            <button
              type="button"
              onClick={() => toggle(category.id)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[0.82rem] text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              <span className={`text-ink-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              <span className="flex-1 truncate">{category.name}</span>
              <span className="text-xs tabular-nums text-ink-400">{entries.length}</span>
            </button>
            {isOpen && (
              <ul className="mb-1 ml-3.5 border-l border-ink-200 pl-2 dark:border-ink-700">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={href({ name: 'entry', bookId: book.id, entryId: entry.id })}
                      onClick={onClose}
                      className={`block truncate rounded px-2 py-1 text-[0.82rem] transition ${
                        activeEntryId === entry.id
                          ? 'bg-brand-500/12 font-medium text-brand-600 dark:text-brand-300'
                          : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                      }`}
                      style={{ paddingLeft: `${0.5 + (entry.depth ?? 0) * 0.6}rem` }}
                      title={entry.name}
                    >
                      {entry.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
