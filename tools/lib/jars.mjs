import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { open as openZip } from 'yauzl-promise'
import { log, ensureDir, pool, fetchRetry } from './util.mjs'

const MODPACKS_API = 'https://api.modpacks.ch/public/curseforge'
const CDN = 'https://mediafilez.forgecdn.net/files'

/**
 * Resolve the modpack's file list (mod jars + versions) straight from the
 * FTB-hosted CurseForge mirror, which needs no API key.
 */
export async function resolveModlist({ projectId, versionId }) {
  const pack = JSON.parse(await fetchRetry(`${MODPACKS_API}/${projectId}`))
  if (pack.status === 'error') throw new Error(`Unknown CurseForge project ${projectId}`)

  const versions = [...(pack.versions ?? [])].sort((a, b) => b.id - a.id)
  if (!versions.length) throw new Error(`No published versions for ${pack.name}`)
  const chosen = versionId
    ? versions.find((v) => String(v.id) === String(versionId) || v.name === versionId)
    : versions[0]
  if (!chosen) throw new Error(`Version "${versionId}" not found for ${pack.name}`)

  const detail = JSON.parse(await fetchRetry(`${MODPACKS_API}/${projectId}/${chosen.id}`))
  const mods = (detail.files ?? [])
    .filter((f) => f.type === 'mod' && f.name.endsWith('.jar'))
    .map((f) => ({
      file: f.name,
      size: f.size,
      sha1: f.sha1 || null,
      curseforge: f.curseforge ?? null,
      url: f.curseforge ? cdnUrl(f.curseforge.file, f.name) : f.url || null,
    }))

  return {
    pack: {
      id: pack.id,
      name: pack.name,
      synopsis: pack.synopsis,
      version: chosen.name,
      versionId: chosen.id,
      minecraft: (detail.targets ?? []).find((t) => t.name === 'minecraft')?.version ?? null,
      loader:
        (detail.targets ?? []).find((t) => t.type === 'modloader')?.name ??
        (detail.targets ?? []).find((t) => t.name !== 'minecraft')?.name ??
        null,
      website: (pack.links ?? []).find((l) => l.type === 'website')?.link ?? null,
      source: (pack.links ?? []).find((l) => l.type === 'source')?.link ?? null,
    },
    mods,
  }
}

/** CurseForge splits file ids into /<first digits>/<last 3 digits>/<filename>. */
function cdnUrl(fileId, filename) {
  const id = String(fileId)
  const a = Number(id.slice(0, -3))
  const b = Number(id.slice(-3))
  // `+` is legal in a jar name but must not survive into the URL path unescaped.
  return `${CDN}/${a}/${b}/${filename.replace(/\+/g, '%2B')}`
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

/**
 * Ensure every mod jar is on disk. Returns [{ file, path }].
 * Already-cached jars are re-used (and re-verified when a hash is known).
 */
export async function ensureJars(mods, cacheDir, { concurrency = 10 } = {}) {
  ensureDir(cacheDir)
  let downloaded = 0
  let cached = 0

  const results = await pool(mods, concurrency, async (mod) => {
    const dest = path.join(cacheDir, mod.file)
    if (fs.existsSync(dest)) {
      const buf = fs.readFileSync(dest)
      if (!mod.sha1 || sha1(buf) === mod.sha1) {
        cached++
        return { ...mod, path: dest }
      }
      log.warn(`checksum mismatch, re-downloading ${mod.file}`)
    }
    if (!mod.url) {
      log.warn(`no download URL for ${mod.file} — skipped`)
      return null
    }
    const buf = await fetchRetry(mod.url, { asBuffer: true })
    if (mod.sha1 && sha1(buf) !== mod.sha1) {
      log.warn(`checksum mismatch after download for ${mod.file} — using it anyway`)
    }
    fs.writeFileSync(dest, buf)
    downloaded++
    return { ...mod, path: dest }
  })

  log.ok(`jars ready: ${cached} cached, ${downloaded} downloaded`)
  return results.filter(Boolean)
}

/** Use an existing Minecraft instance's mods folder instead of downloading. */
export function jarsFromDir(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jar'))
  log.ok(`using ${files.length} jars from ${dir}`)
  return files.map((f) => ({ file: f, path: path.join(dir, f), sha1: null, curseforge: null }))
}

/**
 * Open a jar and expose its entries. Call `close()` when done.
 * Nested jaded jars (jar-in-jar) are not traversed — no guide book ships that way.
 */
export async function openJar(jarPath) {
  const zip = await openZip(jarPath)
  const entries = new Map()
  for await (const entry of zip) {
    if (!entry.filename.endsWith('/')) entries.set(entry.filename, entry)
  }

  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    async read(name) {
      const entry = entries.get(name)
      if (!entry) return null
      const stream = await entry.openReadStream()
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      return Buffer.concat(chunks)
    },
    async readText(name) {
      const buf = await this.read(name)
      return buf ? buf.toString('utf8') : null
    },
    async readJson(name) {
      const text = await this.readText(name)
      if (text == null) return null
      try {
        // A few mods ship books with trailing commas or //-comments.
        return JSON.parse(stripJsonc(text))
      } catch (e) {
        log.warn(`bad JSON in ${path.basename(jarPath)}!${name}: ${e.message}`)
        return null
      }
    },
    close: () => zip.close(),
  }
}

function stripJsonc(text) {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Read a jar's mod metadata (id, display name, version) from neoforge.mods.toml. */
export async function readModMeta(jar, fallbackFile) {
  const tomlName =
    ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml'].find((n) => jar.has(n)) ?? null
  if (tomlName) {
    const toml = await jar.readText(tomlName)
    const meta = parseModsToml(toml)
    if (meta) return meta
  }
  const base = fallbackFile.replace(/\.jar$/, '')
  return { id: base.toLowerCase(), name: base, version: null, description: null, authors: null }
}

/**
 * Minimal reader for the one table we need out of mods.toml — enough to pull
 * modId/displayName/version/description without a TOML dependency.
 */
function parseModsToml(toml) {
  if (!toml) return null
  const start = toml.indexOf('[[mods]]')
  if (start < 0) return null
  const rest = toml.slice(start + '[[mods]]'.length)
  const end = rest.search(/^\s*\[\[/m)
  const block = end < 0 ? rest : rest.slice(0, end)

  // A quoted value ends at its *own* quote character — "Iron's Spells 'n
  // Spellbooks" must not stop at the first apostrophe.
  const scalar = (key) => {
    const triple = block.match(new RegExp(`^\\s*${key}\\s*=\\s*'''([\\s\\S]*?)'''`, 'm'))
    if (triple) return triple[1].trim()
    const double = block.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\n]*)"`, 'm'))
    if (double) return double[1].trim()
    const single = block.match(new RegExp(`^\\s*${key}\\s*=\\s*'([^'\\n]*)'`, 'm'))
    return single ? single[1].trim() : null
  }

  const id = scalar('modId')
  if (!id) return null
  return {
    id,
    name: scalar('displayName') || id,
    version: scalar('version'),
    description: scalar('description'),
    authors: scalar('authors'),
  }
}
