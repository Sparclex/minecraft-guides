import { splitId, titleCase } from './util.mjs'

/**
 * Registry of every mod's en_us translations.
 *
 * Guide books reference their prose two different ways: Modonomicon (and
 * Patchouli books with `"i18n": true`) store lang keys, while other Patchouli
 * books store literal English. Looking a string up and falling back to itself
 * handles both without the extractor needing to care which it is.
 */
export class LangRegistry {
  constructor() {
    /** @type {Map<string, string>} */
    this.entries = new Map()
    /** @type {Map<string, string>} id -> display name */
    this.names = new Map()
  }

  /** Merge one namespace's en_us.json. */
  add(namespace, json) {
    if (!json) return
    for (const [key, value] of Object.entries(json)) {
      if (typeof value !== 'string') continue
      if (!this.entries.has(key)) this.entries.set(key, value)

      const m = key.match(/^(item|block|fluid|entity|biome|effect|enchantment)\.([^.]+)\.(.+)$/)
      if (m && m[2] === namespace) {
        const id = `${m[2]}:${m[3].replace(/\./g, '/')}`
        if (!this.names.has(id)) this.names.set(id, value)
        // Vanilla nests some paths; also index the un-rewritten form.
        const flat = `${m[2]}:${m[3]}`
        if (!this.names.has(flat)) this.names.set(flat, value)
      }
    }
  }

  /** Resolve a lang key, or return the input unchanged when it isn't one. */
  get(keyOrLiteral) {
    if (typeof keyOrLiteral !== 'string') return ''
    return this.entries.get(keyOrLiteral) ?? keyOrLiteral
  }

  has(key) {
    return this.entries.has(key)
  }

  /** Best-effort display name for an item/block id. */
  itemName(id) {
    if (!id) return ''
    const clean = String(id).replace(/^#/, '')
    const direct = this.names.get(clean)
    if (direct) return direct
    const { ns, path } = splitId(clean)
    for (const kind of ['item', 'block', 'fluid', 'entity']) {
      const key = `${kind}.${ns}.${path.replace(/\//g, '.')}`
      const hit = this.entries.get(key)
      if (hit) return hit
    }
    return titleCase(path.split('/').pop())
  }
}

/** Read every `assets/<ns>/lang/en_us.json` inside a jar into the registry. */
export async function indexJarLang(jar, registry) {
  for (const name of jar.names) {
    const m = name.match(/^assets\/([^/]+)\/lang\/en_us\.json$/)
    if (!m) continue
    const json = await jar.readJson(name)
    registry.add(m[1], json)
  }
}
