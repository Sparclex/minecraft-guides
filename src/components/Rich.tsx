import { Fragment, type CSSProperties, type ReactNode } from 'react'
import type { Block, Inline } from '../types'
import { imageUrl } from '../data'
import { RecipeGroup } from './Recipe'

interface RichProps {
  /** Turns an `entry:`/`category:` href into an app route. */
  onNavigate?: (href: string) => void
}

/* ------------------------------------------------------------------ *
 * Inline runs
 * ------------------------------------------------------------------ */

function classesFor(node: Extract<Inline, { t: 'text' }>): string {
  const cls: string[] = []
  if (node.b) cls.push('font-semibold')
  if (node.i) cls.push('italic')
  if (node.u) cls.push('underline')
  if (node.s) cls.push('line-through')
  if (node.k) cls.push('obfuscated')
  if (node.c) cls.push('mc-color')
  if (node.code) cls.push('font-mono text-[0.9em] px-1 py-0.5 rounded bg-ink-200/60 dark:bg-ink-800')
  return cls.join(' ')
}

/** Author-chosen colours ride on a custom property so the theme can adapt them. */
function styleFor(node: Extract<Inline, { t: 'text' }>) {
  return node.c ? ({ '--mc': node.c } as CSSProperties) : undefined
}

function ItemChip({ id, label, onNavigate }: { id: string; label?: string; onNavigate?: RichProps['onNavigate'] }) {
  const text = label || id.split(':').pop() || id
  return (
    <span
      title={id}
      onClick={onNavigate ? () => onNavigate(`item:${id}`) : undefined}
      className="mx-0.5 inline-flex items-baseline gap-1 rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-px align-baseline text-[0.92em] font-medium text-brand-600 dark:text-brand-300"
    >
      {text}
    </span>
  )
}

export function RichInline({ nodes, onNavigate }: { nodes: Inline[] | null | undefined } & RichProps) {
  if (!nodes?.length) return null
  return (
    <>
      {nodes.map((node, i) => {
        if (node.t === 'br') return <br key={i} />
        if (node.t === 'item') return <ItemChip key={i} id={node.id} label={node.label} onNavigate={onNavigate} />

        const content: ReactNode = node.v
        const style = styleFor(node)
        const className = classesFor(node)

        if (node.href) {
          const external = /^(https?:|mailto:)/.test(node.href)
          if (external) {
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                style={style}
                className={`${className} text-brand-600 underline decoration-brand-500/40 underline-offset-2 hover:decoration-brand-500 dark:text-brand-300`}
              >
                {content}
              </a>
            )
          }
          if (node.href.startsWith('item:')) {
            return <ItemChip key={i} id={node.href.slice(5)} label={node.v} onNavigate={onNavigate} />
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate?.(node.href!)}
              style={style}
              className={`${className} cursor-pointer text-brand-600 underline decoration-brand-500/40 underline-offset-2 hover:decoration-brand-500 dark:text-brand-300`}
            >
              {content}
            </button>
          )
        }

        if (!className && !style) return <Fragment key={i}>{content}</Fragment>
        return (
          <span key={i} className={className} style={style} title={node.tip}>
            {content}
          </span>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

const HEADING_SIZES: Record<number, string> = {
  1: 'text-2xl font-semibold tracking-tight',
  2: 'text-xl font-semibold tracking-tight',
  3: 'text-lg font-semibold',
  4: 'text-base font-semibold',
  5: 'text-sm font-semibold uppercase tracking-wide',
  6: 'text-sm font-semibold uppercase tracking-wide',
}

function Callout({
  tone = 'neutral',
  label,
  children,
}: {
  tone?: 'neutral' | 'brand' | 'amber'
  label?: string
  children: ReactNode
}) {
  const tones = {
    neutral: 'border-ink-200 bg-ink-100/60 dark:border-ink-700 dark:bg-ink-800/50',
    brand: 'border-brand-500/30 bg-brand-500/8',
    amber: 'border-amber-glow/35 bg-amber-glow/10',
  }
  return (
    <div className={`my-4 rounded-lg border px-4 py-3 ${tones[tone]}`}>
      {label && (
        <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-widest text-ink-500 dark:text-ink-400">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

export function RichBlocks({ blocks, onNavigate }: { blocks: Block[] | null | undefined } & RichProps) {
  if (!blocks?.length) return null
  return (
    <>
      {blocks.map((block, i) => (
        <RichBlock key={i} block={block} onNavigate={onNavigate} />
      ))}
    </>
  )
}

function RichBlock({ block, onNavigate }: { block: Block } & RichProps) {
  switch (block.k) {
    case 'para':
      return (
        <p className="my-3 leading-relaxed">
          <RichInline nodes={block.text} onNavigate={onNavigate} />
        </p>
      )

    case 'heading': {
      const Tag = (`h${Math.min(block.level + 1, 6)}`) as 'h2'
      return (
        <Tag className={`mt-6 mb-2 ${HEADING_SIZES[block.level] ?? HEADING_SIZES[3]}`}>
          <RichInline nodes={block.text} onNavigate={onNavigate} />
        </Tag>
      )
    }

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={`my-3 space-y-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-ink-400`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              <RichInline nodes={item} onNavigate={onNavigate} />
            </li>
          ))}
        </Tag>
      )
    }

    case 'table':
      return (
        <div className="my-4 overflow-x-auto rounded-lg border border-ink-200 dark:border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-100 dark:bg-ink-800">
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} className="px-3 py-2 font-semibold">
                    <RichInline nodes={cell} onNavigate={onNavigate} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-ink-200 dark:border-ink-700">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2 align-top">
                      <RichInline nodes={cell} onNavigate={onNavigate} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'code':
      return (
        <pre className="scroll-slim my-4 overflow-x-auto rounded-lg bg-ink-900 p-4 text-sm text-ink-100 dark:bg-black/40">
          <code>{block.text}</code>
        </pre>
      )

    case 'quote':
      return (
        <blockquote className="my-4 border-l-2 border-brand-500/50 pl-4 text-ink-600 italic dark:text-ink-300">
          <RichBlocks blocks={block.blocks} onNavigate={onNavigate} />
        </blockquote>
      )

    case 'group':
      return <RichBlocks blocks={block.blocks} onNavigate={onNavigate} />

    case 'image':
      if (!block.src) return null
      return (
        <figure className="my-4">
          <img
            src={imageUrl(block.src)}
            alt={block.alt ?? ''}
            loading="lazy"
            // A handful of pack-supplied quest pictures reference files that
            // were never committed; drop them rather than showing a broken icon.
            onError={(e) => e.currentTarget.closest('figure')?.remove()}
            className="mx-auto max-w-full rounded-lg border border-ink-200 bg-white/40 dark:border-ink-700 dark:bg-black/20"
            style={{ imageRendering: 'pixelated' }}
          />
          {block.alt && (
            <figcaption className="mt-2 text-center text-xs text-ink-500 dark:text-ink-400">{block.alt}</figcaption>
          )}
        </figure>
      )

    case 'itemcard':
      return (
        <Callout tone="brand">
          <div className="font-semibold">{block.label || block.item}</div>
          <div className="mt-0.5 font-mono text-xs text-ink-500 dark:text-ink-400">{block.item}</div>
          {block.text?.length > 0 && (
            <p className="mt-2 leading-relaxed">
              <RichInline nodes={block.text} onNavigate={onNavigate} />
            </p>
          )}
        </Callout>
      )

    case 'recipe':
      if (block.recipes?.length) return <RecipeGroup recipes={block.recipes} />
      // Recipes added by a datapack or KubeJS script have no file in any jar,
      // so all that is left to show is what the book itself named.
      return (
        <Callout tone="amber" label={`${block.kind.replace(/_/g, ' ')} recipe`}>
          <div className="flex flex-wrap gap-2">
            {block.ids.map((id, i) => (
              <span key={id} className="rounded bg-ink-100 px-2 py-1 text-sm dark:bg-ink-800">
                {block.labels?.[i] || id.split(':').pop()}
                <span className="ml-2 font-mono text-[0.7rem] text-ink-400">{id}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            This recipe is not defined in any mod jar — open it in JEI in-game to see the grid.
          </p>
        </Callout>
      )

    case 'multiblock':
      return (
        <Callout tone="neutral" label="Multiblock structure">
          <div className="font-medium">{block.name || block.id || 'Structure'}</div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            The book renders a rotatable 3D preview of this build in-game.
          </p>
        </Callout>
      )

    case 'entity':
      return (
        <Callout tone="neutral" label="Entity">
          <div className="font-medium">{block.label || block.entity}</div>
          <div className="mt-0.5 font-mono text-xs text-ink-500 dark:text-ink-400">{block.entity}</div>
        </Callout>
      )

    case 'link':
      return (
        <p className="my-3">
          <a
            href={block.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-600 underline underline-offset-2 dark:text-brand-300"
          >
            <RichInline nodes={block.text} onNavigate={onNavigate} />
          </a>
        </p>
      )

    case 'relations':
      return (
        <Callout tone="neutral" label="See also">
          <ul className="flex flex-wrap gap-2">
            {block.entries.map((id) => (
              <li key={id} className="rounded bg-ink-100 px-2 py-1 font-mono text-xs dark:bg-ink-800">
                {id}
              </li>
            ))}
          </ul>
        </Callout>
      )

    case 'itemgrid':
      return (
        <div className="my-3 flex flex-wrap gap-1.5">
          <RichInline nodes={block.items} onNavigate={onNavigate} />
        </div>
      )

    case 'scene':
      return (
        <Callout tone="neutral" label={block.label}>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {block.note}
            {block.structure && <span className="ml-1 font-mono text-xs">({block.structure})</span>}
          </p>
        </Callout>
      )

    case 'kv':
      return (
        <dl className="my-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {block.rows.map(([label, value], i) => (
            <Fragment key={i}>
              <dt className="pt-px font-semibold text-ink-500 dark:text-ink-400">{label}</dt>
              <dd className="leading-relaxed">
                <RichInline nodes={value} onNavigate={onNavigate} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )

    case 'subpages':
      return null

    case 'divider':
      return <hr className="my-6 border-ink-200 dark:border-ink-700" />

    default:
      return null
  }
}
