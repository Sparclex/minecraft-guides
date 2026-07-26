import path from 'node:path'
import { markdownToBlocks, splitFrontmatter } from '../lib/richtext.mjs'
import { bookId, entryText, plainText } from '../lib/model.mjs'
import { titleCase } from '../lib/util.mjs'

export const ENGINE = 'guideme'
export const LABEL = 'GuideME'

/**
 * GuideME guides are folders of Markdown. Two layouts exist in the wild:
 *
 *   assets/<ns>/ae2guide/**            — AE2's guide; addon mods drop pages
 *                                        into their own namespace and AE2
 *                                        merges them into one book.
 *   assets/<ns>/guides/<gns>/<gid>/**  — the generic registration, e.g. Powah.
 */
export function collect(jar) {
  const found = []
  for (const name of jar.names) {
    let guide = null
    let rest = null

    const legacy = name.match(/^assets\/([^/]+)\/ae2guide\/(.+)$/)
    if (legacy) {
      guide = 'ae2:ae2guide'
      rest = legacy[2]
    } else {
      const generic = name.match(/^assets\/[^/]+\/guides\/([^/]+)\/([^/]+)\/(.+)$/)
      if (generic) {
        guide = `${generic[1]}:${generic[2]}`
        rest = generic[3]
      }
    }
    if (!guide) continue

    // Translations live in `_xx_xx` folders; the English source sits at the
    // unprefixed path.
    if (rest.split('/').some((p) => /^_[a-z]{2}_[a-z]{2}$/.test(p))) continue

    const ext = path.extname(rest).toLowerCase()
    if (ext === '.md') found.push({ engine: ENGINE, guide, rest, path: name, kind: 'text' })
    else if (ext === '.png' || ext === '.jpg') found.push({ engine: ENGINE, guide, rest, path: name, kind: 'binary' })
  }
  return found
}

export function build(sources, ctx) {
  const buckets = new Map()
  for (const src of sources) {
    if (!buckets.has(src.guide)) buckets.set(src.guide, { guide: src.guide, files: [], mods: new Set() })
    buckets.get(src.guide).files.push(src)
    buckets.get(src.guide).mods.add(src.modId)
  }
  return [...buckets.values()].map((b) => buildGuide(b, ctx)).filter(Boolean)
}

function buildGuide(bucket, ctx) {
  const [guideNs, guideName] = bucket.guide.split(':')
  const id = bookId(ENGINE, guideNs, guideName)

  const pages = bucket.files.filter((f) => f.kind === 'text')
  const assets = new Map(bucket.files.filter((f) => f.kind === 'binary').map((f) => [f.rest, f]))
  if (!pages.length) return null

  // ---- pass 1: frontmatter + nav graph -------------------------------
  const nodes = new Map()
  for (const file of pages) {
    const { data, body } = splitFrontmatter(file.text)
    const nav = data.navigation ?? {}
    nodes.set(file.rest, {
      key: file.rest,
      dir: path.posix.dirname(file.rest),
      title: nav.title ? String(nav.title) : null,
      // `navigation.parent` is written relative to the guide root, unlike the
      // links in the page body which are relative to the page itself.
      parentRef: nav.parent ? String(nav.parent) : null,
      position: typeof nav.position === 'number' ? nav.position : 999,
      icon: nav.icon ? qualifyItem(String(nav.icon), guideNs) : null,
      itemIds: Array.isArray(data.item_ids) ? data.item_ids.map(String) : [],
      body,
      file,
    })
  }

  const rootKey = ['index.md', `${guideName}/index.md`].find((k) => nodes.has(k)) ?? findRoot(nodes)
  for (const node of nodes.values()) {
    node.parent = resolveNav(node.parentRef, node.key, nodes)
    if (node.key === rootKey) node.parent = null
  }

  const childrenOf = new Map()
  for (const node of nodes.values()) {
    if (node.key === rootKey) continue
    const parent = node.parent ?? rootKey
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(node)
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.position - b.position || labelOf(a).localeCompare(labelOf(b)))
  }

  // ---- pass 2: categories are the root's direct children -------------
  const topLevel = childrenOf.get(rootKey) ?? []
  const categories = []
  const entries = []
  const categoryOfPage = new Map()

  const assign = (node, categoryId, depth) => {
    categoryOfPage.set(node.key, { categoryId, depth })
    for (const child of childrenOf.get(node.key) ?? []) assign(child, categoryId, depth + 1)
  }

  let order = 0
  for (const top of topLevel) {
    const kids = childrenOf.get(top.key) ?? []
    if (kids.length) {
      const catId = top.key
      categories.push({
        id: catId,
        name: labelOf(top),
        description: [],
        icon: top.icon,
        sort: order++,
        parent: null,
      })
      categoryOfPage.set(top.key, { categoryId: catId, depth: 0, isIndex: true })
      for (const child of kids) assign(child, catId, 1)
    } else {
      categoryOfPage.set(top.key, { categoryId: '__pages', depth: 0 })
    }
  }
  if ([...categoryOfPage.values()].some((v) => v.categoryId === '__pages')) {
    categories.push({ id: '__pages', name: 'Pages', description: [], icon: null, sort: order++, parent: null })
  }

  // Anything the nav graph never reached still deserves a home.
  for (const node of nodes.values()) {
    if (node.key !== rootKey && !categoryOfPage.has(node.key)) {
      categoryOfPage.set(node.key, { categoryId: '__more', depth: 0 })
    }
  }
  if ([...categoryOfPage.values()].some((v) => v.categoryId === '__more')) {
    categories.push({ id: '__more', name: 'Reference', description: [], icon: null, sort: order++, parent: null })
  }

  // ---- pass 3: render markdown ---------------------------------------
  const renderNode = (node) => {
    const blocks = markdownToBlocks(node.body, makeMarkdownContext({ node, guideNs, nodes, assets, ctx, id }))
    // Pages open with an H1 repeating their navigation title; the site already
    // shows that as the entry heading.
    const first = blocks[0]
    if (first?.k === 'heading' && first.level === 1 && plainText(first.text).trim() === labelOf(node)) {
      return blocks.slice(1)
    }
    return blocks
  }

  for (const node of nodes.values()) {
    if (node.key === rootKey) continue
    const placement = categoryOfPage.get(node.key)
    const blocks = renderNode(node)
    if (!blocks.length && !(childrenOf.get(node.key) ?? []).length) continue

    const children = (childrenOf.get(node.key) ?? []).map((c) => ({
      id: c.key,
      name: labelOf(c),
    }))

    const entry = {
      id: node.key,
      category: placement.categoryId,
      name: labelOf(node),
      icon: node.icon,
      sort: placement.depth * 1000 + node.position,
      depth: placement.depth,
      children,
      itemIds: node.itemIds,
      pages: [{ type: 'markdown', title: null, blocks }],
      sourceMod: node.file.modId,
    }
    entry.text = entryText(entry)
    entries.push(entry)
  }

  entries.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  // A guide carries no title of its own — its root page is usually just called
  // "Index" — so name it after the mod that registered it.
  const root = nodes.get(rootKey)
  const owner = ctx.modName?.(guideNs)
  const bookName = owner ? `${owner} Guide` : titleCase(guideName.replace(/guide$/, '')) || 'Guide'

  return {
    id,
    engine: ENGINE,
    engineLabel: LABEL,
    namespace: guideNs,
    slug: guideName,
    name: bookName,
    subtitle: null,
    landing: root ? renderNode(root) : [],
    modIds: [...bucket.mods],
    categories: categories.filter((c) => entries.some((e) => e.category === c.id)),
    entries,
  }
}

function labelOf(node) {
  return node.title || titleCase(path.posix.basename(node.key, '.md').replace(/-index$/, ''))
}

function findRoot(nodes) {
  for (const key of nodes.keys()) if (path.posix.basename(key) === 'index.md') return key
  return [...nodes.keys()][0]
}

/**
 * Resolve `navigation.parent`. Guides write it relative to the guide root
 * (`items-blocks-machines/index.md`), but a few pages use a page-relative
 * path, so fall back to that before giving up.
 */
function resolveNav(ref, fromKey, nodes) {
  if (!ref) return null
  const direct = ref.split('#')[0].replace(/^\.?\//, '')
  if (nodes.has(direct)) return direct
  const relative = resolveRef(ref, fromKey)
  return relative && nodes.has(relative) ? relative : null
}

/** Resolve a page-relative reference (`../foo/bar.md`) to a guide-relative key. */
function resolveRef(ref, fromKey) {
  const clean = ref.split('#')[0]
  if (!clean) return null
  if (clean.startsWith('/')) return clean.slice(1)
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromKey), clean))
  return joined.replace(/^\.\//, '')
}

function qualifyItem(id, ns) {
  const s = String(id).trim()
  return s.includes(':') ? s : `${ns}:${s}`
}

/**
 * Translate GuideME's MDX-ish components. Anything that only makes sense as a
 * live 3D scene becomes a labelled placeholder rather than vanishing.
 */
function makeMarkdownContext({ node, guideNs, nodes, assets, ctx, id }) {
  const nameOf = (itemId) => ctx.lang.itemName(itemId)

  const itemChip = (rawId, label) => {
    const itemId = qualifyItem(rawId ?? '', guideNs)
    return { t: 'item', id: itemId, label: label ?? nameOf(itemId) }
  }

  const recipeBlock = (kind, ids) => ({
    k: 'recipe',
    kind,
    ids: ids.map((i) => qualifyItem(i, guideNs)),
    labels: ids.map((i) => nameOf(qualifyItem(i, guideNs))),
    text: [],
  })

  return {
    resolveLink(href) {
      if (/^(https?:|mailto:)/.test(href)) return href
      const [target, hash] = href.split('#')
      if (!target) return `#${hash ?? ''}`
      const key = resolveRef(target, node.key)
      if (key && nodes.has(key)) return `entry:${id}/${key}${hash ? `#${hash}` : ''}`
      return href
    },

    onInlineTag(name, attrs) {
      switch (name) {
        case 'ItemLink':
        case 'ItemIcon':
        case 'ItemImage':
        case 'BlockImage':
          return itemChip(attrs.id, attrs.name)
        case 'Recipe':
        case 'RecipeFor':
        case 'RecipesFor':
          return itemChip(attrs.id)
        default:
          // `<powah:EnergyCapacity id="…"/>` and friends resolve against the
          // running game's config, so there is no value to print here.
          if (name.includes(':')) {
            return { t: 'text', v: 'in-game', i: 1, tip: `${name} — ${attrs.id ?? ''}`.trim() }
          }
          return null
      }
    },

    onTag(name, attrs, raw) {
      switch (name) {
        case 'GameScene': {
          const structure = raw.match(/<ImportStructure\s+src="([^"]+)"/)?.[1] ?? null
          return {
            k: 'scene',
            label: 'Interactive 3D scene',
            note: 'This page shows a rotatable in-world build in the game client.',
            structure: structure ? path.posix.basename(structure) : null,
          }
        }
        case 'RecipeFor':
        case 'Recipe':
          return recipeBlock('crafting', [attrs.id].filter(Boolean))
        case 'RecipesFor':
          return recipeBlock('crafting', [attrs.id].filter(Boolean))
        case 'ItemGrid':
          return { k: 'itemgrid', items: [...raw.matchAll(/id="([^"]+)"/g)].map((m) => itemChip(m[1])) }
        case 'SubPages':
          return { k: 'subpages' }
        case 'CategoryIndex':
          return { k: 'subpages', category: attrs.category ?? null }
        case 'Row':
        case 'Column': {
          const inner = raw.replace(/^[^\n]*\n/, '').replace(/<\/(Row|Column)>\s*$/, '')
          const blocks = markdownToBlocks(inner, makeMarkdownContext({ node, guideNs, nodes, assets, ctx, id }))
          return blocks.length ? { k: 'group', blocks } : null
        }
        case 'ItemLink':
        case 'ItemImage':
        case 'BlockImage':
        case 'ItemIcon':
          return { k: 'para', text: [itemChip(attrs.id, attrs.name)] }
        default:
          return null
      }
    },

    // Relative image paths resolve against the page, then into the asset dump.
    resolveImage(src) {
      const key = resolveRef(src, node.key)
      const asset = key ? assets.get(key) : null
      return asset ? ctx.emitAsset(asset) : src
    },
  }
}
