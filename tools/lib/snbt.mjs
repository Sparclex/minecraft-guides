/**
 * Parser for SNBT (stringified NBT), the format FTB Quests writes its quest
 * book in. It is JSON-like but allows unquoted keys, omits commas, and suffixes
 * numbers with a type letter (`1.0d`, `16L`, `0b`).
 */
export function parseSNBT(src) {
  const text = String(src ?? '')
  let i = 0

  function error(msg) {
    const line = text.slice(0, i).split('\n').length
    throw new Error(`SNBT parse error at line ${line}: ${msg}`)
  }

  function skip() {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] === '#' || (text[i] === '/' && text[i + 1] === '/')) {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      return
    }
  }

  function parseValue() {
    skip()
    const c = text[i]
    if (c === '{') return parseCompound()
    if (c === '[') return parseList()
    if (c === '"' || c === "'") return parseQuoted()
    return parseBare()
  }

  function parseCompound() {
    i++ // {
    const out = {}
    for (;;) {
      skip()
      if (text[i] === '}') {
        i++
        return out
      }
      if (i >= text.length) error('unterminated compound')
      const key = text[i] === '"' || text[i] === "'" ? parseQuoted() : parseBareKey()
      skip()
      if (text[i] !== ':') error(`expected ':' after key "${key}"`)
      i++
      out[key] = parseValue()
      skip()
      if (text[i] === ',') i++
    }
  }

  function parseList() {
    i++ // [
    skip()
    // Typed arrays: [I; 1, 2, 3]
    if (/^[BILbil];/.test(text.slice(i, i + 2))) i += 2
    const out = []
    for (;;) {
      skip()
      if (text[i] === ']') {
        i++
        return out
      }
      if (i >= text.length) error('unterminated list')
      out.push(parseValue())
      skip()
      if (text[i] === ',') i++
    }
  }

  function parseQuoted() {
    const quote = text[i++]
    let out = ''
    while (i < text.length) {
      const c = text[i++]
      if (c === '\\') {
        const esc = text[i++]
        if (esc === 'n') out += '\n'
        else if (esc === 't') out += '\t'
        else if (esc === 'r') out += '\r'
        else if (esc === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16))
          i += 4
        } else out += esc
        continue
      }
      if (c === quote) return out
      out += c
    }
    error('unterminated string')
  }

  function parseBareKey() {
    const start = i
    while (i < text.length && /[A-Za-z0-9_.+\-]/.test(text[i])) i++
    if (i === start) error('expected key')
    return text.slice(start, i)
  }

  function parseBare() {
    const start = i
    while (i < text.length && !/[\s,:{}[\]]/.test(text[i])) i++
    const raw = text.slice(start, i)
    if (raw === 'true') return true
    if (raw === 'false') return false
    const num = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[bBsSlLfFdD]?$/)
    if (num) return Number(num[1])
    return raw
  }

  const value = parseValue()
  skip()
  return value
}

/**
 * Minecraft `&`/`§` colour codes -> the same inline-run model the rest of the
 * pipeline uses.
 */
const CODE_COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa',
  4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
  8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
}

export function legacyTextToInline(raw) {
  const text = String(raw ?? '')
  const nodes = []
  let style = { b: 0, i: 0, u: 0, s: 0, c: null }
  let buffer = ''

  const flush = () => {
    if (!buffer) return
    const node = { t: 'text', v: buffer }
    for (const k of ['b', 'i', 'u', 's']) if (style[k]) node[k] = 1
    if (style.c) node.c = style.c
    nodes.push(node)
    buffer = ''
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    // FTB escapes a literal ampersand as `\&` so it isn't read as a colour code.
    if (c === '\\' && (text[i + 1] === '&' || text[i + 1] === '\\')) {
      buffer += text[++i]
      continue
    }
    if ((c === '&' || c === '§') && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase()
      if (code in CODE_COLORS) {
        flush()
        style = { b: 0, i: 0, u: 0, s: 0, c: CODE_COLORS[code] }
        i++
        continue
      }
      if ('lmnok'.includes(code)) {
        flush()
        if (code === 'l') style.b = 1
        else if (code === 'm') style.s = 1
        else if (code === 'n') style.u = 1
        else if (code === 'o') style.i = 1
        i++
        continue
      }
      if (code === 'r') {
        flush()
        style = { b: 0, i: 0, u: 0, s: 0, c: null }
        i++
        continue
      }
    }
    if (c === '\n') {
      flush()
      nodes.push({ t: 'br' })
      continue
    }
    buffer += c
  }
  flush()
  return nodes
}
