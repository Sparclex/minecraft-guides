import fs from 'node:fs'
import path from 'node:path'

import { log, ensureDir, fetchRetry } from './util.mjs'

/**
 * Vanilla Minecraft's own data and assets.
 *
 * Mod recipes reference vanilla items and tags constantly (`minecraft:stick`,
 * `#minecraft:planks`), and none of that ships inside a mod jar. Rather than
 * asking anyone to supply a game install, the missing files are read from
 * misode/mcmeta, which publishes the unpacked vanilla jar per version — no
 * account or API key involved, and everything is cached on first use.
 *
 * The whole thing is best-effort: if the version has no branch there, or the
 * network is unavailable, recipes simply fall back to naming their vanilla
 * ingredients instead of picturing them.
 */
const REPO = 'https://raw.githubusercontent.com/misode/mcmeta'

export class VanillaAssets {
  constructor({ version, cacheDir, enabled = true }) {
    this.version = version ?? null
    this.dir = cacheDir
    this.enabled = Boolean(enabled && version)
    this.memo = new Map()
    this.hits = 0
    this.misses = 0
  }

  /** Confirm the version actually exists upstream before leaning on it. */
  async probe() {
    if (!this.enabled) return false
    const ok = await this.text('version.json')
    if (!ok) {
      log.warn(`no vanilla assets published for Minecraft ${this.version} — vanilla items stay text-only`)
      this.enabled = false
    }
    return this.enabled
  }

  /**
   * mcmeta splits the jar across two branches: everything under `data/` on
   * `<version>-data`, everything under `assets/` on `<version>-assets`, and
   * the version stamp on `<version>-summary`.
   */
  urlFor(file) {
    const branch = file.startsWith('data/') ? 'data' : file.startsWith('assets/') ? 'assets' : 'summary'
    return `${REPO}/${this.version}-${branch}/${file}`
  }

  /** Where `read` keeps a downloaded file. */
  cachePath(file) {
    return path.join(this.dir, this.version, file)
  }

  async text(file) {
    const buf = await this.read(file)
    return buf ? buf.toString('utf8') : null
  }

  async json(file) {
    const text = await this.text(file)
    if (text == null) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  /** Cached fetch. A miss is cached too, so a rebuild does not re-ask. */
  async read(file) {
    if (!this.enabled) return null
    if (this.memo.has(file)) return this.memo.get(file)

    const pending = (async () => {
      const cached = this.cachePath(file)
      if (fs.existsSync(`${cached}.missing`)) return null
      if (fs.existsSync(cached)) {
        this.hits++
        return fs.readFileSync(cached)
      }
      try {
        const buf = await fetchRetry(this.urlFor(file), { asBuffer: true, retries: 1 })
        ensureDir(path.dirname(cached))
        fs.writeFileSync(cached, buf)
        this.misses++
        return buf
      } catch {
        ensureDir(path.dirname(cached))
        fs.writeFileSync(`${cached}.missing`, '')
        return null
      }
    })()

    this.memo.set(file, pending)
    return pending
  }

}
