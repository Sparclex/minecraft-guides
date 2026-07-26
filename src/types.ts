/** Mirrors the shapes written by `tools/generate.mjs`. */

export type Inline =
  | {
      t: 'text'
      v: string
      /** bold, italic, underline, strikethrough, obfuscated, inline code */
      b?: 1
      i?: 1
      u?: 1
      s?: 1
      k?: 1
      code?: 1
      /** hex colour */
      c?: string
      href?: string
      tip?: string
    }
  | { t: 'br' }
  | { t: 'item'; id: string; label?: string }

export type Block =
  | { k: 'para'; text: Inline[] }
  | { k: 'heading'; level: number; text: Inline[] }
  | { k: 'list'; ordered: boolean; items: Inline[][] }
  | { k: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { k: 'code'; lang: string | null; text: string }
  | { k: 'quote'; blocks: Block[] }
  | { k: 'group'; blocks: Block[] }
  | { k: 'image'; src: string | null; alt: string | null }
  | { k: 'itemcard'; item: string; label?: string; text: Inline[] }
  | { k: 'recipe'; kind: string; ids: string[]; labels: string[]; text: Inline[] }
  | { k: 'multiblock'; name: string | null; id: string | null; text: Inline[] }
  | { k: 'entity'; entity: string; label?: string; text: Inline[] }
  | { k: 'link'; url: string; text: Inline[] }
  | { k: 'relations'; entries: string[] }
  | { k: 'itemgrid'; items: Inline[] }
  | { k: 'subpages'; category?: string | null }
  | { k: 'scene'; label: string; note: string; structure: string | null }
  | { k: 'kv'; rows: [string, Inline[]][] }
  | { k: 'divider' }

export interface Page {
  type: string
  title: Inline[] | null
  blocks: Block[]
  optional?: boolean
  unsupported?: string
}

export interface Entry {
  id: string
  category: string
  name: string
  summary?: string | null
  icon: string | null
  sort: number
  depth?: number
  questCount?: number
  children?: { id: string; name: string }[]
  pages: Page[]
  text: string
  sourceMod: string
}

export interface Category {
  id: string
  name: string
  description: Block[]
  icon: string | null
  sort: number
  parent: string | null
}

export interface Book {
  id: string
  engine: string
  engineLabel: string
  namespace: string
  slug: string
  name: string
  subtitle: string | null
  landing: Block[]
  modIds: string[]
  modNames: string[]
  contributors: { id: string; name: string; entries: number }[]
  categories: Category[]
  entries: Entry[]
}

export interface BookSummary {
  id: string
  engine: string
  engineLabel: string
  namespace: string
  name: string
  subtitle: string | null
  summary: string | null
  modIds: string[]
  modNames: string[]
  contributors: { id: string; name: string; entries: number }[]
  entryCount: number
  pageCount: number
  categories: { id: string; name: string; entryCount: number }[]
}

export interface ModRecord {
  id: string
  name: string
  version: string | null
  description: string | null
  authors: string | null
  file: string
  curseforge: { project: number; file: number } | null
  guideCount: number
}

export interface Index {
  generatedAt: string
  generator: string
  pack: {
    name: string
    version: string
    minecraft: string | null
    synopsis?: string
    website?: string | null
    source?: string | null
    repo: string
    projectId: number | null
  }
  totals: {
    mods: number
    modsWithGuides: number
    books: number
    categories: number
    entries: number
    pages: number
    images: number
  }
  engines: { id: string; label: string; books: number; entries: number }[]
  mods: ModRecord[]
  books: BookSummary[]
}

export interface SearchRow {
  b: string
  e: string
  t: string
  c: string
  x: string
}
