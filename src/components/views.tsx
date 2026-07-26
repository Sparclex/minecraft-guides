import { useMemo, useState } from 'react'
import type { Book, Entry, Index } from '../types'
import { href, navigate, routeFromHref } from '../router'
import { RichBlocks, RichInline } from './Rich'
import { EngineBadge } from './Sidebar'

const onNavigate = (raw: string) => {
  const route = routeFromHref(raw)
  if (route) navigate(route)
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white/60 px-4 py-3 dark:border-ink-700 dark:bg-ink-900/60">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wider text-ink-500 dark:text-ink-400">{label}</div>
    </div>
  )
}

export function HomeView({ index }: { index: Index }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-300">
        {[index.pack.name, index.pack.version, index.pack.minecraft && `Minecraft ${index.pack.minecraft}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">In-game guides, on the web</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-ink-300">
        Every guide book that ships inside this modpack — the quest book, the Patchouli manuals, Occultism&rsquo;s
        Dictionary of Spirits and the AE2-style web guides — extracted straight from the mod jars and laid out for
        reading without launching the game.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={index.totals.books} label="guide books" />
        <Stat value={index.totals.entries} label="entries" />
        <Stat value={index.totals.pages} label="pages" />
        <Stat value={`${index.totals.modsWithGuides}/${index.totals.mods}`} label="mods with guides" />
      </div>

      <h2 className="mt-12 mb-4 text-lg font-semibold">Books</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {index.books.map((book) => (
          <li key={book.id}>
            <a
              href={href({ name: 'book', bookId: book.id })}
              className="flex h-full flex-col rounded-xl border border-ink-200 bg-white/60 p-4 transition hover:border-brand-500/50 hover:shadow-sm dark:border-ink-700 dark:bg-ink-900/60"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{book.name}</h3>
                <EngineBadge engine={book.engine} label={book.engineLabel} />
              </div>
              {book.subtitle && (
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{book.subtitle}</p>
              )}
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                {book.summary}
              </p>
              <p className="mt-auto pt-3 text-xs text-ink-400">
                {book.entryCount} entries · {book.pageCount} pages
                {book.contributors.length > 1 && ` · ${book.contributors.length} mods`}
              </p>
            </a>
          </li>
        ))}
      </ul>

      <footer className="mt-14 border-t border-ink-200 pt-5 text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
        <p>
          Generated {new Date(index.generatedAt).toLocaleString()} from the published modpack manifest and the
          mods&rsquo; own jars. Run <code className="font-mono">npm run generate</code> to rebuild against the latest
          release.
        </p>
        <p className="mt-1.5">
          Guide text belongs to the individual mod authors; this site only reformats what the mods already ship.
        </p>
      </footer>
    </div>
  )
}

export function ModsView({ index }: { index: Index }) {
  const [query, setQuery] = useState('')
  const [onlyGuides, setOnlyGuides] = useState(false)

  const bookByMod = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>()
    for (const book of index.books) {
      for (const contributor of book.contributors) {
        if (!map.has(contributor.id)) map.set(contributor.id, [])
        map.get(contributor.id)!.push({ id: book.id, name: book.name })
      }
    }
    return map
  }, [index.books])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return index.mods.filter((mod) => {
      if (onlyGuides && !bookByMod.has(mod.id)) return false
      if (!needle) return true
      return `${mod.name} ${mod.id} ${mod.authors ?? ''}`.toLowerCase().includes(needle)
    })
  }, [index.mods, query, onlyGuides, bookByMod])

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Mods in {index.pack.name}</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-300">
        All {index.totals.mods} mods shipped with {index.pack.version}. {index.totals.modsWithGuides} of them include
        an in-game guide.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter mods…"
          className="min-w-56 flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-700 dark:bg-ink-900"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input
            type="checkbox"
            checked={onlyGuides}
            onChange={(e) => setOnlyGuides(e.target.checked)}
            className="accent-brand-500"
          />
          Only mods with guides
        </label>
      </div>

      <ul className="mt-6 divide-y divide-ink-200 rounded-xl border border-ink-200 dark:divide-ink-700 dark:border-ink-700">
        {rows.map((mod) => {
          const books = bookByMod.get(mod.id) ?? []
          return (
            <li key={mod.file} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <span className="font-medium">{mod.name}</span>
              <span className="font-mono text-xs text-ink-400">{mod.version ?? '—'}</span>
              {books.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {books.map((book) => (
                    <a
                      key={book.id}
                      href={href({ name: 'book', bookId: book.id })}
                      className="rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-px text-xs text-brand-600 dark:text-brand-300"
                    >
                      {book.name}
                    </a>
                  ))}
                </span>
              ) : (
                <span className="text-xs text-ink-400">no in-game guide</span>
              )}
            </li>
          )
        })}
        {!rows.length && <li className="px-4 py-6 text-center text-sm text-ink-400">No mods match that filter.</li>}
      </ul>
    </div>
  )
}

export function BookView({ book }: { book: Book }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <EngineBadge engine={book.engine} label={book.engineLabel} />
        <span className="text-xs text-ink-400">
          {book.modNames.join(', ')}
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{book.name}</h1>
      {book.subtitle && <p className="mt-2 text-lg text-ink-500 dark:text-ink-400">{book.subtitle}</p>}

      {book.landing.length > 0 && (
        <div className="mt-6 font-book text-[1.05rem] leading-relaxed">
          <RichBlocks blocks={book.landing} onNavigate={onNavigate} />
        </div>
      )}

      {book.contributors.length > 1 && (
        <p className="mt-6 text-sm text-ink-500 dark:text-ink-400">
          Pages contributed by {book.contributors.map((c) => `${c.name} (${c.entries})`).join(', ')}.
        </p>
      )}

      <h2 className="mt-10 mb-4 text-lg font-semibold">Contents</h2>
      <div className="space-y-6">
        {book.categories.map((category) => {
          const entries = book.entries.filter((e) => e.category === category.id)
          if (!entries.length) return null
          return (
            <section key={category.id}>
              <h3 className="mb-2 font-semibold">{category.name}</h3>
              {category.description.length > 0 && (
                <div className="mb-2 text-sm text-ink-500 dark:text-ink-400">
                  <RichBlocks blocks={category.description} onNavigate={onNavigate} />
                </div>
              )}
              <ul className="grid gap-1 sm:grid-cols-2">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={href({ name: 'entry', bookId: book.id, entryId: entry.id })}
                      className="block truncate rounded px-2 py-1 text-sm transition hover:bg-ink-100 dark:hover:bg-ink-800"
                    >
                      {entry.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function EntryView({ book, entry }: { book: Book; entry: Entry }) {
  const category = book.categories.find((c) => c.id === entry.category)
  const siblings = book.entries.filter((e) => e.category === entry.category)
  const position = siblings.findIndex((e) => e.id === entry.id)
  const previous = position > 0 ? siblings[position - 1] : null
  const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null

  return (
    <article className="mx-auto max-w-3xl px-6 py-10">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
        <a href={href({ name: 'book', bookId: book.id })} className="hover:text-brand-600 dark:hover:text-brand-300">
          {book.name}
        </a>
        {category && (
          <>
            <span>/</span>
            <span>{category.name}</span>
          </>
        )}
      </nav>

      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{entry.name}</h1>
      {entry.summary && <p className="mt-2 text-ink-500 dark:text-ink-400">{entry.summary}</p>}
      {entry.questCount != null && (
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">{entry.questCount} quests in this chapter</p>
      )}

      <div className="mt-8 space-y-8 font-book text-[1.05rem]">
        {entry.pages.map((page, i) => (
          <section key={i} className="scroll-mt-24">
            {page.title && (
              <h2 className="mb-2 font-sans text-lg font-semibold tracking-tight">
                <RichInline nodes={page.title} onNavigate={onNavigate} />
                {page.optional && (
                  <span className="ml-2 rounded border border-ink-300 px-1.5 py-px align-middle text-[0.65rem] font-normal uppercase tracking-wide text-ink-400">
                    optional
                  </span>
                )}
              </h2>
            )}
            <RichBlocks blocks={page.blocks} onNavigate={onNavigate} />
          </section>
        ))}
      </div>

      {entry.children && entry.children.length > 0 && (
        <section className="mt-10 border-t border-ink-200 pt-5 dark:border-ink-700">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Sub-pages
          </h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            {entry.children.map((child) => (
              <li key={child.id}>
                <a
                  href={href({ name: 'entry', bookId: book.id, entryId: child.id })}
                  className="block truncate rounded px-2 py-1 text-sm transition hover:bg-ink-100 dark:hover:bg-ink-800"
                >
                  {child.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="mt-10 flex items-stretch justify-between gap-3 border-t border-ink-200 pt-5 text-sm dark:border-ink-700">
        {previous ? (
          <a
            href={href({ name: 'entry', bookId: book.id, entryId: previous.id })}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 transition hover:border-brand-500/50 dark:border-ink-700"
          >
            <div className="text-xs text-ink-400">Previous</div>
            <div className="truncate">{previous.name}</div>
          </a>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <a
            href={href({ name: 'entry', bookId: book.id, entryId: next.id })}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-right transition hover:border-brand-500/50 dark:border-ink-700"
          >
            <div className="text-xs text-ink-400">Next</div>
            <div className="truncate">{next.name}</div>
          </a>
        ) : (
          <span className="flex-1" />
        )}
      </nav>
    </article>
  )
}
