import { useEffect, useMemo, useRef, useState } from 'react'
import type { Index, SearchRow } from '../types'
import { loadSearch } from '../data'
import { href } from '../router'

interface Hit extends SearchRow {
  score: number
  snippet: { text: string; hit: boolean }[]
}

/** Rank by where the terms land: title beats category beats body. */
function rank(rows: SearchRow[], terms: string[], limit = 60): Hit[] {
  const hits: Hit[] = []

  for (const row of rows) {
    const title = row.t.toLowerCase()
    const category = row.c.toLowerCase()
    const body = row.x.toLowerCase()

    let score = 0
    let matchedAll = true
    for (const term of terms) {
      let termScore = 0
      if (title.startsWith(term)) termScore += 120
      else if (title.includes(term)) termScore += 60
      if (category.includes(term)) termScore += 12
      const bodyAt = body.indexOf(term)
      if (bodyAt >= 0) termScore += Math.max(4, 24 - Math.floor(bodyAt / 200))
      if (termScore === 0) {
        matchedAll = false
        break
      }
      score += termScore
    }
    if (!matchedAll) continue

    hits.push({ ...row, score, snippet: snippetFor(row.x, terms[0]) })
    if (hits.length > 2000) break
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function snippetFor(text: string, term: string) {
  const at = text.toLowerCase().indexOf(term)
  if (at < 0) return [{ text: text.slice(0, 160), hit: false }]
  const start = Math.max(0, at - 60)
  const slice = text.slice(start, at + 120)
  const localAt = at - start
  return [
    { text: (start ? '…' : '') + slice.slice(0, localAt), hit: false },
    { text: slice.slice(localAt, localAt + term.length), hit: true },
    { text: `${slice.slice(localAt + term.length)}…`, hit: false },
  ]
}

export function SearchDialog({ index, onClose }: { index: Index; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchRow[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    loadSearch().then(setRows, () => setRows([]))
  }, [])

  const bookNames = useMemo(
    () => new Map(index.books.map((b) => [b.id, b.name])),
    [index.books],
  )

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = useMemo(() => (rows && terms.length ? rank(rows, terms) : []), [rows, query])

  useEffect(() => setCursor(0), [query])

  const go = (hit: Hit) => {
    window.location.hash = href({ name: 'entry', bookId: hit.b, entryId: hit.e })
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && hits[cursor]) {
      e.preventDefault()
      go(hits[cursor])
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search every guide…"
          className="w-full border-b border-ink-200 bg-transparent px-5 py-4 text-base outline-none dark:border-ink-700"
        />

        <div className="scroll-slim flex-1 overflow-y-auto">
          {!rows && <p className="px-5 py-6 text-sm text-ink-400">Loading search index…</p>}
          {rows && !terms.length && (
            <p className="px-5 py-6 text-sm text-ink-400">
              Search {index.totals.entries} entries across {index.totals.books} guide books.
            </p>
          )}
          {rows && terms.length > 0 && !hits.length && (
            <p className="px-5 py-6 text-sm text-ink-400">No matches for “{query}”.</p>
          )}

          <ul>
            {hits.map((hit, i) => (
              <li key={`${hit.b}/${hit.e}`}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(hit)}
                  className={`w-full border-b border-ink-100 px-5 py-3 text-left transition dark:border-ink-800 ${
                    i === cursor ? 'bg-brand-500/10' : ''
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{hit.t}</span>
                    <span className="shrink-0 text-xs text-ink-400">
                      {bookNames.get(hit.b)}
                      {hit.c && <span className="text-ink-300 dark:text-ink-500"> · {hit.c}</span>}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-500 dark:text-ink-400">
                    {hit.snippet.map((part, j) =>
                      part.hit ? (
                        <mark key={j} className="rounded bg-amber-glow/30 text-inherit">
                          {part.text}
                        </mark>
                      ) : (
                        <span key={j}>{part.text}</span>
                      ),
                    )}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-4 border-t border-ink-200 px-5 py-2 text-[0.7rem] text-ink-400 dark:border-ink-700">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
