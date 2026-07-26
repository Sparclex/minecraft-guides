import { slug } from './util.mjs'

/** Flatten inline runs / blocks back to plain text (used for search). */
export function plainText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(plainText).join('')

  switch (node.t) {
    case 'text':
      return node.v ?? ''
    case 'br':
      return ' '
    case 'item':
      return node.label ?? node.id ?? ''
    default:
      break
  }

  switch (node.k) {
    case 'para':
    case 'heading':
      return `${plainText(node.text)}\n`
    case 'list':
      return `${node.items.map((i) => plainText(i)).join('\n')}\n`
    case 'table':
      return `${[node.head, ...node.rows].map((r) => r.map(plainText).join(' ')).join('\n')}\n`
    case 'code':
      return `${node.text}\n`
    case 'quote':
      return plainText(node.blocks)
    case 'image':
      return node.alt ? `${node.alt}\n` : ''
    case 'itemcard':
      return `${node.label ?? node.item ?? ''}\n${plainText(node.text)}\n`
    case 'recipe':
      return `${(node.labels ?? []).join(' ')}\n${plainText(node.text)}\n`
    case 'multiblock':
      return `${node.name ?? ''}\n${plainText(node.text)}\n`
    case 'entity':
      return `${node.label ?? node.entity ?? ''}\n${plainText(node.text)}\n`
    case 'link':
      return `${plainText(node.text)} ${node.url ?? ''}\n`
    case 'scene':
      return ''
    case 'group':
    case 'note':
      return plainText(node.blocks)
    case 'itemgrid':
      return `${node.items.map(plainText).join(' ')}\n`
    case 'subpages':
      return ''
    case 'relations':
      return `${node.entries.join(' ')}\n`
    case 'kv':
      return node.rows.map((r) => `${r[0]}: ${plainText(r[1])}`).join('\n')
    default:
      return ''
  }
}

/** Everything a reader would see in an entry, as one searchable string. */
export function entryText(entry) {
  const parts = [entry.name]
  for (const page of entry.pages) {
    if (page.title) parts.push(plainText(page.title))
    parts.push(plainText(page.blocks))
  }
  return parts
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Apply `fn` to every inline run array reachable from these blocks. */
export function mapInline(blocks, fn) {
  if (!Array.isArray(blocks)) return blocks
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block
    const next = { ...block }
    if (Array.isArray(next.text)) next.text = fn(next.text)
    if (Array.isArray(next.items)) next.items = next.items.map(fn)
    if (Array.isArray(next.head)) next.head = next.head.map(fn)
    if (Array.isArray(next.rows)) {
      next.rows = next.rows.map((row) =>
        // `kv` rows are [label, inline]; table rows are arrays of cells.
        block.k === 'kv' ? [row[0], fn(row[1])] : row.map(fn),
      )
    }
    if (Array.isArray(next.blocks)) next.blocks = mapInline(next.blocks, fn)
    return next
  })
}

export function bookId(engine, namespace, book) {
  return slug(`${engine}-${namespace}-${book}`)
}

/** Drop pages that carry no visible content at all. */
export function isEmptyPage(page) {
  if (page.title && plainText(page.title).trim()) return false
  return !page.blocks.some(
    (b) => b.k !== 'divider' && plainText(b).trim().length > 0 || b.k === 'image' || b.k === 'scene',
  )
}
