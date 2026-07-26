import { parseSNBT, legacyTextToInline } from '../lib/snbt.mjs'
import { bookId, entryText, plainText } from '../lib/model.mjs'
import { log, fetchRetry, titleCase } from '../lib/util.mjs'

export const ENGINE = 'ftbquests'
export const LABEL = 'FTB Quests'

/**
 * The pack's own quest book is the one in-game guide that does not live in a
 * mod jar — it is pack config, so it comes from the modpack's GitHub repo.
 */
export async function build({ repo, ref = 'main', questPath = 'config/ftbquests/quests' }, ctx) {
  const tree = await listRepo(repo, ref)
  const want = tree.filter((p) => p.startsWith(`${questPath}/`) && p.endsWith('.snbt'))
  if (!want.length) {
    log.warn(`no FTB Quests files under ${questPath} in ${repo}`)
    return null
  }

  const raw = new Map()
  await Promise.all(
    want.map(async (p) => {
      const text = await fetchRetry(rawUrl(repo, ref, p))
      try {
        raw.set(p, parseSNBT(text))
      } catch (e) {
        log.warn(`${p}: ${e.message}`)
      }
    }),
  )

  const base = `${questPath}/`
  const at = (rel) => raw.get(base + rel)

  // ---- translations --------------------------------------------------
  const strings = new Map()
  for (const [p, value] of raw) {
    if (!p.includes(`${questPath}/lang/en_us/`)) continue
    for (const [key, v] of Object.entries(value ?? {})) strings.set(key, v)
  }
  const str = (key) => {
    const v = strings.get(key)
    if (v == null) return null
    const joined = Array.isArray(v) ? v.join('\n') : String(v)
    // Quest text stores paragraph breaks double-escaped, so SNBT unescaping
    // leaves a literal backslash-n behind that FTB resolves at display time.
    return joined.replace(/\\n/g, '\n')
  }

  // ---- chapter groups -------------------------------------------------
  const groupOrder = (at('chapter_groups.snbt')?.chapter_groups ?? []).map((g) => String(g.id))
  const groupTitle = (id) => str(`chapter_group.${id}.title`) ?? 'Quests'

  // ---- chapters -------------------------------------------------------
  const chapters = []
  for (const [p, value] of raw) {
    if (!p.startsWith(`${base}chapters/`) || !value?.id) continue
    chapters.push({ file: p.slice(`${base}chapters/`.length, -'.snbt'.length), data: value })
  }

  const categories = []
  const seenGroups = new Set()
  const entries = []

  const orderedChapters = chapters.sort((a, b) => {
    const ga = groupOrder.indexOf(String(a.data.group ?? ''))
    const gb = groupOrder.indexOf(String(b.data.group ?? ''))
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || (a.data.order ?? 0) - (b.data.order ?? 0)
  })

  for (const { file, data } of orderedChapters) {
    const groupId = String(data.group ?? '') || '__ungrouped'
    if (!seenGroups.has(groupId)) {
      seenGroups.add(groupId)
      categories.push({
        id: groupId,
        name: groupId === '__ungrouped' ? 'Other' : plainText(legacyTextToInline(groupTitle(groupId))),
        description: [],
        icon: null,
        sort: groupOrder.indexOf(groupId) < 0 ? 99 : groupOrder.indexOf(groupId),
        parent: null,
      })
    }

    const chapterTitle =
      plainText(legacyTextToInline(str(`chapter.${data.id}.title`) ?? '')) || titleCase(file)

    const pages = []
    const subtitle = str(`chapter.${data.id}.subtitle`)
    if (subtitle) pages.push({ type: 'text', title: null, blocks: [{ k: 'para', text: legacyTextToInline(subtitle) }] })

    for (const quest of data.quests ?? []) {
      const page = questPage(quest, { str, ctx })
      if (page) pages.push(page)
    }

    if (!pages.length) continue

    const entry = {
      id: file,
      category: groupId,
      name: chapterTitle,
      icon: iconOf(data.icon),
      sort: data.order ?? 0,
      questCount: (data.quests ?? []).length,
      pages,
      sourceMod: 'ftbquests',
    }
    entry.text = entryText(entry)
    entries.push(entry)
  }

  if (!entries.length) return null

  return {
    id: bookId(ENGINE, 'atm', 'quests'),
    engine: ENGINE,
    engineLabel: LABEL,
    namespace: 'ftbquests',
    slug: 'quests',
    name: 'Quest Book',
    subtitle: 'The pack’s own guided progression, chapter by chapter',
    landing: [
      {
        k: 'para',
        text: [
          {
            t: 'text',
            v:
              'The quest book is the modpack’s hand-written guide. Each chapter below lists its quests in book order, with the tasks you must complete and the rewards you get.',
          },
        ],
      },
    ],
    modIds: ['ftbquests'],
    categories: categories.filter((c) => entries.some((e) => e.category === c.id)),
    entries,
  }
}

/** One quest becomes one page: title, description, tasks, rewards. */
function questPage(quest, { str, ctx }) {
  const id = String(quest.id ?? '')
  const title =
    str(`quest.${id}.title`) ??
    (quest.tasks?.[0]?.item ? ctx.lang.itemName(itemId(quest.tasks[0].item)) : null)
  const subtitle = str(`quest.${id}.quest_subtitle`)
  const desc = str(`quest.${id}.quest_desc`)

  const blocks = []
  if (subtitle) blocks.push({ k: 'para', text: [{ t: 'text', v: subtitle, i: 1 }] })

  if (desc) {
    for (const chunk of desc.split(/\n{2,}/)) {
      const image = chunk.match(/^\{image:([^\s}]+)/)
      if (image) {
        blocks.push({ k: 'image', src: ctx.image(image[1]), alt: null })
        continue
      }
      // Strip any other FTB inline directives, e.g. {@pagebreak}.
      const clean = chunk.replace(/\{[@a-z][^}]*\}/g, '').trim()
      if (clean) blocks.push({ k: 'para', text: legacyTextToInline(clean) })
    }
  }

  const tasks = (quest.tasks ?? []).map((t) => describeTask(t, ctx)).filter(Boolean)
  if (tasks.length) {
    blocks.push({ k: 'kv', rows: [['Tasks', tasks.flatMap((t, i) => (i ? [{ t: 'br' }, ...t] : t))]] })
  }

  const rewards = (quest.rewards ?? []).map((r) => describeReward(r, ctx)).filter(Boolean)
  if (rewards.length) {
    blocks.push({ k: 'kv', rows: [['Rewards', rewards.flatMap((r, i) => (i ? [{ t: 'br' }, ...r] : r))]] })
  }

  if (!blocks.length && !title) return null

  return {
    type: 'quest',
    title: title ? legacyTextToInline(title) : [{ t: 'text', v: 'Quest', b: 1 }],
    optional: Boolean(quest.optional),
    blocks,
  }
}

function describeTask(task, ctx) {
  const count = task.count ?? task.item?.count ?? 1
  const suffix = count > 1 ? [{ t: 'text', v: ` ×${count}` }] : []

  switch (task.type) {
    case 'item': {
      const id = itemId(task.item)
      const filter = filterLabel(task.item)
      if (filter) return [{ t: 'text', v: `Any ${filter}` }, ...suffix]
      return [{ t: 'item', id, label: ctx.lang.itemName(id) }, ...suffix]
    }
    case 'checkmark':
      return [{ t: 'text', v: task.title ? String(task.title) : 'Manual check-off' }]
    case 'kill': {
      const entity = String(task.entity ?? '')
      return [{ t: 'text', v: `Kill ${ctx.lang.itemName(entity)}` }, ...suffix]
    }
    case 'dimension':
      return [{ t: 'text', v: `Visit ${ctx.lang.itemName(String(task.dimension ?? ''))}` }]
    case 'advancement':
      return [{ t: 'text', v: `Advancement: ${String(task.advancement ?? '')}` }]
    case 'stat':
      return [{ t: 'text', v: `Statistic: ${String(task.stat ?? '')}` }]
    case 'observation':
      return [{ t: 'text', v: `Observe ${String(task.observe_type ?? task.to_observe ?? '')}` }]
    case 'energy':
      return [{ t: 'text', v: `${task.value ?? ''} FE` }]
    case 'fluid': {
      const id = String(task.fluid ?? '')
      return [{ t: 'item', id, label: ctx.lang.itemName(id) }, { t: 'text', v: ` ${task.amount ?? ''} mB` }]
    }
    default:
      return task.type ? [{ t: 'text', v: titleCase(String(task.type)) }] : null
  }
}

function describeReward(reward, ctx) {
  switch (reward.type) {
    case 'item': {
      const id = itemId(reward.item)
      const count = reward.count ?? reward.item?.count ?? 1
      return [
        { t: 'item', id, label: ctx.lang.itemName(id) },
        ...(count > 1 ? [{ t: 'text', v: ` ×${count}` }] : []),
      ]
    }
    case 'xp':
      return [{ t: 'text', v: `${reward.xp ?? 0} XP` }]
    case 'xp_levels':
      return [{ t: 'text', v: `${reward.xp_levels ?? 0} XP levels` }]
    case 'random':
      return [{ t: 'text', v: 'Random loot roll' }]
    case 'choice':
      return [{ t: 'text', v: 'Choice of rewards' }]
    case 'command':
      return [{ t: 'text', v: 'Scripted reward' }]
    default:
      return reward.type ? [{ t: 'text', v: titleCase(String(reward.type)) }] : null
  }
}

function itemId(item) {
  if (!item) return ''
  return String(typeof item === 'string' ? item : (item.id ?? '')).split('{')[0]
}

/** FTB's smart filters stand in for tags, e.g. `item_tag(minecraft:logs)`. */
function filterLabel(item) {
  const raw = item?.components?.['ftbfiltersystem:filter']
  if (!raw) return null
  const m = String(raw).match(/item_tag\(([^)]+)\)/)
  if (!m) return null
  return titleCase(m[1].split(':').pop().replace(/\//g, ' '))
}

function iconOf(icon) {
  if (!icon) return null
  if (typeof icon === 'string') return icon.split('{')[0]
  if (icon.id) return String(icon.id).split('{')[0]
  return null
}

function rawUrl(repo, ref, path) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`
}

async function listRepo(repo, ref) {
  const api = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`
  const headers = { 'User-Agent': 'atm10-lite-guides' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const data = JSON.parse(await fetchRetry(api, { headers }))
  if (!data.tree) throw new Error(`Cannot list ${repo}@${ref}: ${data.message ?? 'unknown error'}`)
  if (data.truncated) log.warn(`GitHub tree for ${repo} was truncated; some quests may be missing`)
  return data.tree.filter((t) => t.type === 'blob').map((t) => t.path)
}
