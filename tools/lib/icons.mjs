import { splitId } from './util.mjs'

/**
 * Item id -> a picture of that item.
 *
 * Minecraft never stores "the icon of an item" anywhere; it stores a model,
 * which points at a parent model, which finally names a texture. Flat items
 * end at `layer0`; block items end at whatever face texture their block model
 * uses, which is the closest a 2D page can get to the rendered cube.
 */
const MAX_PARENTS = 6

/** Face keys worth showing, best first. */
const TEXTURE_KEYS = [
  'layer0',
  'all',
  'texture',
  'side',
  'front',
  'north',
  'up',
  'end',
  'cross',
  'top',
  'still',
  'particle',
]

export class IconResolver {
  /**
   * @param assetIndex  "assets/ns/…" -> jar path, filled during the jar scan
   * @param jars        jar pool for late reads
   * @param vanilla     VanillaAssets (may be disabled)
   * @param emitJar     (assetPath, jarPath) -> public url
   * @param emitFile    (outPath, sourceFile) -> public url
   */
  constructor({ assetIndex, jars, vanilla, emitJar, emitFile }) {
    this.assetIndex = assetIndex
    this.jars = jars
    this.vanilla = vanilla
    this.emitJar = emitJar
    this.emitFile = emitFile
    this.icons = new Map() // item id -> Promise<url|null>
    this.models = new Map() // asset path -> Promise<json|null>
    this.found = 0
    this.missing = new Set()
  }

  /** Public URL for this item's icon, or null when nothing could be resolved. */
  iconFor(id) {
    const clean = String(id ?? '').split('{')[0].split('[')[0].trim()
    if (!clean || clean === 'minecraft:air') return Promise.resolve(null)
    if (!this.icons.has(clean)) this.icons.set(clean, this.resolve(clean))
    return this.icons.get(clean)
  }

  async resolve(id) {
    const { ns, path: name } = splitId(id)
    const candidates = [
      await this.textureFromModel(`assets/${ns}/models/item/${name}.json`),
      await this.textureFromModel(`assets/${ns}/models/block/${name}.json`),
      // Fluids and a few items are modelled in code, but their texture still
      // sits where the naming convention says it should.
      `${ns}:item/${name}`,
      `${ns}:block/${name}`,
      `${ns}:block/${name}_still`,
      `${ns}:fluid/${name}_still`,
    ]

    for (const candidate of candidates) {
      const url = await this.emit(candidate)
      if (url) {
        this.found++
        return url
      }
    }
    this.missing.add(id)
    return null
  }

  /** Walk a model's parent chain and pick the most representative texture. */
  async textureFromModel(assetPath) {
    let model = await this.readJson(assetPath)
    if (!model) return null

    const textures = {}
    for (let depth = 0; model && depth < MAX_PARENTS; depth++) {
      // A child's own textures win over the ones it inherits.
      for (const [key, value] of Object.entries(model.textures ?? {})) {
        if (textures[key] == null && typeof value === 'string') textures[key] = value
      }
      if (!model.parent) break
      const { ns, path: rel } = splitId(String(model.parent))
      model = await this.readJson(`assets/${ns}/models/${rel}.json`)
    }

    for (const key of TEXTURE_KEYS) {
      const resolved = deref(textures, key)
      if (resolved) return resolved
    }
    // Unusual models (multi-layer machines, custom keys) still have *a* face.
    for (const key of Object.keys(textures)) {
      const resolved = deref(textures, key)
      if (resolved) return resolved
    }
    return null
  }

  /** `ns:item/foo` -> published image url, extracting the file on the way. */
  async emit(resloc) {
    if (!resloc) return null
    const { ns, path: rel } = splitId(resloc)
    const assetPath = `assets/${ns}/textures/${rel}.png`

    const jarPath = this.assetIndex.get(assetPath)
    if (jarPath) return this.emitJar(assetPath, jarPath)

    if (ns === 'minecraft' && this.vanilla?.enabled) {
      // Fetching it also proves it exists, so the page never points at a
      // texture that was never published.
      const buf = await this.vanilla.read(assetPath)
      if (buf) return this.emitFile(`${ns}/textures/${rel}.png`, this.vanilla.cachePath(assetPath))
    }
    return null
  }

  async readJson(assetPath) {
    if (!this.models.has(assetPath)) this.models.set(assetPath, this.readJsonUncached(assetPath))
    return this.models.get(assetPath)
  }

  async readJsonUncached(assetPath) {
    const jarPath = this.assetIndex.get(assetPath)
    if (jarPath) {
      try {
        return await this.jars.use(jarPath, (jar) => jar.readJson(assetPath))
      } catch {
        return null
      }
    }
    if (assetPath.startsWith('assets/minecraft/') && this.vanilla?.enabled) {
      return this.vanilla.json(assetPath)
    }
    return null
  }
}

/** Model textures may point at each other: `"side": "#all"`. */
function deref(textures, key, depth = 0) {
  const value = textures[key]
  if (!value || depth > 4) return null
  if (!value.startsWith('#')) return value
  return deref(textures, value.slice(1), depth + 1)
}
