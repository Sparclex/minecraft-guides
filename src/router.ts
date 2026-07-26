import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'mods' }
  | { name: 'book'; bookId: string }
  | { name: 'entry'; bookId: string; entryId: string; anchor?: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (!path) return { name: 'home' }

  const [main, anchor] = path.split('#')
  const parts = main.split('/').filter(Boolean).map(decodeURIComponent)

  if (parts[0] === 'mods') return { name: 'mods' }
  if (parts[0] === 'book' && parts[1]) {
    if (parts.length > 2) {
      return { name: 'entry', bookId: parts[1], entryId: parts.slice(2).join('/'), anchor }
    }
    return { name: 'book', bookId: parts[1] }
  }
  return { name: 'home' }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'mods':
      return '#/mods'
    case 'book':
      return `#/book/${encodeURIComponent(route.bookId)}`
    case 'entry':
      // Entry ids contain slashes; keep them readable rather than escaping.
      return `#/book/${encodeURIComponent(route.bookId)}/${route.entryId
        .split('/')
        .map(encodeURIComponent)
        .join('/')}${route.anchor ? `#${route.anchor}` : ''}`
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/**
 * Turn a generator-emitted link (`entry:<book>/<entry>#anchor`,
 * `category:<book>/<cat>`, `item:<id>`) into a route, or null when it is
 * something the app cannot navigate to.
 */
export function routeFromHref(raw: string): Route | null {
  const entry = raw.match(/^entry:([^/]+)\/(.+)$/)
  if (entry) {
    const [target, anchor] = entry[2].split('#')
    return { name: 'entry', bookId: entry[1], entryId: target, anchor }
  }
  const category = raw.match(/^category:([^/]+)\/(.+)$/)
  if (category) return { name: 'book', bookId: category[1] }
  return null
}
