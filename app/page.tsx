'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import PRList from '@/components/PRList'

const BubbleChart = dynamic(() => import('@/components/BubbleChart'), { ssr: false })
const HeatMap     = dynamic(() => import('@/components/HeatMap'),     { ssr: false })

const SUGGESTIONS = ['kubernetes', 'docker', 'clickhouse', 'rust', 'wasm', 'llm', 'grpc', 'kafka']

const DATE_RANGES = [
  { label: '1 month',  value: '1M'  },
  { label: '3 months', value: '3M'  },
  { label: '1 year',   value: '1Y'  },
  { label: 'All time', value: 'all' },
]

interface RepoRow  { repo_name: string; repo_id: string; mentions: string }
interface HeatRow  { day_of_week: number; hour: number; cnt: string }
interface Issue {
  number: number; title: string; actor_login: string; created_at: string
  comments: number; state: string
}

type LoadState = 'idle' | 'loading' | 'done' | 'error'

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [term,     setTerm]     = useState('')
  const [useIndex, setUseIndex] = useState(true)
  const [since,    setSince]    = useState('1M')

  const [repos,        setRepos]        = useState<RepoRow[]>([])
  const [reposState,   setReposState]   = useState<LoadState>('idle')
  const [reposElapsed, setReposElapsed] = useState<string | null>(null)
  const [reposError,   setReposError]   = useState<string | null>(null)
  const [reposSql,     setReposSql]     = useState<string | null>(null)

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)

  const [heatmapData,    setHeatmapData]    = useState<HeatRow[]>([])
  const [heatmapState,   setHeatmapState]   = useState<LoadState>('idle')
  const [heatmapElapsed, setHeatmapElapsed] = useState<string | null>(null)
  const [heatmapSql,     setHeatmapSql]     = useState<string | null>(null)

  const [prs,        setPrs]        = useState<Issue[]>([])
  const [prsState,   setPrsState]   = useState<LoadState>('idle')
  const [prsElapsed, setPrsElapsed] = useState<string | null>(null)
  const [prsSql,     setPrsSql]     = useState<string | null>(null)

  const openSQL = useCallback((sql: string) => {
    const encoded = btoa(unescape(encodeURIComponent(sql)))
    window.open(`https://sql.clickhouse.com/?query=${encodeURIComponent(encoded)}`, '_blank')
  }, [])

  const abortRef = useRef<AbortController | null>(null)

  const buildParams = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams({ useIndex: String(useIndex), since, ...extra })
      return p.toString()
    },
    [useIndex, since]
  )

  const search = useCallback(
    async (searchTerm: string) => {
      const t = searchTerm.trim()
      if (!t) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setSelectedRepo(null)
      setHeatmapData([])
      setPrs([])
      setHeatmapState('idle')
      setPrsState('idle')
      setHeatmapSql(null)
      setPrsSql(null)
      setReposState('loading')
      setReposElapsed(null)
      setReposError(null)
      setReposSql(null)

      try {
        const res  = await fetch(`/api/repos?term=${encodeURIComponent(t)}&${buildParams()}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (json.sql) setReposSql(json.sql)
        if (json.error) throw new Error(json.error)
        setRepos(json.rows)
        setReposElapsed(json.elapsed)
        setReposState('done')
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        setReposError((err as Error).message)
        setReposState('error')
      }
    },
    [buildParams]
  )

  const selectRepo = useCallback(
    async (repoName: string) => {
      if (!term.trim()) return
      const repoId = repos.find((r) => r.repo_name === repoName)?.repo_id
      if (!repoId) return
      setSelectedRepo(repoName)
      setHeatmapState('loading')
      setPrsState('loading')
      setHeatmapElapsed(null)
      setPrsElapsed(null)

      const params = `term=${encodeURIComponent(term.trim())}&repo_id=${encodeURIComponent(repoId)}&${buildParams()}`

      const [heatRes, prsRes] = await Promise.all([
        fetch(`/api/heatmap?${params}`),
        fetch(`/api/prs?${params}`),
      ])
      const [heatJson, prsJson] = await Promise.all([heatRes.json(), prsRes.json()])

      if (heatJson.sql) setHeatmapSql(heatJson.sql)
      if (!heatJson.error) {
        setHeatmapData(heatJson.rows)
        setHeatmapElapsed(heatJson.elapsed)
        setHeatmapState('done')
      } else {
        setHeatmapState('error')
      }

      if (prsJson.sql) setPrsSql(prsJson.sql)
      if (!prsJson.error) {
        setPrs(prsJson.rows)
        setPrsElapsed(prsJson.elapsed)
        setPrsState('done')
      } else {
        setPrsState('error')
      }
    },
    [term, repos, buildParams]
  )

  const resetAll = useCallback(() => {
    abortRef.current?.abort()
    setTerm('')
    setRepos([])
    setReposState('idle')
    setReposElapsed(null)
    setReposError(null)
    setReposSql(null)
    setSelectedRepo(null)
    setHeatmapData([])
    setHeatmapState('idle')
    setHeatmapElapsed(null)
    setHeatmapSql(null)
    setPrs([])
    setPrsState('idle')
    setPrsElapsed(null)
    setPrsSql(null)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') search(term)
  }

  useEffect(() => {
    if (repos.length > 0 || reposState === 'loading') search(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useIndex, since])

  return (
    <div className="h-screen flex flex-col bg-ch-dark text-white overflow-hidden">

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-ch-border">
        <div className="flex items-center gap-3">
          <a href="/" onClick={(e) => { e.preventDefault(); resetAll() }} className="flex items-center gap-3 cursor-pointer">
            <CHLogo />
         
          <span className="font-semibold text-lg tracking-tight">
            Git<span className="text-ch-yellow">Search</span>
          </span>
           </a>
          <span className="text-ch-muted text-sm hidden sm:block">· Full-Text Search Demo</span>
        </div>

        {/* Scan mode toggle */}
        <div className="flex items-center gap-2 select-none">
          <button
            onClick={() => setUseIndex(false)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              !useIndex
                ? 'border-red-500 text-red-400 bg-[#ff000012]'
                : 'border-ch-border text-ch-muted hover:border-ch-border'
            }`}
            title="query_plan_direct_read_from_text_index=0, use_skip_indexes_on_data_read=0"
          >
            Direct scan
          </button>
          <button
            onClick={() => setUseIndex(true)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              useIndex
                ? 'border-ch-yellow text-ch-yellow bg-[#faff6912]'
                : 'border-ch-border text-ch-muted hover:border-ch-border'
            }`}
            title="query_plan_direct_read_from_text_index=1, use_skip_indexes_on_data_read=1"
          >
            Index scan
          </button>
        </div>
      </header>

      {/* ─── Search bar ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-8 pb-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-center text-ch-muted text-sm mb-4">
            Search 10B+ GitHub events by technology, topic, or keyword
          </p>

          <div className="flex gap-2">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="kubernetes, docker, clickhouse…"
              className="flex-1 bg-ch-gray border border-ch-border rounded-lg px-4 py-2.5 text-sm
                         placeholder:text-ch-muted focus:outline-none focus:border-ch-yellow
                         transition-colors font-mono"
            />
            <button
              onClick={() => search(term)}
              disabled={reposState === 'loading'}
              className="px-5 py-2.5 rounded-lg bg-ch-yellow text-ch-dark font-semibold text-sm
                         hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {reposState === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className="flex gap-1">
              {DATE_RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setSince(r.value)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    since === r.value
                      ? 'border-ch-yellow text-ch-yellow bg-[#faff6912]'
                      : 'border-ch-border text-ch-muted hover:border-ch-yellow hover:text-ch-yellow'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {repos.length === 0 && reposState === 'idle' && (
              <div className="flex flex-wrap gap-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setTerm(s); search(s) }}
                    className="px-3 py-1 rounded-full border border-ch-border text-xs text-ch-muted
                               hover:border-ch-yellow hover:text-ch-yellow transition-colors font-mono"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Results ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 px-6 pb-6 min-h-0">

        {reposState === 'idle' ? (
          /* Empty hero */
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-16 opacity-60">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect width="7" height="48" rx="3.5" fill="#FAFF69" />
              <rect x="10" width="7" height="48" rx="3.5" fill="#FAFF69" />
              <rect x="20" width="7" height="34" rx="3.5" fill="#FAFF69" />
              <rect x="30" width="7" height="48" rx="3.5" fill="#FAFF69" />
              <rect x="40" width="7" height="26" rx="3.5" fill="#FAFF69" />
            </svg>
            <p className="text-ch-muted text-sm max-w-sm">
              Full-text search across <span className="text-white font-mono">10B+</span> GitHub
              events powered by ClickHouse inverted indexes.
              <br />
              Toggle between Direct scan and Index scan to compare speed.
            </p>
          </div>
        ) : (
          <>
            {/* ── Left: bubble chart ───────────────────────────────────────── */}
            <div className="flex flex-col lg:w-[45%] min-h-[380px] lg:min-h-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-white">
                  Repositories mentioning{' '}
                  <span className="text-ch-yellow font-mono">"{term}"</span>
                  <span className="text-ch-muted font-normal">
                    {' '}·{' '}{DATE_RANGES.find((r) => r.value === since)?.label}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  {reposState === 'done' && reposSql && (
                    <SQLButton onClick={() => openSQL(reposSql)} />
                  )}
                  {reposState === 'done' && reposElapsed && (
                    <ElapsedBadge elapsed={reposElapsed} useIndex={useIndex} />
                  )}
                </div>
              </div>

              {reposState === 'loading' && <Spinner label="Scanning GitHub events…" />}
              {reposState === 'error'   && <p className="text-red-400 text-sm">{reposError}</p>}
              {reposState === 'done' && repos.length === 0 && (
                <p className="text-ch-muted text-sm">No results found.</p>
              )}
              {reposState === 'done' && repos.length > 0 && (
                <div className="flex-1 border border-ch-border rounded-xl bg-ch-gray overflow-hidden min-h-0">
                  <BubbleChart data={repos} onSelect={selectRepo} selectedRepo={selectedRepo} />
                </div>
              )}
            </div>

            {/* ── Right: detail panel ──────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              {!selectedRepo ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-ch-muted text-sm">Click a bubble to explore activity and issues</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ch-yellow font-mono">{selectedRepo}</span>
                    <button
                      onClick={() => { setSelectedRepo(null); setHeatmapState('idle'); setPrsState('idle') }}
                      className="text-ch-muted hover:text-white text-xs ml-1"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Heatmap */}
                  <div className="border border-ch-border rounded-xl bg-ch-gray p-4 flex flex-col" style={{ height: 260 }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                        Activity by day &amp; hour (UTC)
                      </h3>
                      <div className="flex items-center gap-2">
                        {heatmapState === 'done' && heatmapSql && (
                          <SQLButton onClick={() => openSQL(heatmapSql)} />
                        )}
                        {heatmapState === 'done' && heatmapElapsed && (
                          <ElapsedBadge elapsed={heatmapElapsed} useIndex={useIndex} />
                        )}
                      </div>
                    </div>
                    {heatmapState === 'loading' && <Spinner label="Loading heatmap…" />}
                    {heatmapState === 'done' && (
                      <div className="flex-1 min-h-0">
                        <HeatMap data={heatmapData} />
                      </div>
                    )}
                  </div>

                  {/* Issues */}
                  <div className="flex-1 border border-ch-border rounded-xl bg-ch-gray p-4 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                        Top Issues
                      </h3>
                      <div className="flex items-center gap-2">
                        {prsState === 'done' && prsSql && (
                          <SQLButton onClick={() => openSQL(prsSql)} />
                        )}
                        {prsState === 'done' && prsElapsed && (
                          <ElapsedBadge elapsed={prsElapsed} useIndex={useIndex} />
                        )}
                      </div>
                    </div>
                    {prsState === 'loading' && <Spinner label="Loading issues…" />}
                    {prsState === 'done' && (
                      <div className="flex-1 overflow-y-auto min-h-0">
                        <PRList prs={prs} repo={selectedRepo!} />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Helper components ─────────────────────────────────────────────────────────

function CHLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect width="4" height="28" rx="2" fill="#FAFF69" />
      <rect x="6" width="4" height="28" rx="2" fill="#FAFF69" />
      <rect x="12" width="4" height="20" rx="2" fill="#FAFF69" />
      <rect x="18" width="4" height="28" rx="2" fill="#FAFF69" />
      <rect x="24" width="4" height="16" rx="2" fill="#FAFF69" />
    </svg>
  )
}

function SQLButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 rounded border border-ch-border
                 text-ch-muted hover:border-ch-yellow hover:text-ch-yellow text-xs
                 font-mono transition-colors"
    >
      <span className="opacity-70">{'<'}/{'>'}</span> SQL
    </button>
  )
}


function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-8">
      <div className="w-5 h-5 border-2 border-ch-yellow border-t-transparent rounded-full animate-spin flex-shrink-0" />
      <span className="text-ch-muted text-sm">{label}</span>
    </div>
  )
}

function ElapsedBadge({ elapsed, useIndex }: { elapsed: string; useIndex: boolean }) {
  return (
    <span
      title={
        useIndex
          ? 'Index scan: query_plan_direct_read_from_text_index=1, use_skip_indexes_on_data_read=1'
          : 'Direct scan: query_plan_direct_read_from_text_index=0, use_skip_indexes_on_data_read=0'
      }
      className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
        useIndex
          ? 'border-ch-yellow text-ch-yellow bg-[#faff6912]'
          : 'border-red-500 text-red-400 bg-[#ff000012]'
      }`}
    >
      {elapsed}s {useIndex ? '⚡' : '🐢'}
    </span>
  )
}
