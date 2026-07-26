#!/usr/bin/env node
/**
 * Regenerates the website's content from the modpack's actual sources.
 *
 *   node tools/generate.mjs                    # download jars, rebuild everything
 *   node tools/generate.mjs --mods-dir <path>  # read an installed instance instead
 *   node tools/generate.mjs --version 1.0.0    # pin a specific pack release
 *   node tools/generate.mjs --skip-quests      # skip the GitHub round-trip
 *
 * Nothing here needs a CurseForge API key: the modlist comes from the
 * FTB-hosted CurseForge mirror and jars come off the public CDN.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { log, ensureDir, writeJson, pool, fetchRetry, splitId } from './lib/util.mjs'
import { resolveModlist, ensureJars, jarsFromDir, openJar, readModMeta } from './lib/jars.mjs'
import { LangRegistry, indexJarLang } from './lib/lang.mjs'
import { plainText } from './lib/model.mjs'

import * as patchouli from './extract/patchouli.mjs'
import * as modonomicon from './extract/modonomicon.mjs'
import * as guideme from './extract/guideme.mjs'
import * as ftbquests from './extract/ftbquests.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  projectId: 1298400, // All the Mods 10 Lite
  repo: 'AllTheMods/ATM-10-L',
  ref: 'main',
  cacheDir: path.join(ROOT, '.cache', 'jars'),
  outDir: path.join(ROOT, 'public', 'data'),
}

const COLLECTORS = [patchouli, modonomicon, guideme]

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  log.step('resolving modpack')

  let pack = null
  let mods = []

  if (opts.modsDir) {
    mods = jarsFromDir(opts.modsDir)
    pack = {
      name: 'Local instance',
      version: path.basename(opts.modsDir),
      minecraft: null,
      website: null,
      source: opts.modsDir,
    }
  } else {
    const resolved = await resolveModlist({ projectId: opts.projectId, versionId: opts.version })
    pack = resolved.pack
    log.ok(`${pack.name} ${pack.version} — Minecraft ${pack.minecraft}, ${resolved.mods.length} mods`)
    mods = await ensureJars(resolved.mods, opts.cacheDir, { concurrency: opts.concurrency })
  }

  // ---------------------------------------------------------------- pass 1
  log.step(`scanning ${mods.length} jars`)
  const lang = new LangRegistry()
  const sources = []
  const assetIndex = new Map() // "assets/ns/path" -> jar file path
  const modRecords = []

  for (const mod of mods) {
    let jar
    try {
      jar = await openJar(mod.path)
    } catch (e) {
      log.warn(`cannot open ${mod.file}: ${e.message}`)
      continue
    }

    try {
      const meta = await readModMeta(jar, mod.file)
      await indexJarLang(jar, lang)

      for (const name of jar.names) {
        if (/^assets\/[^/]+\/textures\/.+\.(png|jpg)$/.test(name)) assetIndex.set(name, mod.path)
      }

      const hits = []
      for (const collector of COLLECTORS) hits.push(...collector.collect(jar))

      for (const hit of hits) {
        const record = { ...hit, modId: meta.id, jarFile: mod.file }
        if (hit.kind === 'binary') {
          record.jarPath = mod.path
        } else if (hit.path.endsWith('.json')) {
          record.json = await jar.readJson(hit.path)
        } else {
          record.text = await jar.readText(hit.path)
        }
        sources.push(record)
      }

      modRecords.push({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        authors: meta.authors,
        file: mod.file,
        curseforge: mod.curseforge ?? null,
        guideCount: hits.length,
      })
    } finally {
      await jar.close()
    }
  }

  log.ok(`indexed ${lang.entries.size} translation keys, ${lang.names.size} item names`)
  log.ok(`found ${sources.length} guide files across ${new Set(sources.map((s) => s.modId)).size} mods`)

  // ---------------------------------------------------------------- images
  const images = new ImageStore({
    assetIndex,
    repo: opts.repo,
    ref: opts.ref,
    outDir: opts.outDir,
    cacheDir: path.dirname(opts.cacheDir),
  })

  // Namespaces usually match mod ids, but not always (`ae2` vs
  // `appliedenergistics2`), so fall back to matching the jar's own namespaces.
  const namespaceOwners = new Map()
  for (const record of modRecords) namespaceOwners.set(record.id, record.name)
  for (const src of sources) {
    if (src.ns && !namespaceOwners.has(src.ns)) {
      namespaceOwners.set(src.ns, modRecords.find((m) => m.id === src.modId)?.name ?? null)
    }
  }
  for (const src of sources) {
    const guideNs = src.guide?.split(':')[0]
    if (guideNs && !namespaceOwners.get(guideNs)) {
      namespaceOwners.set(guideNs, modRecords.find((m) => m.id === src.modId)?.name ?? null)
    }
  }

  const ctx = {
    lang,
    modName: (id) => namespaceOwners.get(id) ?? null,
    image: (resloc) => images.request(resloc),
    emitAsset: (asset) => images.requestJarPath(asset.path, asset.jarPath ?? asset.modPath),
  }

  // ---------------------------------------------------------------- build
  log.step('building books')
  const books = []

  for (const engine of COLLECTORS) {
    const mine = sources.filter((s) => s.engine === engine.ENGINE)
    if (!mine.length) continue
    const built = engine.build(mine, ctx)
    for (const book of built) {
      log.info(`  ${engine.LABEL.padEnd(12)} ${book.name} — ${book.entries.length} entries`)
    }
    books.push(...built)
    engine.warnUnsupported?.(built)
  }

  if (!opts.skipQuests && !opts.modsDir) {
    log.step('building quest book from GitHub')
    try {
      const quests = await ftbquests.build({ repo: opts.repo, ref: opts.ref }, ctx)
      if (quests) {
        log.info(`  ${ftbquests.LABEL.padEnd(12)} ${quests.name} — ${quests.entries.length} chapters`)
        books.unshift(quests)
      }
    } catch (e) {
      log.warn(`quest book skipped: ${e.message}`)
    }
  }

  if (!books.length) throw new Error('no guide books were found — nothing to write')

  // ---------------------------------------------------------------- assets
  log.step('extracting referenced images')
  const written = await images.flush(opts.concurrency)
  log.ok(`${written} images written`)

  // ---------------------------------------------------------------- output
  log.step('writing site data')
  const modsById = new Map(modRecords.map((m) => [m.id, m]))
  const nameOfMod = (id) => modsById.get(id)?.name ?? id

  for (const book of books) {
    book.modNames = book.modIds.map(nameOfMod).sort()
    book.contributors = [...new Set(book.entries.map((e) => e.sourceMod))]
      .filter(Boolean)
      .map((id) => ({ id, name: nameOfMod(id), entries: book.entries.filter((e) => e.sourceMod === id).length }))
      .sort((a, b) => b.entries - a.entries)
  }
  books.sort((a, b) => b.entries.length - a.entries.length)

  const booksDir = path.join(opts.outDir, 'books')
  fs.rmSync(booksDir, { recursive: true, force: true })
  ensureDir(booksDir)

  const search = []
  for (const book of books) {
    writeJson(path.join(booksDir, `${book.id}.json`), book, opts.pretty)
    for (const entry of book.entries) {
      search.push({
        b: book.id,
        e: entry.id,
        t: entry.name,
        c: book.categories.find((c) => c.id === entry.category)?.name ?? '',
        x: (entry.text ?? '').slice(0, 1500),
      })
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    generator: 'tools/generate.mjs',
    pack: {
      ...pack,
      projectId: opts.modsDir ? null : opts.projectId,
      repo: opts.repo,
    },
    totals: {
      mods: modRecords.length,
      modsWithGuides: new Set(books.flatMap((b) => b.contributors.map((c) => c.id))).size,
      books: books.length,
      categories: books.reduce((n, b) => n + b.categories.length, 0),
      entries: books.reduce((n, b) => n + b.entries.length, 0),
      pages: books.reduce((n, b) => n + b.entries.reduce((m, e) => m + e.pages.length, 0), 0),
      images: written,
    },
    engines: [...new Set(books.map((b) => b.engine))].map((id) => ({
      id,
      label: books.find((b) => b.engine === id).engineLabel,
      books: books.filter((b) => b.engine === id).length,
      entries: books.filter((b) => b.engine === id).reduce((n, b) => n + b.entries.length, 0),
    })),
    mods: modRecords.sort((a, b) => a.name.localeCompare(b.name)),
    books: books.map((book) => ({
      id: book.id,
      engine: book.engine,
      engineLabel: book.engineLabel,
      namespace: book.namespace,
      name: book.name,
      subtitle: book.subtitle,
      summary: plainText(book.landing).slice(0, 400).trim() || null,
      modIds: book.modIds,
      modNames: book.modNames,
      contributors: book.contributors,
      entryCount: book.entries.length,
      pageCount: book.entries.reduce((n, e) => n + e.pages.length, 0),
      categories: book.categories.map((c) => ({
        id: c.id,
        name: c.name,
        entryCount: book.entries.filter((e) => e.category === c.id).length,
      })),
    })),
  }

  writeJson(path.join(opts.outDir, 'index.json'), index, true)
  writeJson(path.join(opts.outDir, 'search.json'), search, opts.pretty)

  log.ok(
    `done — ${index.totals.books} books, ${index.totals.entries} entries, ` +
      `${index.totals.pages} pages from ${index.totals.modsWithGuides}/${index.totals.mods} mods`,
  )
  log.info(`output: ${path.relative(ROOT, opts.outDir)}`)
}

/**
 * Collects image requests during the build, then extracts the referenced
 * files once — from a mod jar when possible, otherwise from the pack repo.
 */
class ImageStore {
  constructor({ assetIndex, repo, ref, outDir, cacheDir }) {
    this.assetIndex = assetIndex
    this.repo = repo
    this.ref = ref
    this.dir = path.join(outDir, 'img')
    // Repo downloads are cached so a rebuild does not re-fetch them, while the
    // published folder is rewritten from scratch each run.
    this.cache = path.join(cacheDir, 'repo-images')
    this.fromJars = new Map() // outputRelPath -> { jarPath, entry }
    this.fromRepo = new Map() // outputRelPath -> repo path
    this.missing = new Set()
  }

  /** `ns:textures/gui/foo.png` -> public URL, registering the extraction. */
  request(resloc) {
    if (!resloc) return null
    const { ns, path: rel } = splitId(String(resloc).trim())
    const assetPath = `assets/${ns}/${rel}`
    const out = `${ns}/${rel}`

    const jarPath = this.assetIndex.get(assetPath)
    if (jarPath) {
      this.fromJars.set(out, { jarPath, entry: assetPath })
      return `data/img/${out}`
    }
    // Pack-supplied art (quest pictures) lives in the modpack repo.
    this.fromRepo.set(out, `kubejs/assets/${ns}/${rel}`)
    return `data/img/${out}`
  }

  /** Direct jar entry (GuideME ships images beside its markdown). */
  requestJarPath(entry, jarPath) {
    if (!entry || !jarPath) return null
    const out = entry.replace(/^assets\//, '')
    this.fromJars.set(out, { jarPath, entry })
    return `data/img/${out}`
  }

  async flush(concurrency = 8) {
    fs.rmSync(this.dir, { recursive: true, force: true })
    ensureDir(this.dir)
    ensureDir(this.cache)
    let count = 0

    const write = (out, buf) => {
      const dest = path.join(this.dir, out)
      ensureDir(path.dirname(dest))
      fs.writeFileSync(dest, buf)
      count++
    }

    // Group by jar so each archive is opened once.
    const byJar = new Map()
    for (const [out, { jarPath, entry }] of this.fromJars) {
      if (!byJar.has(jarPath)) byJar.set(jarPath, [])
      byJar.get(jarPath).push({ out, entry })
    }

    for (const [jarPath, wanted] of byJar) {
      let jar
      try {
        jar = await openJar(jarPath)
      } catch {
        continue
      }
      try {
        for (const { out, entry } of wanted) {
          const buf = await jar.read(entry)
          if (buf) write(out, buf)
          else this.missing.add(entry)
        }
      } finally {
        await jar.close()
      }
    }

    await pool([...this.fromRepo], concurrency, async ([out, repoPath]) => {
      const cached = path.join(this.cache, out)
      if (fs.existsSync(cached)) {
        write(out, fs.readFileSync(cached))
        return
      }
      try {
        const buf = await fetchRetry(
          `https://raw.githubusercontent.com/${this.repo}/${this.ref}/${repoPath}`,
          { asBuffer: true, retries: 1 },
        )
        ensureDir(path.dirname(cached))
        fs.writeFileSync(cached, buf)
        write(out, buf)
      } catch {
        this.missing.add(repoPath)
      }
    })

    if (this.missing.size) {
      log.warn(`${this.missing.size} referenced images could not be located:`)
      for (const ref of [...this.missing].slice(0, 5)) log.info(`    ${ref}`)
    }
    return count
  }
}

function parseArgs(argv) {
  const opts = {
    projectId: DEFAULTS.projectId,
    version: null,
    repo: DEFAULTS.repo,
    ref: DEFAULTS.ref,
    cacheDir: DEFAULTS.cacheDir,
    outDir: DEFAULTS.outDir,
    modsDir: null,
    concurrency: 10,
    pretty: false,
    skipQuests: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--mods-dir': opts.modsDir = path.resolve(next()); break
      case '--project': opts.projectId = Number(next()); break
      case '--version': opts.version = next(); break
      case '--repo': opts.repo = next(); break
      case '--ref': opts.ref = next(); break
      case '--cache': opts.cacheDir = path.resolve(next()); break
      case '--out': opts.outDir = path.resolve(next()); break
      case '--concurrency': opts.concurrency = Number(next()); break
      case '--pretty': opts.pretty = true; break
      case '--skip-quests': opts.skipQuests = true; break
      case '--help':
      case '-h':
        console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''))
        process.exit(0)
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }
  return opts
}

main().catch((e) => {
  log.err(e.stack ?? e.message)
  process.exit(1)
})
