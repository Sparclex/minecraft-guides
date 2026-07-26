/**
 * Converts the two text dialects used by in-game guide books into the flat
 * block/inline model the website renders:
 *
 *   Block  = { k: 'para' | 'heading' | 'list' | 'table' | 'code' | 'quote' | ... }
 *   Inline = { t: 'text', v, b?, i?, u?, s?, k?, c?, href?, tip? } | { t: 'br' }
 *
 * Keeping inline runs flat (rather than a nested tree) mirrors how Minecraft
 * itself models formatting, and makes the React renderer trivial.
 */

const VANILLA_COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa',
  4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
  8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
}

// Patchouli's built-in macros, per the format documentation.
const BUILTIN_MACROS = {
  bold: '$(l)', italic: '$(o)', italics: '$(o)', strike: '$(m)',
  underline: '$(n)', obf: '$(k)', nocolor: '$(0)',
  item: '$(#b0b)', thing: '$(#490)', reset: '$()',
  p: '$(br2)', '2br': '$(br2)',
}

const emptyStyle = () => ({ b: 0, i: 0, u: 0, s: 0, k: 0, c: null })

/**
 * Patchouli-formatted string -> Block[].
 * `$(br2)`/`$(p)` split paragraphs; `$(li)` opens a bullet item.
 */
export function patchouliToBlocks(raw, ctx = {}) {
  const text = expandMacros(String(raw ?? ''), ctx.macros)
  const paragraphs = []
  let current = []
  let style = emptyStyle()
  let link = null
  let tip = null
  let listMode = false

  const push = (v) => {
    if (!v) return
    const node = { t: 'text', v }
    for (const key of ['b', 'i', 'u', 's', 'k']) if (style[key]) node[key] = 1
    if (style.c) node.c = style.c
    if (link) node.href = link
    if (tip) node.tip = tip
    current.push(node)
  }
  const breakParagraph = () => {
    paragraphs.push({ inline: current, list: listMode })
    current = []
  }

  let i = 0
  let buffer = ''
  while (i < text.length) {
    const open = text.indexOf('$(', i)
    if (open < 0) {
      buffer += text.slice(i)
      break
    }
    const close = text.indexOf(')', open)
    if (close < 0) {
      buffer += text.slice(i)
      break
    }
    buffer += text.slice(i, open)
    const code = text.slice(open + 2, close)
    i = close + 1

    push(buffer)
    buffer = ''

    if (code === '' || code === '0') {
      style = emptyStyle()
      link = null
      tip = null
    } else if (code === 'br') {
      current.push({ t: 'br' })
    } else if (code === 'br2') {
      breakParagraph()
      listMode = false
    } else if (code === 'li') {
      if (current.length) breakParagraph()
      listMode = true
    } else if (code === '/l') {
      link = null
    } else if (code === '/t') {
      tip = null
    } else if (code.startsWith('l:')) {
      link = code.slice(2)
    } else if (code.startsWith('t:')) {
      tip = code.slice(2)
    } else if (code.startsWith('k:')) {
      push(`[${code.slice(2).replace(/^key\./, '').replace(/\./g, ' ')}]`)
    } else if (code === 'playername') {
      push('you')
    } else if (code.startsWith('#')) {
      style.c = normalizeHex(code)
    } else if (code.length === 1 && code in VANILLA_COLORS) {
      style.c = VANILLA_COLORS[code]
    } else if (code === 'l') style.b = 1
    else if (code === 'o') style.i = 1
    else if (code === 'm') style.s = 1
    else if (code === 'n') style.u = 1
    else if (code === 'k') style.k = 1
    // Unknown macros are dropped rather than shown as literal garbage.
  }
  push(buffer)
  breakParagraph()

  // Fold consecutive `$(li)` paragraphs into a single list block.
  const blocks = []
  let pending = null
  for (const para of paragraphs) {
    if (!para.inline.length) continue
    if (para.list) {
      pending ??= { k: 'list', ordered: false, items: [] }
      pending.items.push(para.inline)
    } else {
      if (pending) {
        blocks.push(pending)
        pending = null
      }
      blocks.push({ k: 'para', text: para.inline })
    }
  }
  if (pending) blocks.push(pending)
  return blocks
}

/** Same as above but flattened to a single inline run (for titles). */
export function patchouliToInline(raw, ctx = {}) {
  const blocks = patchouliToBlocks(raw, ctx)
  const out = []
  for (const b of blocks) {
    if (out.length) out.push({ t: 'br' })
    if (b.k === 'para') out.push(...b.text)
    else if (b.k === 'list') for (const item of b.items) out.push(...item)
  }
  return out
}

function normalizeHex(code) {
  const hex = code.slice(1)
  if (hex.length === 3) return `#${[...hex].map((c) => c + c).join('')}`
  if (hex.length === 6) return `#${hex}`
  return null
}

function expandMacros(text, macros) {
  const table = { ...BUILTIN_MACROS, ...(macros ?? {}) }
  let out = text
  for (let pass = 0; pass < 5; pass++) {
    let changed = false
    out = out.replace(/\$\(([^)]*)\)/g, (whole, key) => {
      if (Object.hasOwn(table, key) && table[key] !== whole) {
        changed = true
        return table[key]
      }
      return whole
    })
    if (!changed) break
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Markdown (GuideME pages, Modonomicon text)
 * ------------------------------------------------------------------ */

/**
 * Markdown -> Block[]. Supports the subset guide books actually use:
 * headings, paragraphs, lists, tables, fenced code, blockquotes, rules,
 * images and inline emphasis/links/code.
 *
 * `ctx.onTag(name, attrs, inner)` lets a caller translate the custom
 * MDX-ish components GuideME embeds (e.g. <GameScene>, <ItemLink>).
 */
export function markdownToBlocks(md, ctx = {}) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  const flushParagraph = (buf) => {
    const joined = buf.join('\n').trim()
    if (joined) blocks.push(...paragraphFromText(joined, ctx))
  }

  let para = []
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    const fence = line.match(/^\s*(```+|~~~+)\s*(\S*)/)
    if (fence) {
      flushParagraph(para)
      para = []
      const marker = fence[1][0].repeat(3)
      const body = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) body.push(lines[i++])
      i++
      blocks.push({ k: 'code', lang: fence[2] || null, text: body.join('\n') })
      continue
    }

    // Multi-line custom component block, e.g. <GameScene ...> ... </GameScene>
    const tagOpen = line.match(/^\s*<([A-Z][A-Za-z0-9]*)\b/)
    if (tagOpen) {
      flushParagraph(para)
      para = []
      const { block, next } = consumeComponent(lines, i, ctx)
      if (block) blocks.push(block)
      i = next
      continue
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph(para)
      para = []
      blocks.push({ k: 'heading', level: heading[1].length, text: inlineMarkdown(heading[2], ctx) })
      i++
      continue
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushParagraph(para)
      para = []
      blocks.push({ k: 'divider' })
      i++
      continue
    }

    // Table
    if (/\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      flushParagraph(para)
      para = []
      const head = splitRow(line).map((c) => inlineMarkdown(c, ctx))
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map((c) => inlineMarkdown(c, ctx)))
        i++
      }
      blocks.push({ k: 'table', head, rows })
      continue
    }

    // Lists
    const bullet = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      flushParagraph(para)
      para = []
      const ordered = /\d/.test(bullet[2])
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
        if (!m) {
          // continuation line of the previous item
          if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
            items[items.length - 1].push({ t: 'text', v: ' ' }, ...inlineMarkdown(lines[i].trim(), ctx))
            i++
            continue
          }
          break
        }
        items.push(inlineMarkdown(m[3], ctx))
        i++
      }
      blocks.push({ k: 'list', ordered, items })
      continue
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      flushParagraph(para)
      para = []
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ k: 'quote', blocks: markdownToBlocks(body.join('\n'), ctx) })
      continue
    }

    if (!line.trim()) {
      flushParagraph(para)
      para = []
      i++
      continue
    }

    para.push(line)
    i++
  }
  flushParagraph(para)
  return blocks
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
}

/** A paragraph that is only an image becomes an image block. */
function paragraphFromText(text, ctx) {
  const only = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
  if (only) {
    return [{ k: 'image', src: ctx.resolveImage?.(only[2]) ?? only[2], alt: only[1] || null }]
  }
  return [{ k: 'para', text: inlineMarkdown(text, ctx) }]
}

/**
 * Consume a (possibly multi-line, possibly self-closing) capitalised component
 * and hand it to ctx.onTag for translation.
 */
function consumeComponent(lines, start, ctx) {
  const name = lines[start].match(/^\s*<([A-Z][A-Za-z0-9]*)\b/)[1]
  const selfClosing = /\/>\s*$/.test(lines[start]) && !lines[start].includes(`</${name}`)
  let end = start
  if (!selfClosing && !lines[start].includes(`</${name}>`)) {
    let depth = 0
    for (let j = start; j < lines.length; j++) {
      if (new RegExp(`<${name}\\b`).test(lines[j])) depth++
      if (new RegExp(`</${name}>`).test(lines[j])) depth--
      if (depth <= 0 && j > start) {
        end = j
        break
      }
      end = j
    }
  }
  const rawText = lines.slice(start, end + 1).join('\n')
  const attrs = parseAttrs(rawText.slice(rawText.indexOf(name) + name.length))
  const block = ctx.onTag?.(name, attrs, rawText) ?? null
  return { block, next: end + 1 }
}

function parseAttrs(s) {
  const attrs = {}
  for (const m of s.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4]
  }
  return attrs
}

/** Inline markdown -> Inline[] (flat runs, same shape as the Patchouli output). */
export function inlineMarkdown(src, ctx = {}) {
  const out = []
  let text = String(src ?? '')

  // Inline components first, so their payload isn't mangled by emphasis rules.
  // Capitalised components (<ItemLink/>) plus namespaced ones that mods
  // register for computed values (<powah:EnergyCapacity/>).
  const COMPONENT = /<((?:[A-Z][A-Za-z0-9]*)|(?:[a-z][a-z0-9_]*:[A-Za-z0-9_]+))\b([^>]*?)\/?>/g
  text = text.replace(COMPONENT, (whole, name, rest) => {
    const node = ctx.onInlineTag?.(name, parseAttrs(rest), whole)
    if (node === undefined || node === null) return ''
    if (typeof node === 'string') return node
    out.push(node)
    return `\x00${out.length - 1}\x00`
  })

  const placeholders = out
  const nodes = []
  const push = (v, style) => {
    if (!v) return
    nodes.push({ t: 'text', v, ...style })
  }

  const pattern =
    /\x00(\d+)\x00|`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]*)\]\(([^)\s]+)[^)]*\)|(\*\*\*|___)(.+?)\7|(\*\*|__)(.+?)\9|(\*|_)(.+?)\11|~~(.+?)~~|<br\s*\/?>|\\\n/g

  let last = 0
  let m
  while ((m = pattern.exec(text))) {
    push(unescapeMd(text.slice(last, m.index)))
    last = pattern.lastIndex
    if (m[1] !== undefined) nodes.push(placeholders[Number(m[1])])
    else if (m[2] !== undefined) nodes.push({ t: 'text', v: m[2], code: 1 })
    else if (m[3] !== undefined) nodes.push({ t: 'text', v: m[3] || 'image', i: 1 })
    else if (m[5] !== undefined) {
      const inner = inlineMarkdown(m[5], ctx)
      const href = ctx.resolveLink?.(m[6]) ?? m[6]
      for (const n of inner) nodes.push({ ...n, href })
    } else if (m[8] !== undefined) push(unescapeMd(m[8]), { b: 1, i: 1 })
    else if (m[10] !== undefined) push(unescapeMd(m[10]), { b: 1 })
    else if (m[12] !== undefined) push(unescapeMd(m[12]), { i: 1 })
    else if (m[13] !== undefined) push(unescapeMd(m[13]), { s: 1 })
    else nodes.push({ t: 'br' })
  }
  push(unescapeMd(text.slice(last)))
  return nodes
}

function unescapeMd(s) {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
}

/** Split `---\nyaml\n---\nbody` into its two halves. */
export function splitFrontmatter(src) {
  const text = String(src ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!text.startsWith('---\n')) return { data: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: text }
  const head = text.slice(4, end)
  const body = text.slice(text.indexOf('\n', end + 1) + 1)
  return { data: parseSimpleYaml(head), body }
}

/**
 * Tiny YAML reader covering the frontmatter shapes guide books use:
 * nested maps, `- item` sequences and scalars. Not a general YAML parser —
 * no anchors, flow collections, block scalars or multi-document input.
 */
function parseSimpleYaml(src) {
  const lines = src
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }))

  let cursor = 0

  function parseBlock(indent) {
    if (cursor >= lines.length) return {}

    if (lines[cursor].text.startsWith('- ')) {
      const list = []
      while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith('- ')) {
        const item = lines[cursor].text.slice(2).trim()
        cursor++
        // `- key: value` opens a map inside the sequence. The space after the
        // colon is what distinguishes it from a plain scalar like
        // `- powah:reactor_basic`, which is an id, not a mapping.
        const pair = item.match(/^([^:]+):(?:[ \t]+(.*))?$/)
        if (pair && !/^["']/.test(item)) {
          const entry = { [pair[1].trim()]: pair[2]?.trim() ? scalarOf(pair[2].trim()) : null }
          while (cursor < lines.length && lines[cursor].indent > indent && !lines[cursor].text.startsWith('- ')) {
            const m = lines[cursor].text.match(/^([^:]+):\s*(.*)$/)
            cursor++
            if (m) entry[m[1].trim()] = m[2].trim() === '' ? null : scalarOf(m[2].trim())
          }
          list.push(entry)
        } else {
          list.push(scalarOf(item))
        }
      }
      return list
    }

    const map = {}
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const m = lines[cursor].text.match(/^([^:]+):\s*(.*)$/)
      if (!m) {
        cursor++
        continue
      }
      const key = m[1].trim()
      const rest = m[2].trim()
      cursor++

      if (rest !== '') {
        map[key] = scalarOf(rest)
        continue
      }
      const next = lines[cursor]
      if (!next) {
        map[key] = null
      } else if (next.indent > indent) {
        map[key] = parseBlock(next.indent)
      } else if (next.indent === indent && next.text.startsWith('- ')) {
        // Sequence written flush with its key.
        map[key] = parseBlock(indent)
      } else {
        map[key] = null
      }
    }
    return map
  }

  return parseBlock(lines.length ? lines[0].indent : 0)
}

function scalarOf(s) {
  const v = s.replace(/^["'](.*)["']$/, '$1')
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return v
}
