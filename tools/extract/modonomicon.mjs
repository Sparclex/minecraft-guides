import { markdownToBlocks, inlineMarkdown } from '../lib/richtext.mjs'
import { bookId, entryText, isEmptyPage, plainText, mapInline } from '../lib/model.mjs'
import { titleCase } from '../lib/util.mjs'

/**
 * Modonomicon extends Markdown with a colour span written as
 * `[#](aa00aa)text[#]()`. The opening tag is swapped for a sentinel before
 * parsing (so the link syntax never fires) and turned into a real colour on
 * the inline runs afterwards.
 */
const OPEN = '\u0002'
const CLOSE = '\u0003'

function markColorSpans(text) {
  return String(text ?? '')
    .replace(/\[#\]\(([0-9a-fA-F]{3,8})\)/g, (_, hex) => `${OPEN}${hex}${OPEN}`)
    .replace(/\[#\]\(\)/g, CLOSE)
}

function applyColorSpans(nodes) {
  const out = []
  let color = null
  for (const node of nodes) {
    if (node.t !== 'text') {
      out.push(color ? { ...node, c: color } : node)
      continue
    }
    const pattern = new RegExp(`${OPEN}([0-9a-fA-F]{3,8})${OPEN}|${CLOSE}`, 'g')
    let last = 0
    let m
    while ((m = pattern.exec(node.v))) {
      const chunk = node.v.slice(last, m.index)
      if (chunk) out.push(color ? { ...node, v: chunk, c: color } : { ...node, v: chunk })
      color = m[1] ? `#${m[1]}` : null
      last = pattern.lastIndex
    }
    const tail = node.v.slice(last)
    if (tail) out.push(color ? { ...node, v: tail, c: color } : { ...node, v: tail })
  }
  return out
}

export const ENGINE = 'modonomicon'
export const LABEL = 'Modonomicon'

export function collect(jar) {
  const found = []
  for (const name of jar.names) {
    const m = name.match(/^data\/([^/]+)\/modonomicon\/books\/([^/]+)\/(.+\.json)$/)
    if (!m) continue
    found.push({ engine: ENGINE, ns: m[1], book: m[2], rest: m[3], path: name })
  }
  return found
}

export function build(sources, ctx) {
  const buckets = new Map()
  for (const src of sources) {
    const key = `${src.ns}:${src.book}`
    if (!buckets.has(key)) buckets.set(key, { ns: src.ns, book: src.book, files: [], mods: new Set() })
    buckets.get(key).files.push(src)
    buckets.get(key).mods.add(src.modId)
  }
  return [...buckets.values()].map((b) => buildBook(b, ctx)).filter(Boolean)
}

function buildBook(bucket, ctx) {
  const { ns, book, files } = bucket
  const lang = ctx.lang
  const definition = files.find((f) => f.rest === 'book.json')?.json ?? {}

  const id = bookId(ENGINE, ns, book)

  const mdCtx = {
    onInlineTag: () => null,
    /**
     * Modonomicon links use custom schemes: `entry://category/entry`,
     * `category://name` and `item://namespace:id`. Rewrite them into the
     * href vocabulary the site's renderer understands.
     */
    resolveLink(href) {
      const raw = String(href ?? '')
      const entry = raw.match(/^entry:\/\/(.+)$/)
      if (entry) {
        const [target, anchor] = entry[1].split('@')
        return `entry:${id}/${target}${anchor ? `#${anchor}` : ''}`
      }
      const category = raw.match(/^category:\/\/(.+)$/)
      if (category) return `category:${id}/${category[1]}`
      const item = raw.match(/^item:\/\/(.+)$/)
      if (item) return `item:${item[1]}`
      return raw
    },
  }

  const parse = (v) => markColorSpans(lang.get(v))
  const toBlocks = (v) => (v ? mapInline(markdownToBlocks(parse(v), mdCtx), applyColorSpans) : [])
  const toInline = (v) => (v ? applyColorSpans(inlineMarkdown(parse(v), mdCtx)) : null)
  const toText = (v) => (v ? plainText(inlineMarkdown(parse(v), mdCtx)).replace(/[\u0002\u0003]/g, '') : '')

  const categories = files
    .filter((f) => f.rest.startsWith('categories/'))
    .map((f) => {
      const json = f.json ?? {}
      const categoryId = f.rest.replace(/^categories\//, '').replace(/\.json$/, '')
      return {
        id: categoryId,
        name: toText(json.name) || titleCase(categoryId),
        description: toBlocks(json.description),
        icon: iconOf(json.icon),
        sort: json.sort_number ?? 0,
        parent: null,
      }
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  const known = new Set(categories.map((c) => c.id))
  const entries = []

  for (const f of files.filter((x) => x.rest.startsWith('entries/'))) {
    const json = f.json
    if (!json) continue
    const entryId = f.rest.replace(/^entries\//, '').replace(/\.json$/, '')
    const category = String(json.category ?? '').split(':').pop() || entryId.split('/')[0]

    const pages = []
    for (const raw of json.pages ?? []) {
      const page = convertPage(raw, { lang, toBlocks, toInline, toText, ctx, ns })
      if (page && !isEmptyPage(page)) pages.push(page)
    }

    const description = toText(json.description)
    const entry = {
      id: entryId,
      category: known.has(category) ? category : categories[0]?.id ?? 'main',
      name: toText(json.name) || titleCase(entryId.split('/').pop()),
      summary: description || null,
      icon: iconOf(json.icon),
      sort: json.sort_number ?? 0,
      pages,
      sourceMod: f.modId,
    }
    entry.text = entryText(entry)
    entries.push(entry)
  }

  if (!entries.length) return null
  entries.sort((a, b) => a.name.localeCompare(b.name))

  return {
    id,
    engine: ENGINE,
    engineLabel: LABEL,
    namespace: ns,
    slug: book,
    name: toText(definition.name) || titleCase(book),
    subtitle: toText(definition.tooltip) || null,
    landing: toBlocks(definition.description),
    modIds: [...bucket.mods],
    categories: categories.filter((c) => entries.some((e) => e.category === c.id)),
    entries,
  }
}

function iconOf(icon) {
  if (!icon) return null
  if (typeof icon === 'string') return icon.split('{')[0].trim() || null
  if (icon.item) return String(icon.item).split('{')[0].trim()
  return null
}

function convertPage(raw, env) {
  if (!raw) return null
  const { lang, toBlocks, toInline, toText, ctx } = env
  const fullType = String(raw.type ?? 'modonomicon:text')
  const type = fullType.replace(/^modonomicon:/, '')

  // Recipe pages carry two headings and one body.
  const titles = [raw.title, raw.title1, raw.title2].filter((t) => t && toText(t))
  const title = titles.length ? toInline(titles[0]) : null
  const body = toBlocks(raw.text)
  const page = { type, title, blocks: [] }
  const nameOf = (id) => lang.itemName(id)

  switch (type) {
    case 'text':
      page.blocks = body
      break

    case 'spotlight': {
      const item = iconOf(raw.item) ?? ''
      page.blocks = [{ k: 'itemcard', item, label: nameOf(item), text: [] }, ...body]
      if (!page.title && item) page.title = [{ t: 'text', v: nameOf(item), b: 1 }]
      break
    }

    case 'image': {
      const images = (raw.images ?? []).filter(Boolean)
      page.blocks = [
        ...images.map((res) => ({ k: 'image', src: ctx.image(res), alt: plainText(title) || null })),
        ...body,
      ]
      break
    }

    case 'entity': {
      const entity = String(raw.entity_id ?? '').split('{')[0].trim()
      page.blocks = [{ k: 'entity', entity, label: toText(raw.name) || nameOf(entity), text: [] }, ...body]
      break
    }

    case 'multiblock': {
      page.blocks = [
        {
          k: 'multiblock',
          name: toText(raw.multiblock_name) || null,
          id: raw.multiblock_id ?? null,
          text: [],
        },
        ...body,
      ]
      break
    }

    case 'empty':
      return null

    default: {
      // Everything ending in `_recipe`, including Occultism's ritual pages.
      const ids = [raw.recipe_id_1, raw.recipe_id_2].filter(Boolean).map(String)
      if (ids.length || /_recipe$/.test(type)) {
        page.blocks = [
          {
            k: 'recipe',
            kind: type.replace(/_recipe$/, '').replace(/^.*:/, ''),
            ids,
            labels: ids.map((r) => nameOf(r.split('/').pop())),
            text: [],
          },
          ...body,
        ]
        if (titles.length > 1) {
          page.blocks.push({ k: 'heading', level: 4, text: toInline(titles[1]) })
        }
      } else {
        page.blocks = body
        page.unsupported = fullType
      }
      break
    }
  }

  return page
}
