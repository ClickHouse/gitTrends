'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { hierarchy, pack } from 'd3-hierarchy'

interface RepoRow {
  repo_name: string
  repo_id: string
  mentions: string
}

interface Props {
  data: RepoRow[]
  onSelect: (repo: string) => void
  selectedRepo: string | null
}

interface Tooltip {
  x: number
  y: number
  label: string
  sub?: string
}

const ORG_COLORS = [
  '#60a5fa', // blue-400
  '#f97316', // orange-500
  '#a78bfa', // violet-400
  '#34d399', // emerald-400
  '#f472b6', // pink-400
  '#38bdf8', // sky-400
  '#fb7185', // rose-400
  '#2dd4bf', // teal-400
  '#facc15', // yellow-400
  '#c084fc', // purple-400
]

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Normalized space for per-org repo packing: center=(BASE,BASE), radius=BASE
const BASE = 100

export default function PackedBubbleChart({ data, onSelect, selectedRepo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 600, h: 400 })
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const orgLayouts = useMemo(() => {
    const { w, h } = dims
    if (data.length === 0) return []

    // Group repos by org
    const orgMap = new Map<string, { repo_name: string; repo_id: string; value: number }[]>()
    for (const r of data) {
      const org = r.repo_name.split('/')[0]
      if (!orgMap.has(org)) orgMap.set(org, [])
      orgMap.get(org)!.push({ repo_name: r.repo_name, repo_id: r.repo_id, value: Number(r.mentions) })
    }

    const orgsArr = Array.from(orgMap.entries())
      .map(([org, repos]) => ({ org, repos, total: repos.reduce((s, r) => s + r.value, 0) }))
      .sort((a, b) => b.total - a.total)

    // Org radii proportional to sqrt(total mentions)
    const maxTotal = Math.max(...orgsArr.map((o) => o.total), 1)
    const REF_R = Math.min(w, h) / 2.5
    const GAP = 4

    const nodes = orgsArr.map((o, i) => ({
      ...o,
      color: ORG_COLORS[i % ORG_COLORS.length],
      r: Math.max(20, REF_R * Math.sqrt(o.total / maxTotal)),
      x: 0,
      y: 0,
    }))

    // Seed positions in a grid sized to the container's aspect ratio
    const numCols = Math.max(1, Math.round(Math.sqrt(nodes.length * (w / h))))
    const numRows = Math.ceil(nodes.length / numCols)
    nodes.forEach((n, i) => {
      n.x = (w / (numCols + 1)) * ((i % numCols) + 1)
      n.y = (h / (numRows + 1)) * (Math.floor(i / numCols) + 1)
    })

    // Iterative collision resolution — no boundary clamping so circles can
    // spread freely; we'll scale the result to fill the box afterward.
    for (let iter = 0; iter < 250; iter++) {
      const alpha = 1 - iter / 250

      // Weak gravity toward center keeps the cluster together
      nodes.forEach((n) => {
        n.x += (w / 2 - n.x) * 0.004 * alpha
        n.y += (h / 2 - n.y) * 0.004 * alpha
      })

      // Push overlapping org circles apart
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]
          const dx = b.x - a.x || 1e-4
          const dy = b.y - a.y || 0
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = a.r + b.r + GAP
          if (dist < minDist) {
            const push = ((minDist - dist) / dist) * 0.5
            a.x -= dx * push; a.y -= dy * push
            b.x += dx * push; b.y += dy * push
          }
        }
      }
    }

    // Bounding box of the cluster
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r)
      minY = Math.min(minY, n.y - n.r)
      maxX = Math.max(maxX, n.x + n.r)
      maxY = Math.max(maxY, n.y + n.r)
    }

    const bw = maxX - minX
    const bh = maxY - minY
    const PAD = 20

    // Option 3 (AmeliaBR): scale factor = average of the two fill ratios.
    // Using min() would leave gaps; max() would overflow; average is the happy medium.
    const sf = ((w - 2 * PAD) / bw + (h - 2 * PAD) / bh) / 2
    const sw = bw * sf
    const sh = bh * sf

    // Apply uniform scale + center in container
    nodes.forEach((n) => {
      n.x = (n.x - minX) * sf + (w - sw) / 2
      n.y = (n.y - minY) * sf + (h - sh) / 2
      n.r *= sf
    })

    // Pack each org's repos independently in a normalized BASE×BASE space,
    // then scale to the org's final (post-squeeze) radius.
    return nodes.map(({ org, repos, color, r, x, y }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repoTree = hierarchy<any>({ name: org, children: repos })
        .sum((d) => d.value ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = pack<any>().size([BASE * 2, BASE * 2]).padding(4)(repoTree)
      return {
        org, color,
        cx: x, cy: y, displayR: r,
        scale: r / BASE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: (p.children ?? []) as any[],
      }
    })
  }, [data, dims])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <svg width={dims.w} height={dims.h}>
        <defs>
          {orgLayouts.flatMap(({ children, cx, cy, scale }) =>
            children.map((repoNode) => {
              const repo = repoNode.data as { repo_name: string }
              const rx = cx + (repoNode.x - BASE) * scale
              const ry = cy + (repoNode.y - BASE) * scale
              const rr = repoNode.r * scale
              const id = `clip-${repo.repo_name.replace(/[^a-z0-9]/gi, '-')}`
              return (
                <clipPath key={id} id={id}>
                  <circle cx={rx} cy={ry} r={rr - 2} />
                </clipPath>
              )
            })
          )}
        </defs>

        {orgLayouts.map(({ org, color, cx, cy, displayR, scale, children }) => (
          <g key={org}>
            <circle
              cx={cx}
              cy={cy}
              r={displayR}
              fill={hexToRgba(color, 0.05)}
              stroke={hexToRgba(color, 0.3)}
              strokeWidth={1.5}
              onMouseMove={(e) => {
                const rect = containerRef.current!.getBoundingClientRect()
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: org })
              }}
              onMouseLeave={() => setTooltip(null)}
            />

            {children.map((repoNode) => {
              const repo = repoNode.data as { repo_name: string; value: number }
              const isSelected = repo.repo_name === selectedRepo
              const repoShort = repo.repo_name.split('/').pop() ?? repo.repo_name
              const rx = cx + (repoNode.x - BASE) * scale
              const ry = cy + (repoNode.y - BASE) * scale
              const rr = repoNode.r * scale
              const showLabel = rr > 18
              const clipId = `clip-${repo.repo_name.replace(/[^a-z0-9]/gi, '-')}`

              return (
                <g
                  key={repo.repo_name}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(repo.repo_name)}
                  onMouseMove={(e) => {
                    const rect = containerRef.current!.getBoundingClientRect()
                    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: repo.repo_name, sub: `${repo.value.toLocaleString()} mentions` })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <circle
                    cx={rx}
                    cy={ry}
                    r={rr}
                    fill={isSelected ? '#FAFF69' : hexToRgba(color, 0.25)}
                    stroke={isSelected ? '#FAFF69' : hexToRgba(color, 0.7)}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {showLabel && (
                    <text
                      x={rx}
                      y={ry}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={isSelected ? '#1a1a1a' : '#e5e5e5'}
                      fontSize={Math.min(11, rr * 0.42)}
                      fontFamily="Inter, system-ui, sans-serif"
                      clipPath={`url(#${clipId})`}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {repoShort}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>

      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1.5 rounded text-xs bg-[#1a1a1a] border border-[#2a2a2a] text-[#e5e5e5] whitespace-nowrap"
          style={
            tooltip.x > dims.w * 0.65
              ? { right: dims.w - tooltip.x + 14, top: tooltip.y - 10 }
              : { left: tooltip.x + 14, top: tooltip.y - 10 }
          }
        >
          <div className="font-semibold">{tooltip.label}</div>
          {tooltip.sub && <div className="text-ch-muted">{tooltip.sub}</div>}
        </div>
      )}
    </div>
  )
}
