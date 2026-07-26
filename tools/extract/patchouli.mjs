import { patchouliToBlocks, patchouliToInline } from '../lib/richtext.mjs'
import { bookId, entryText, isEmptyPage, plainText } from '../lib/model.mjs'
import { log, splitId, titleCase } from '../lib/util.mjs'

export const ENGINE = 'patchouli'
export const LABEL = 'Patchouli'

/**
 * Locate Patchouli book files in a jar.
 *
 * Modern Patchouli splits a book across two roots: the book definition lives
 * under `data/`, the localised content under `assets/`. Older books keep
 * everything in one place, so both roots are scanned and merged.
 */
export function collect(jar) {
  const found = []
  for (const name of jar.names) {
    const m = name.match(/^(assets|data)\/([^/]+)\/patchouli_books\/([^/]+)\/(.+)$/)
    if (!m) continue
    const [, root, ns, book, rest] = m
    if (!rest.endsWith('.json')) continue
    found.push({ engine: ENGINE, ns, book, root, rest, path: name })
  }
  return found
}

/**
 * Build books from the collected sources.
 * `sources` is a flat list of { ns, book, rest, json, modId } records.
 */
const LOCALE_DIR = /^[a-z]{2}_[a-z]{2}$/

/**
 * Group sources into books.
 *
 * Patchouli keys a book by its folder name and lets *any* mod contribute
 * entries to it — Apothic Attributes ships pages for Apotheosis' Chronicle
 * without a book.json of its own. So the namespace declaring `book.json` owns
 * the book, and every namespace using that folder name feeds into it.
 *
 * Two unrelated mods can still pick the same folder name (Croptopia and
 * Extended Crafting both use `guide`), so when several namespaces each declare
 * a book.json they stay separate.
 */
export function build(sources, ctx) {
  const byName = new Map()
  for (const src of sources) {
    if (!byName.has(src.book)) byName.set(src.book, [])
    byName.get(src.book).push(src)
  }

  const books = []
  for (const [book, files] of byName) {
    const owners = [...new Set(files.filter((f) => f.rest === 'book.json').map((f) => f.ns))]

    if (!owners.length) {
      // A folder with no book.json is not a book. Iron's Spellbooks ships a
      // mis-nested `patchouli_books/ja_jp/` that would otherwise look like one.
      if (LOCALE_DIR.test(book)) continue
      log.warn(`patchouli: "${book}" has no book.json — skipped`)
      continue
    }

    const groups =
      owners.length === 1
        ? [{ ns: owners[0], book, files, mods: new Set(files.map((f) => f.modId)) }]
        : owners.map((ns) => {
            const own = files.filter((f) => f.ns === ns)
            return { ns, book, files: own, mods: new Set(own.map((f) => f.modId)) }
          })

    for (const group of groups) {
      const built = buildBook(group, ctx)
      if (built) books.push(built)
    }
  }
  return books
}

function buildBook(bucket, ctx) {
  const { ns, book, files } = bucket

  const definition = files.find((f) => f.rest === 'book.json')?.json
  // The locale folder is optional; some books drop content straight into root.
  const localeOf = (rest) => {
    const m = rest.match(/^([a-z]{2}_[a-z]{2})\//)
    return m ? m[1] : null
  }
  const hasLocales = files.some((f) => localeOf(f.rest))
  const content = files.filter((f) => {
    if (f.rest === 'book.json') return false
    const locale = localeOf(f.rest)
    return hasLocales ? locale === 'en_us' : true
  })

  const strip = (rest) => (hasLocales ? rest.replace(/^[a-z]{2}_[a-z]{2}\//, '') : rest)

  const categoryFiles = content.filter((f) => strip(f.rest).startsWith('categories/'))
  const entryFiles = content.filter((f) => strip(f.rest).startsWith('entries/'))

  if (!entryFiles.length) {
    // e.g. Iron's Spellbooks ships a stray `patchouli_books/ja_jp/` folder that
    // is a mis-nested locale rather than a real book.
    return null
  }

  const lang = ctx.lang
  const macros = definition?.macros ?? {}
  const textCtx = { macros }
  const resolve = (v) => (typeof v === 'string' ? lang.get(v) : '')
  const toBlocks = (v) => (v ? patchouliToBlocks(resolve(v), textCtx) : [])
  const toInline = (v) => (v ? patchouliToInline(resolve(v), textCtx) : null)

  const id = bookId(ENGINE, ns, book)

  const categories = categoryFiles
    .map((f) => {
      const relative = strip(f.rest).replace(/^categories\//, '').replace(/\.json$/, '')
      const catId = `${f.ns}:${relative}`
      const json = f.json ?? {}
      return {
        id: catId,
        relative,
        name: plainText(toInline(json.name)) || titleCase(relative),
        description: toBlocks(json.description),
        icon: normalizeIcon(json.icon),
        sort: json.sortnum ?? 0,
        parent: json.parent ? qualify(json.parent, f.ns) : null,
      }
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  const knownCategories = new Set(categories.map((c) => c.id))
  const byRelative = new Map(categories.map((c) => [c.relative, c.id]))

  /**
   * An entry's `category` may be written bare, qualified with its own
   * namespace, or qualified with the owning book's namespace — a mod adding
   * pages to someone else's book uses the latter.
   */
  const findCategory = (ref, fileNs) => {
    if (!ref) return null
    for (const candidate of [qualify(ref, fileNs), qualify(ref, ns), ref]) {
      if (knownCategories.has(candidate)) return candidate
    }
    return byRelative.get(String(ref).split(':').pop()) ?? null
  }

  const entries = []

  for (const f of entryFiles) {
    const json = f.json
    if (!json) continue
    const entryId = `${f.ns}:${strip(f.rest).replace(/^entries\//, '').replace(/\.json$/, '')}`

    const pages = []
    for (const raw of json.pages ?? []) {
      const page = convertPage(raw, { ns: f.ns, lang, textCtx, toBlocks, toInline, ctx })
      if (page && !isEmptyPage(page)) pages.push(page)
    }

    const entry = {
      id: entryId,
      category: findCategory(json.category, f.ns),
      name: plainText(toInline(json.name)) || titleCase(entryId.split(':')[1]),
      icon: normalizeIcon(json.icon),
      sort: json.sortnum ?? 0,
      priority: Boolean(json.priority),
      pages,
      sourceMod: f.modId,
    }
    entry.text = entryText(entry)
    entries.push(entry)
  }

  entries.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  // Entries whose category was never declared still need somewhere to live.
  const orphans = entries.filter((e) => !e.category)
  if (orphans.length) {
    categories.push({
      id: `${ns}:__misc`,
      name: 'Other',
      description: [],
      icon: null,
      sort: 9999,
      parent: null,
    })
    for (const e of orphans) e.category = `${ns}:__misc`
  }

  const name = resolveTitle(plainText(toInline(definition?.name)), { ns, book, lang, ctx })

  const subtitleRaw = definition?.subtitle
  const subtitle =
    typeof subtitleRaw === 'string' && lang.has(subtitleRaw)
      ? plainText(patchouliToInline(lang.get(subtitleRaw), textCtx))
      : typeof subtitleRaw === 'string' && !looksLikeLangKey(subtitleRaw)
        ? plainText(patchouliToInline(subtitleRaw, textCtx))
        : null

  return {
    id,
    engine: ENGINE,
    engineLabel: LABEL,
    namespace: ns,
    slug: book,
    name,
    subtitle,
    landing: toBlocks(definition?.landing_text),
    modIds: [...bucket.mods],
    categories: categories.filter((c) => entries.some((e) => e.category === c.id)),
    entries,
  }
}

function qualify(id, ns) {
  return String(id).includes(':') ? String(id) : `${ns}:${id}`
}

/** A translation key that was never translated, e.g. `book.irons_spellbooks.name`. */
function looksLikeLangKey(s) {
  return /^[a-z0-9_]+(\.[a-z0-9_]+){2,}$/.test(String(s).trim())
}

/** Prefer the book's own title, then its lang key, then the owning mod's name. */
function resolveTitle(candidate, { ns, book, lang, ctx }) {
  // Some books set `name` to their own folder name, which is not a title.
  const isPlaceholder = !candidate || candidate === book || looksLikeLangKey(candidate)
  if (!isPlaceholder) return candidate
  for (const key of [`book.${ns}.name`, `item.${ns}.${book}`, `book.${ns}.${book}.name`]) {
    if (lang.has(key)) return lang.get(key)
  }
  const mod = ctx.modName?.(ns)
  if (mod) return `${mod} Guide`
  return titleCase(book)
}

function normalizeIcon(icon) {
  if (!icon) return null
  if (typeof icon === 'string') return icon.split('{')[0].trim() || null
  if (typeof icon === 'object' && icon.item) return String(icon.item).split('{')[0].trim()
  return null
}

/** Patchouli page -> unified page. */
function convertPage(raw, env) {
  if (!raw) return null
  if (typeof raw === 'string') return { type: 'text', title: null, blocks: [{ k: 'para', text: [{ t: 'text', v: raw }] }] }

  const { ns, lang, toBlocks, toInline, ctx } = env
  const type = String(raw.type ?? 'patchouli:text').replace(/^patchouli:/, '')
  const title = toInline(raw.title)
  const body = toBlocks(raw.text)
  const page = { type, title, blocks: [] }

  const nameOf = (id) => lang.itemName(id)

  switch (type) {
    case 'text':
      page.blocks = body
      break

    case 'spotlight': {
      const item = stackId(raw.item)
      page.blocks = [
        { k: 'itemcard', item, label: nameOf(item), text: [] },
        ...body,
      ]
      if (!page.title) page.title = [{ t: 'text', v: nameOf(item), b: 1 }]
      break
    }

    case 'image': {
      const images = (Array.isArray(raw.images) ? raw.images : [raw.image]).filter(Boolean)
      page.blocks = [
        ...images.map((res) => ({ k: 'image', src: ctx.image(res), alt: plainText(title) || null })),
        ...body,
      ]
      break
    }

    case 'crafting':
    case 'smelting':
    case 'blasting':
    case 'smoking':
    case 'campfire':
    case 'stonecutting':
    case 'smithing': {
      const recipes = [raw.recipe, raw.recipe2].filter(Boolean).map(String)
      page.blocks = [
        {
          k: 'recipe',
          kind: type,
          ids: recipes,
          labels: recipes.map((r) => nameOf(recipeOutputGuess(r))),
          text: [],
        },
        ...body,
      ]
      break
    }

    case 'entity': {
      const entity = String(raw.entity ?? '').split('{')[0].trim()
      page.blocks = [{ k: 'entity', entity, label: nameOf(entity), text: [] }, ...body]
      if (!page.title && raw.name) page.title = toInline(raw.name)
      break
    }

    case 'multiblock': {
      const mbName = raw.name ? plainText(toInline(raw.name)) : null
      page.blocks = [
        { k: 'multiblock', name: mbName, id: raw.multiblock_id ?? null, text: [] },
        ...body,
      ]
      break
    }

    case 'link': {
      page.blocks = [
        ...body,
        { k: 'link', url: String(raw.url ?? ''), text: toInline(raw.link_text) ?? [{ t: 'text', v: String(raw.url ?? '') }] },
      ]
      break
    }

    case 'relations': {
      const related = (raw.entries ?? []).map((e) => qualify(e, ns))
      page.blocks = [
        ...body,
        { k: 'relations', entries: related },
      ]
      if (!page.title) page.title = [{ t: 'text', v: 'See also', b: 1 }]
      break
    }

    case 'quest':
      page.blocks = body
      break

    case 'empty':
      return null

    default: {
      // Mod-defined page types: keep whatever prose they carry rather than
      // dropping the page outright.
      page.blocks = body.length ? body : []
      page.unsupported = String(raw.type ?? type)
      if (!page.blocks.length) return null
      break
    }
  }

  return page
}

function stackId(v) {
  if (!v) return ''
  const s = typeof v === 'string' ? v : (v.item ?? '')
  return String(s).split('{')[0].split('[')[0].trim()
}

/** Recipe ids usually mirror their output item, which is close enough for a label. */
function recipeOutputGuess(recipeId) {
  const { ns, path } = splitId(recipeId)
  return `${ns}:${path.split('/').pop()}`
}

export function warnUnsupported(books) {
  const seen = new Map()
  for (const b of books) {
    for (const e of b.entries) {
      for (const p of e.pages) {
        if (p.unsupported) seen.set(p.unsupported, (seen.get(p.unsupported) ?? 0) + 1)
      }
    }
  }
  for (const [type, count] of seen) log.info(`  patchouli: custom page type ${type} x${count} (text kept)`)
}
