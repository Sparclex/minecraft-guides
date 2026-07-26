import { useEffect, useState } from 'react'
import type { Book, Index } from './types'
import { loadBook, loadIndex } from './data'
import { href, useRoute } from './router'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/Search'
import { BookView, EntryView, HomeView, ModsView } from './components/views'

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark] as const
}

export default function App() {
  const route = useRoute()
  const [index, setIndex] = useState<Index | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [dark, setDark] = useTheme()

  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e.message ?? e)))
  }, [])

  const wantedBookId = route.name === 'book' || route.name === 'entry' ? route.bookId : null
  useEffect(() => {
    if (!wantedBookId) {
      setBook(null)
      return
    }
    let stale = false
    loadBook(wantedBookId).then(
      (loaded) => {
        if (!stale) setBook(loaded)
      },
      () => {
        if (!stale) setBook(null)
      },
    )
    return () => {
      stale = true
    }
  }, [wantedBookId])

  // Cmd/Ctrl-K anywhere opens search, matching the muscle memory of docs sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setNavOpen(false)
    setSearchOpen(false)
    window.scrollTo({ top: 0 })
  }, [route.name, (route as { bookId?: string }).bookId, (route as { entryId?: string }).entryId])

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">Guide data not found</h1>
        <p className="mt-3 text-ink-500 dark:text-ink-400">{error}</p>
        <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">
          Run <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">npm run generate</code> to
          build it from the modpack.
        </p>
      </div>
    )
  }

  if (!index) {
    return <div className="px-6 py-24 text-center text-ink-400">Loading…</div>
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-ink-50/85 backdrop-blur dark:border-ink-700 dark:bg-ink-950/85">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle navigation"
            className="rounded-lg px-2 py-1.5 text-lg leading-none hover:bg-ink-100 lg:hidden dark:hover:bg-ink-800"
          >
            ☰
          </button>

          <a href={href({ name: 'home' })} className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-semibold tracking-tight">ATM10 Lite Guides</span>
            <span className="hidden shrink-0 text-xs text-ink-400 sm:inline">{index.pack.version}</span>
          </a>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-500 transition hover:border-brand-500/50 dark:border-ink-700 dark:text-ink-400"
          >
            <span>Search</span>
            <kbd className="hidden rounded border border-ink-200 px-1 font-mono text-[0.65rem] sm:inline dark:border-ink-700">
              ⌘K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setDark(!dark)}
            aria-label="Toggle colour theme"
            className="rounded-lg px-2 py-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[100rem]">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-ink-200 bg-ink-50 pt-16 transition-transform lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 lg:pt-0 dark:border-ink-700 dark:bg-ink-950 ${
            navOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar index={index} book={book} route={route} onClose={() => setNavOpen(false)} />
        </aside>

        {navOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}

        <main className="min-w-0 flex-1">
          <Content index={index} route={route} book={book} />
        </main>
      </div>

      {searchOpen && <SearchDialog index={index} onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

function Content({
  index,
  route,
  book,
}: {
  index: Index
  route: ReturnType<typeof useRoute>
  book: Book | null
}) {
  if (route.name === 'home') return <HomeView index={index} />
  if (route.name === 'mods') return <ModsView index={index} />

  if (!book || book.id !== route.bookId) {
    return <div className="px-6 py-24 text-center text-ink-400">Loading book…</div>
  }
  if (route.name === 'book') return <BookView book={book} />

  const entry = book.entries.find((e) => e.id === route.entryId)
  if (!entry) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">Entry not found</h1>
        <p className="mt-3 text-ink-500 dark:text-ink-400">
          <code className="font-mono text-sm">{route.entryId}</code> is not in {book.name}.
        </p>
        <a href={href({ name: 'book', bookId: book.id })} className="mt-4 inline-block text-brand-600 underline">
          Back to {book.name}
        </a>
      </div>
    )
  }
  return <EntryView book={book} entry={entry} />
}
