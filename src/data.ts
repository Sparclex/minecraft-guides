import type { Book, Index, SearchRow } from './types'

const BASE = import.meta.env.BASE_URL ?? '/'

function url(rel: string) {
  return `${BASE}${BASE.endsWith('/') ? '' : '/'}${rel}`
}

async function getJson<T>(rel: string): Promise<T> {
  const res = await fetch(url(rel))
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
  return (await res.json()) as T
}

let indexPromise: Promise<Index> | null = null
export function loadIndex(): Promise<Index> {
  indexPromise ??= getJson<Index>('data/index.json')
  return indexPromise
}

const bookCache = new Map<string, Promise<Book>>()
export function loadBook(id: string): Promise<Book> {
  let cached = bookCache.get(id)
  if (!cached) {
    cached = getJson<Book>(`data/books/${id}.json`)
    bookCache.set(id, cached)
  }
  return cached
}

let searchPromise: Promise<SearchRow[]> | null = null
export function loadSearch(): Promise<SearchRow[]> {
  searchPromise ??= getJson<SearchRow[]>('data/search.json')
  return searchPromise
}

/** Resolve an image path emitted by the generator against the site base. */
export function imageUrl(src: string): string {
  return /^(https?:|data:)/.test(src) ? src : url(src)
}
