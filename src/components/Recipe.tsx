import { useState, useSyncExternalStore } from 'react'
import type { Recipe, RecipeItem, RecipeSlot } from '../types'
import { imageUrl } from '../data'

/* ------------------------------------------------------------------ *
 * A slot filled by a tag holds every item that matches it, exactly as
 * the game's own recipe viewer does — so the slot cycles through them
 * on one shared clock rather than one timer per slot.
 * ------------------------------------------------------------------ */

const CYCLE_MS = 1600
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let frame = 0

function subscribe(fn: () => void) {
  listeners.add(fn)
  timer ??= setInterval(() => {
    frame++
    for (const listener of listeners) listener()
  }, CYCLE_MS)
  return () => {
    listeners.delete(fn)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const stillPreferred = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const noSubscribe = () => () => {}

function useFrame(active: boolean) {
  return useSyncExternalStore(active ? subscribe : noSubscribe, () => (active ? frame : 0), () => 0)
}

/* ------------------------------------------------------------------ *
 * Slots
 * ------------------------------------------------------------------ */

const SLOT_BASE =
  'relative grid place-items-center rounded-[3px] border border-ink-300/70 bg-ink-100 ' +
  'shadow-[inset_1px_1px_0_rgba(255,255,255,0.6)] dark:border-ink-700 dark:bg-ink-800 ' +
  'dark:shadow-[inset_1px_1px_0_rgba(255,255,255,0.05)]'

function slotTitle(slot: RecipeSlot, shown: RecipeSlot['items'][number] | undefined) {
  const lines: string[] = []
  if (shown) lines.push(`${shown.name} (${shown.id})`)
  if (slot.count && slot.count !== 1) lines.push(`x${slot.count}`)
  if (slot.tag) {
    const extra = slot.items.length + (slot.more ?? 0)
    lines.push(`Any #${slot.tag}${extra > 1 ? ` — ${extra} items` : ''}`)
  }
  return lines.join('\n')
}

/** The item's texture, or its name when there is nothing to draw. */
function ItemIcon({ item }: { item: RecipeItem }) {
  const [failed, setFailed] = useState(false)

  if (item.icon && !failed) {
    return (
      <img
        src={imageUrl(item.icon)}
        alt={item.name}
        loading="lazy"
        onError={() => setFailed(true)}
        // Animated textures ship as a vertical strip of frames, so the box is
        // filled from the top — that crops it down to the first frame.
        className="h-[80%] w-[80%] object-cover object-top"
        style={{ imageRendering: 'pixelated' }}
      />
    )
  }
  return (
    <span className="line-clamp-3 px-0.5 text-center text-[0.5rem] leading-[1.15] text-ink-500 dark:text-ink-400">
      {item.name}
    </span>
  )
}

export function Slot({ slot, size = 'md' }: { slot: RecipeSlot | null; size?: 'md' | 'lg' }) {
  const cycles = Boolean(slot && slot.items.length > 1 && !stillPreferred())
  const tick = useFrame(cycles)
  const box = size === 'lg' ? 'h-14 w-14' : 'h-11 w-11'

  if (!slot) return <div className={`${SLOT_BASE} ${box} opacity-40`} aria-hidden="true" />

  const item = slot.items.length ? slot.items[tick % slot.items.length] : undefined

  return (
    <div className={`${SLOT_BASE} ${box}`} title={slotTitle(slot, item)}>
      {item ? (
        // Re-keyed per item so a cycling slot re-tries the next texture.
        <ItemIcon key={item.id} item={item} />
      ) : (
        // A tag nothing in the pack contributes to still says what it wants.
        <span className="line-clamp-3 px-0.5 text-center text-[0.5rem] leading-[1.15] text-ink-500 dark:text-ink-400">
          {slot.tag?.split(/[:/]/).pop() ?? '?'}
        </span>
      )}

      {slot.count && slot.count !== 1 && (
        // White on a dark outline, as the game draws stack sizes — the only
        // pairing that stays legible on top of an arbitrary texture.
        <span className="absolute right-0 bottom-0 px-0.5 text-[0.6rem] font-semibold tabular-nums text-white [text-shadow:1px_1px_0_#000,-1px_0_0_#000,0_-1px_0_#000]">
          {slot.count > 999 ? `${Math.round(slot.count / 1000)}k` : slot.count}
        </span>
      )}
      {slot.tag && (
        <span
          className="absolute top-0 left-0 h-1.5 w-1.5 rounded-br-[3px] bg-brand-500/70"
          title={`Any #${slot.tag}`}
        />
      )}
    </div>
  )
}

function LabelledSlot({ slot }: { slot: RecipeSlot }) {
  if (!slot.label) return <Slot slot={slot} />
  return (
    <div className="flex flex-col items-center gap-1">
      <Slot slot={slot} />
      <span className="max-w-16 text-center text-[0.6rem] leading-tight text-ink-500 dark:text-ink-400">
        {slot.label}
      </span>
    </div>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 12" aria-hidden="true" className="h-4 w-7 shrink-0 text-ink-400 dark:text-ink-500">
      <path d="M0 6h19M15 1.5 20.5 6 15 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Recipes
 * ------------------------------------------------------------------ */

function Inputs({ recipe }: { recipe: Recipe }) {
  if (recipe.kind === 'shaped' && recipe.grid) {
    const width = recipe.width ?? 3
    return (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${width}, min-content)` }}>
        {recipe.grid.map((slot, i) => (
          <Slot key={i} slot={slot} />
        ))}
      </div>
    )
  }

  const inputs = recipe.inputs ?? []
  if (!inputs.length) return null

  // Loose ingredient lists stay in rows of three, which keeps a shapeless
  // recipe the same size as the crafting grid beside it.
  const columns = Math.min(3, Math.max(1, inputs.length))
  return (
    <div
      className="grid items-start gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, min-content)` }}
    >
      {inputs.map((slot, i) => (
        <LabelledSlot key={i} slot={slot} />
      ))}
    </div>
  )
}

export function RecipeView({ recipe }: { recipe: Recipe }) {
  const caption = [recipe.label, recipe.source].filter(Boolean).join(' · ')

  return (
    <div className="rounded-lg border border-ink-200 bg-white/60 px-3 py-2.5 dark:border-ink-700 dark:bg-ink-900/50">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[0.7rem]">
        <span className="font-semibold uppercase tracking-widest text-ink-500 dark:text-ink-400">{caption}</span>
        {recipe.note && <span className="text-ink-400 dark:text-ink-500">{recipe.note}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Inputs recipe={recipe} />
        {recipe.result && (
          <>
            <Arrow />
            <div className="flex flex-col items-center gap-1">
              <Slot slot={recipe.result} size="lg" />
              <span className="max-w-24 text-center text-[0.65rem] leading-tight text-ink-600 dark:text-ink-300">
                {recipe.result.items[0]?.name}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function RecipeGroup({ recipes }: { recipes: Recipe[] }) {
  return (
    <div className="my-4 flex flex-wrap items-start gap-3">
      {recipes.map((recipe, i) => (
        <RecipeView key={`${recipe.id}-${i}`} recipe={recipe} />
      ))}
    </div>
  )
}
