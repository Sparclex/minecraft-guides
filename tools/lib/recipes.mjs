import { log, splitId, titleCase } from './util.mjs'

/**
 * Turns the recipe ids a guide book points at into something a web page can
 * actually draw.
 *
 * Guide books never carry recipe content themselves — a Patchouli crafting
 * page is literally `"recipe": "croptopia:shaped_ajvar"`, and the game looks
 * the rest up at runtime. So the recipe JSON is read back out of the same
 * jars the books came from, its ingredients resolved (including item tags,
 * which expand to every item that matches) and normalised into one shape the
 * renderer understands, whatever mod invented the recipe type.
 */

/** 1.21 renamed these folders to the singular; plenty of mods still ship both. */
const RECIPE_FILE = /^data\/([^/]+)\/recipes?\/(.+)\.json$/
const TAG_FILE = /^data\/([^/]+)\/tags\/items?\/(.+)\.json$/

const COOKING = {
  'minecraft:smelting': 'Smelting',
  'minecraft:blasting': 'Blasting',
  'minecraft:smoking': 'Smoking',
  'minecraft:campfire_cooking': 'Campfire cooking',
}

const TYPE_LABELS = {
  'minecraft:crafting_shaped': 'Crafting',
  'minecraft:crafting_shapeless': 'Crafting (shapeless)',
  'minecraft:stonecutting': 'Stonecutting',
  'minecraft:smithing_transform': 'Smithing',
  'minecraft:smithing_trim': 'Smithing (trim)',
  ...COOKING,
}

/** Ingredient-bearing fields, in the order they should be shown. */
const INPUT_KEYS = [
  'template',
  'base',
  'addition',
  'ingredients',
  'ingredient',
  'inputs',
  'input',
  'input_items',
  'items',
  'item_to_use',
  'activation_item',
  'catalyst',
  'tool',
  'container',
  'top',
  'middle',
  'bottom',
  'left',
  'right',
  'fluid',
  'fluids',
  'input_fluid',
  'input_fluids',
  'entity_to_sacrifice',
]

const UNLABELLED = new Set(['ingredients', 'ingredient', 'inputs', 'input', 'input_items', 'items'])

/** Fields worth printing next to a machine recipe. */
const NOTE_KEYS = {
  cookingtime: (v) => `${round(v / 20)} s`,
  experience: (v) => (v > 0 ? `${round(v)} xp` : null),
  energy: (v) => `${Math.round(v).toLocaleString('en-US')} FE`,
  power: (v) => `${Math.round(v).toLocaleString('en-US')} FE`,
  duration: (v) => `${round(v / 20)} s`,
  processing_time: (v) => `${round(v / 20)} s`,
  processingTime: (v) => `${round(v / 20)} s`,
  tier: (v) => `tier ${v}`,
}

// A slot only ever shows one item at a time, so a handful of alternatives is
// enough to convey "any of these" without inflating every book's JSON.
const MAX_ITEMS_PER_SLOT = 6
const MAX_TAG_EXPANSION = 64

export class RecipeStore {
  constructor({ lang, jars, vanilla, icons, modName }) {
    this.lang = lang
    this.jars = jars
    this.vanilla = vanilla
    this.icons = icons
    this.modName = modName ?? (() => null)

    this.recipeFiles = new Map() // "ns:path" -> { jarPath, entry }
    this.tagFiles = new Map() // "ns:path" -> [{ jarPath, entry }]
    this.recipeJars = new Map() // namespace -> Set(jar path)

    this.normalized = new Map() // recipe id -> Promise<recipe|null>
    this.tags = new Map() // tag id -> Promise<string[]>
    this.byOutput = new Map() // namespace -> Promise<Map(item id -> recipe id)>

    this.stats = { resolved: 0, unresolved: new Map() }
  }

  /** Pass one: remember where every recipe and item tag lives. */
  index(jar, jarPath) {
    for (const name of jar.names) {
      const recipe = RECIPE_FILE.exec(name)
      if (recipe) {
        const id = `${recipe[1]}:${recipe[2]}`
        if (!this.recipeFiles.has(id)) this.recipeFiles.set(id, { jarPath, entry: name })
        if (!this.recipeJars.has(recipe[1])) this.recipeJars.set(recipe[1], new Set())
        this.recipeJars.get(recipe[1]).add(jarPath)
        continue
      }
      const tag = TAG_FILE.exec(name)
      if (tag) {
        // Tags are additive: several mods contribute to `c:ingots/iron`.
        const id = `${tag[1]}:${tag[2]}`
        if (!this.tagFiles.has(id)) this.tagFiles.set(id, [])
        this.tagFiles.get(id).push({ jarPath, entry: name })
      }
    }
  }

  /**
   * Resolve one book reference. Books point at recipes two different ways:
   * Patchouli and Modonomicon name the recipe, GuideME names the *item* it
   * produces, so an unknown id is retried against every recipe output.
   */
  async resolve(rawId) {
    const id = String(rawId ?? '').split('{')[0].trim()
    if (!id) return null
    const direct = await this.byId(id)
    if (direct) return direct

    const viaOutput = await this.recipeIdForOutput(id)
    const recipe = viaOutput ? await this.byId(viaOutput) : null
    if (!recipe) {
      const { ns } = splitId(id)
      this.stats.unresolved.set(ns, (this.stats.unresolved.get(ns) ?? 0) + 1)
    }
    return recipe
  }

  byId(id) {
    if (!this.normalized.has(id)) this.normalized.set(id, this.load(id))
    return this.normalized.get(id)
  }

  async load(id) {
    const json = await this.readRecipe(id)
    if (!json || typeof json !== 'object') return null
    try {
      const recipe = await this.normalize(id, json)
      if (recipe) this.stats.resolved++
      return recipe
    } catch (e) {
      log.warn(`could not read recipe ${id}: ${e.message}`)
      return null
    }
  }

  async readRecipe(id) {
    const hit = this.recipeFiles.get(id)
    if (hit) {
      try {
        return await this.jars.use(hit.jarPath, (jar) => jar.readJson(hit.entry))
      } catch {
        return null
      }
    }
    const { ns, path: rel } = splitId(id)
    if (ns !== 'minecraft' || !this.vanilla?.enabled) return null
    return (
      (await this.vanilla.json(`data/minecraft/recipe/${rel}.json`)) ??
      (await this.vanilla.json(`data/minecraft/recipes/${rel}.json`))
    )
  }

  /* ---------------------------------------------------------------- shapes */

  async normalize(id, json) {
    const type = qualify(String(json.type ?? 'unknown'))
    const recipe = {
      id,
      type,
      label: TYPE_LABELS[type] ?? titleCase(splitId(type).path.split('/').pop()),
      source: this.modName(splitId(type).ns),
      kind: 'generic',
      result: await this.slot(pickResult(json)),
    }

    const note = noteFor(json)
    if (note) recipe.note = note
    if (recipe.source === recipe.label) recipe.source = null

    // A pattern means a grid, whoever defined the type — mod crafting tables
    // (Extended Crafting's 5x5, RFTools' pattern recipes) all reuse the shape.
    if (Array.isArray(json.pattern) && json.key) {
      const pattern = json.pattern.map((row) => String(row ?? ''))
      const width = Math.max(1, ...pattern.map((row) => row.length))
      const grid = []
      for (const row of pattern) {
        for (let x = 0; x < width; x++) {
          const key = row[x] ?? ' '
          grid.push(key === ' ' || !json.key[key] ? null : await this.slot(json.key[key]))
        }
      }
      return { ...recipe, kind: 'shaped', width, height: pattern.length, grid }
    }

    if (type in COOKING) {
      return { ...recipe, kind: 'cooking', inputs: await this.inputs(json) }
    }
    if (type === 'minecraft:stonecutting') {
      return { ...recipe, kind: 'stonecutting', inputs: await this.inputs(json) }
    }
    if (type.startsWith('minecraft:smithing')) {
      return { ...recipe, kind: 'smithing', inputs: await this.inputs(json) }
    }

    const inputs = await this.inputs(json)
    if (!inputs.length && !recipe.result) return null

    const shapeless = /shapeless/.test(type)
    return { ...recipe, kind: shapeless ? 'shapeless' : 'generic', inputs }
  }

  /** Every ingredient a recipe declares, labelled when the field says which. */
  async inputs(json) {
    const out = []
    for (const key of INPUT_KEYS) {
      const value = json[key]
      if (value == null) continue

      // `ingredients` is a list in vanilla, but AE2's inscriber and friends
      // use it as a named map of slots.
      if (!Array.isArray(value) && isPlainObject(value) && !looksLikeIngredient(value)) {
        for (const [slotName, slotValue] of Object.entries(value)) {
          if (!looksLikeIngredient(slotValue)) continue
          const slot = await this.slot(slotValue, titleCase(slotName))
          if (slot) out.push(slot)
        }
        continue
      }

      // Only fields that say something a reader could not guess get a caption;
      // labelling the single input of a furnace "Ingredient" is just noise.
      const label = UNLABELLED.has(key) ? null : titleCase(key)
      if (Array.isArray(value)) {
        for (const entry of value) {
          const slot = await this.slot(entry, label)
          if (slot) out.push(slot)
        }
      } else {
        const slot = await this.slot(value, label)
        if (slot) out.push(slot)
      }
    }
    return out
  }

  /**
   * One ingredient (or result) -> a drawable slot. Handles the plain
   * `{"item": …}` / `{"tag": …}` forms, bare id strings, NeoForge's
   * count-carrying wrappers and lists of alternatives.
   */
  async slot(value, label = null) {
    if (value == null) return null

    const ids = []
    let tag = null
    let count = null
    let fluid = false
    const seen = new Set()

    const visit = (node, depth = 0) => {
      if (node == null || depth > 6) return
      if (typeof node === 'string') {
        const clean = node.split('{')[0].split('[')[0].trim()
        if (!clean) return
        if (clean.startsWith('#')) tag ??= qualify(clean.slice(1))
        else if (!seen.has(clean)) {
          seen.add(clean)
          ids.push(qualify(clean))
        }
        return
      }
      if (Array.isArray(node)) {
        for (const entry of node) visit(entry, depth + 1)
        return
      }
      if (!isPlainObject(node)) return

      if (typeof node.count === 'number') count = node.count
      else if (typeof node.amount === 'number') count = node.amount

      if (node.tag != null) tag ??= qualify(String(node.tag).replace(/^#/, ''))
      if (node.item != null) visit(node.item, depth + 1)
      if (node.fluid != null) {
        fluid = true
        visit(node.fluid, depth + 1)
      }
      // Results use `id` in 1.21; wrappers nest the real ingredient.
      if (node.id != null && node.item == null && node.tag == null && node.fluid == null) {
        visit(node.id, depth + 1)
      }
      if (node.ingredient != null) visit(node.ingredient, depth + 1)
      if (Array.isArray(node.values)) visit(node.values, depth + 1)
    }

    visit(value)

    let total = ids.length
    if (tag) {
      const members = await this.tagItems(tag)
      total += members.length
      for (const member of members) {
        if (!seen.has(member)) {
          seen.add(member)
          ids.push(member)
        }
      }
    }
    if (!ids.length && !tag) return null

    const shown = sortCandidates(ids).slice(0, MAX_ITEMS_PER_SLOT)
    const slot = {
      items: await Promise.all(
        shown.map(async (id) => {
          const item = { id, name: this.lang.itemName(id) }
          const icon = await this.icons.iconFor(id)
          if (icon) item.icon = icon
          return item
        }),
      ),
    }
    if (tag) slot.tag = tag
    if (ids.length > shown.length) slot.more = ids.length - shown.length
    if (count != null && count !== 1) slot.count = count
    if (fluid) slot.fluid = 1
    if (label) slot.label = label
    return slot
  }

  /* ------------------------------------------------------------------ tags */

  tagItems(tagId) {
    if (!this.tags.has(tagId)) this.tags.set(tagId, this.expandTag(tagId, new Set()))
    return this.tags.get(tagId)
  }

  async expandTag(tagId, visiting) {
    if (visiting.has(tagId) || visiting.size > 8) return []
    visiting.add(tagId)

    const values = []
    for (const { jarPath, entry } of this.tagFiles.get(tagId) ?? []) {
      try {
        const json = await this.jars.use(jarPath, (jar) => jar.readJson(entry))
        if (Array.isArray(json?.values)) values.push(...json.values)
      } catch {
        /* a jar that will not open simply contributes nothing */
      }
    }
    const { ns, path: rel } = splitId(tagId)
    if (ns === 'minecraft' && this.vanilla?.enabled) {
      const json =
        (await this.vanilla.json(`data/minecraft/tags/item/${rel}.json`)) ??
        (await this.vanilla.json(`data/minecraft/tags/items/${rel}.json`))
      if (Array.isArray(json?.values)) values.push(...json.values)
    }

    const items = []
    for (const value of values) {
      if (items.length >= MAX_TAG_EXPANSION) break
      const id = typeof value === 'string' ? value : value?.id
      if (typeof id !== 'string') continue
      if (id.startsWith('#')) {
        items.push(...(await this.expandTag(qualify(id.slice(1)), visiting)))
      } else {
        items.push(qualify(id))
      }
    }
    return [...new Set(items)].slice(0, MAX_TAG_EXPANSION)
  }

  /* ---------------------------------------------------------- output index */

  /**
   * GuideME's `<RecipeFor id="ae2:fluix_crystal"/>` names an item, not a
   * recipe. Recipe files usually mirror their output ("ae2:fluix_crystal"),
   * so that is tried first; only when it misses does the namespace get a full
   * output index built for it.
   */
  async recipeIdForOutput(itemId) {
    const { ns } = splitId(itemId)
    if (!this.byOutput.has(ns)) this.byOutput.set(ns, this.buildOutputIndex(ns))
    return (await this.byOutput.get(ns)).get(itemId) ?? null
  }

  async buildOutputIndex(ns) {
    const index = new Map()
    const jarPaths = this.recipeJars.get(ns)
    if (!jarPaths) return index

    const prefix = `data/${ns}/`
    for (const jarPath of jarPaths) {
      try {
        await this.jars.use(jarPath, async (jar) => {
          for (const entry of jar.names) {
            if (!entry.startsWith(prefix)) continue
            const match = RECIPE_FILE.exec(entry)
            if (!match || match[1] !== ns) continue
            const json = await jar.readJson(entry)
            const output = idOf(pickResult(json))
            if (!output) continue
            const recipeId = `${ns}:${match[2]}`
            // Prefer a crafting recipe when several produce the same item —
            // that is what a book showing "how to make X" means.
            const existing = index.get(output)
            if (!existing || /crafting/.test(String(json.type ?? ''))) index.set(output, recipeId)
          }
        })
      } catch {
        /* skip a jar that will not open */
      }
    }
    log.info(`  indexed ${index.size} recipe outputs for ${ns}`)
    return index
  }

  report() {
    const { resolved, unresolved } = this.stats
    log.ok(`${resolved} recipes resolved`)
    const total = [...unresolved.values()].reduce((n, v) => n + v, 0)
    if (total) {
      const worst = [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 5)
      log.warn(`${total} recipe references had no recipe file (${worst.map(([ns, n]) => `${ns} x${n}`).join(', ')})`)
    }
  }
}

/* -------------------------------------------------------------- utilities */

function qualify(id) {
  const s = String(id).trim()
  return s.includes(':') ? s : `minecraft:${s}`
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** Does this look like an ingredient rather than some unrelated config blob? */
function looksLikeIngredient(v) {
  if (typeof v === 'string') return true
  if (Array.isArray(v)) return v.some(looksLikeIngredient)
  if (!isPlainObject(v)) return false
  return ['item', 'tag', 'fluid', 'id', 'ingredient'].some((k) => v[k] != null)
}

function pickResult(json) {
  if (!isPlainObject(json)) return null
  const direct = json.result ?? json.output ?? json.output_item ?? json.result_item
  if (direct != null) return direct
  const list = json.results ?? json.outputs
  return Array.isArray(list) ? list[0] : null
}

function idOf(value) {
  if (typeof value === 'string') return qualify(value.split('{')[0].trim())
  if (!isPlainObject(value)) return null
  const raw = value.item ?? value.id
  if (typeof raw === 'string') return qualify(raw.split('{')[0].trim())
  if (isPlainObject(raw) && typeof raw.id === 'string') return qualify(raw.id)
  return null
}

function noteFor(json) {
  const parts = []
  for (const [key, format] of Object.entries(NOTE_KEYS)) {
    const value = json[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const text = format(value)
    if (text) parts.push(text)
  }
  return parts.length ? parts.join(' · ') : null
}

function round(n) {
  return Math.round(n * 10) / 10
}

/** Vanilla first, then alphabetical — the familiar member of a tag leads. */
function sortCandidates(ids) {
  return [...ids].sort((a, b) => {
    const av = a.startsWith('minecraft:') ? 0 : 1
    const bv = b.startsWith('minecraft:') ? 0 : 1
    return av - bv || a.localeCompare(b)
  })
}
