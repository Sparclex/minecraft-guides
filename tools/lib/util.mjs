import fs from 'node:fs'
import path from 'node:path'

const t0 = Date.now()
const pad = (n) => String(n).padStart(2, '0')

function stamp() {
  const s = (Date.now() - t0) / 1000
  return `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`
}

export const log = {
  info: (...a) => console.log(`\x1b[2m[${stamp()}]\x1b[0m`, ...a),
  step: (...a) => console.log(`\x1b[2m[${stamp()}]\x1b[0m \x1b[36m▸\x1b[0m`, ...a),
  ok: (...a) => console.log(`\x1b[2m[${stamp()}]\x1b[0m \x1b[32m✓\x1b[0m`, ...a),
  warn: (...a) => console.log(`\x1b[2m[${stamp()}]\x1b[0m \x1b[33m!\x1b[0m`, ...a),
  err: (...a) => console.error(`\x1b[2m[${stamp()}]\x1b[0m \x1b[31m✗\x1b[0m`, ...a),
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
  return p
}

export function writeJson(file, data, pretty = false) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data))
}

/** Run `worker` over `items` with at most `limit` in flight. */
export async function pool(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

/** fetch with retries and exponential backoff. */
export async function fetchRetry(url, { retries = 4, asBuffer = false, headers } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text()
    } catch (e) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }
  throw lastErr
}

/** "minecraft:iron_ingot" -> { ns, path }; bare "iron_ingot" -> minecraft. */
export function splitId(id) {
  const s = String(id ?? '')
  const i = s.indexOf(':')
  return i < 0 ? { ns: 'minecraft', path: s } : { ns: s.slice(0, i), path: s.slice(i + 1) }
}

/** Fallback human name for an id path: "energy_cell" -> "Energy Cell". */
export function titleCase(s) {
  return String(s)
    .replace(/[_\-./]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
