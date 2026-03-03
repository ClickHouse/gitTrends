'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import PRList from '@/components/PRList'
import { Button, ButtonGroup, SearchField, Panel, Badge, Switch } from '@clickhouse/click-ui'
import { chStream, fmtRows, type IndexMode } from '@/lib/ch-stream'
import { buildReposQuery, buildHistogramQuery, buildContributorsQuery, buildPrsQuery } from '@/lib/queries'

const PackedBubbleChart  = dynamic(() => import('@/components/PackedBubbleChart'),  { ssr: false })
const HeatMap            = dynamic(() => import('@/components/HeatMap'),            { ssr: false })
const Histogram          = dynamic(() => import('@/components/Histogram'),          { ssr: false })
const ContributorsChart  = dynamic(() => import('@/components/ContributorsChart'),  { ssr: false })

const SUGGESTIONS = ['clickhouse', 'iceberg', 'vector', 'inverted index']

const DATE_RANGES = [
  { label: '1 month',  value: '1M'  },
  { label: '3 months', value: '3M'  },
  { label: '1 year',   value: '1Y'  },
  { label: 'All time', value: 'all' },
]

interface RepoRow        { repo_name: string; repo_id: string; mentions: string }
interface HeatRow        { day_of_week: number; hour: number; cnt: string }
interface ContributorRow { actor_login: string; issues: string; prs: string; comments: string; total: string }
interface Issue {
  number: number; title: string; actor_login: string; created_at: string
  comments: number; state: string; mentions: number
}

type LoadState = 'idle' | 'loading' | 'done' | 'error'

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [term,     setTerm]     = useState('')
  const [indexMode, setIndexMode] = useState<IndexMode>('fts')
  const [since,    setSince]    = useState('1M')
  const [mode,     setMode]     = useState<'issues' | 'prs'>('issues')
  const [op,       setOp]       = useState<'any' | 'all'>('all')

  const [repos,        setRepos]        = useState<RepoRow[]>([])
  const [reposState,   setReposState]   = useState<LoadState>('idle')
  const [reposElapsed, setReposElapsed] = useState<string | null>(null)
  const [reposError,   setReposError]   = useState<string | null>(null)
  const [reposSql,     setReposSql]     = useState<string | null>(null)
  const [reposReadRows, setReposReadRows] = useState(0)

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)

  const [contribData,    setContribData]    = useState<ContributorRow[]>([])
  const [contribState,   setContribState]   = useState<LoadState>('idle')
  const [contribElapsed, setContribElapsed] = useState<string | null>(null)
  const [contribSql,     setContribSql]     = useState<string | null>(null)
  const [contribReadRows, setContribReadRows] = useState(0)
  const [excludeBots,    setExcludeBots]    = useState(true)

  const [prs,        setPrs]        = useState<Issue[]>([])
  const [prsState,   setPrsState]   = useState<LoadState>('idle')
  const [prsElapsed, setPrsElapsed] = useState<string | null>(null)
  const [prsSql,     setPrsSql]     = useState<string | null>(null)
  const [prsReadRows, setPrsReadRows] = useState(0)

  const [histData,        setHistData]        = useState<{ bucket: string; count: string }[]>([])
  const [histState,       setHistState]       = useState<LoadState>('idle')
  const [histElapsed,     setHistElapsed]     = useState<string | null>(null)
  const [histSql,         setHistSql]         = useState<string | null>(null)
  const [histReadRows,    setHistReadRows]    = useState(0)
  const [histGranularity, setHistGranularity] = useState('toStartOfDay')

  const openSQL = useCallback((sql: string) => {
    const encoded = btoa(unescape(encodeURIComponent(sql)))
    window.open(`https://sql.clickhouse.com/?query=${encodeURIComponent(encoded)}`, '_blank')
  }, [])

  const abortRef      = useRef<AbortController | null>(null)
  const repoContextRef = useRef<{ term: string; repoId: string; op: string; indexMode: IndexMode; since: string; mode: string } | null>(null)

  const search = useCallback(
    async (searchTerm: string) => {
      const t = searchTerm.trim()
      if (!t) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const signal = controller.signal

      setSelectedRepo(null)
      setPrs([])
      setPrsState('idle')
      setPrsSql(null)
      setReposState('loading')
      setReposElapsed(null)
      setReposError(null)
      setReposSql(null)
      setReposReadRows(0)
      setHistState('loading')
      setHistReadRows(0)
      setContribState('idle')
      setContribData([])
      setContribElapsed(null)
      setContribSql(null)

      const isAbort = (e: unknown) => (e as Error).name === 'AbortError'

      const reposQ = buildReposQuery(t, op, indexMode, since, mode)
      chStream<RepoRow>(reposQ.sql, reposQ.params, indexMode, (p) => setReposReadRows(p.readRows), signal)
        .then(({ rows, elapsed, sql }) => {
          setReposSql(sql); setRepos(rows); setReposElapsed(elapsed); setReposState('done')
        })
        .catch((e) => { if (!isAbort(e)) { setReposError(e.message); setReposState('error') } })

      const histQ = buildHistogramQuery(t, op, indexMode, since, mode)
      chStream<{ bucket: string; count: string }>(histQ.sql, histQ.params, indexMode, (p) => setHistReadRows(p.readRows), signal)
        .then(({ rows, elapsed, sql }) => {
          setHistSql(sql); setHistData(rows); setHistElapsed(elapsed)
          setHistGranularity(histQ.granularity); setHistState('done')
        })
        .catch((e) => { if (!isAbort(e)) setHistState('error') })
    },
    [indexMode, since, mode, op]
  )

  const fetchContributors = useCallback(async (
    ctx: NonNullable<typeof repoContextRef.current>, tryExcludeBots: boolean
  ) => {
    setContribState('loading')
    setContribReadRows(0)
    try {
      const q = buildContributorsQuery(ctx.term, ctx.op, ctx.indexMode, ctx.since, ctx.repoId, tryExcludeBots)
      const res = await chStream<ContributorRow>(q.sql, q.params, ctx.indexMode, (p) => setContribReadRows(p.readRows))
      if (res.rows.length === 0 && tryExcludeBots) {
        // no humans — fall back to including bots
        setExcludeBots(false)
        const q2 = buildContributorsQuery(ctx.term, ctx.op, ctx.indexMode, ctx.since, ctx.repoId, false)
        const res2 = await chStream<ContributorRow>(q2.sql, q2.params, ctx.indexMode, (p) => setContribReadRows(p.readRows))
        setContribSql(res2.sql); setContribData(res2.rows); setContribElapsed(res2.elapsed)
      } else {
        setExcludeBots(tryExcludeBots)
        setContribSql(res.sql); setContribData(res.rows); setContribElapsed(res.elapsed)
      }
      setContribState('done')
    } catch (e) { console.error('Contributors query failed:', e); setContribState('error') }
  }, [])

  const selectRepo = useCallback(
    (repoName: string) => {
      if (!term.trim()) return
      const repoId = repos.find((r) => r.repo_name === repoName)?.repo_id
      console.log('selectRepo:', repoName, '→ repo_id =', JSON.stringify(repoId))
      if (!repoId) { console.warn('selectRepo: no repo_id for', repoName, repos); return }

      const ctx = { term: term.trim(), repoId, op, indexMode, since, mode }
      repoContextRef.current = ctx

      setSelectedRepo(repoName)
      setPrsState('loading')
      setContribState('loading')
      setPrsElapsed(null)
      setContribElapsed(null)
      setContribData([])
      setPrsReadRows(0)

      const prsQ = buildPrsQuery(ctx.term, ctx.op, ctx.indexMode, ctx.since, ctx.repoId, ctx.mode)
      chStream<Issue>(prsQ.sql, prsQ.params, ctx.indexMode, (p) => setPrsReadRows(p.readRows))
        .then(({ rows, elapsed, sql }) => {
          setPrsSql(sql); setPrs(rows); setPrsElapsed(elapsed); setPrsState('done')
        })
        .catch((e) => { console.error('Issues/PRs query failed:', e); setPrsState('error') })

      fetchContributors(ctx, true)
    },
    [term, repos, op, indexMode, since, mode, fetchContributors]
  )

  const toggleExcludeBots = useCallback(() => {
    if (repoContextRef.current) fetchContributors(repoContextRef.current, !excludeBots)
  }, [excludeBots, fetchContributors])

  const resetAll = useCallback(() => {
    abortRef.current?.abort()
    setTerm('')
    setRepos([])
    setReposState('idle')
    setReposElapsed(null)
    setReposError(null)
    setReposSql(null)
    setReposReadRows(0)
    setSelectedRepo(null)
    setPrs([])
    setPrsState('idle')
    setPrsElapsed(null)
    setPrsSql(null)
    setPrsReadRows(0)
    setHistData([])
    setHistState('idle')
    setHistElapsed(null)
    setHistSql(null)
    setHistReadRows(0)
    setContribData([])
    setContribState('idle')
    setContribElapsed(null)
    setContribSql(null)
    setContribReadRows(0)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') search(term)
  }

  useEffect(() => {
    if (repos.length > 0 || reposState === 'loading') search(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexMode, since, mode, op])


  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-ch-dark text-white overflow-auto lg:overflow-hidden">

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

        {/* Index mode toggle */}
        <div className="flex items-center gap-1">
          {([
            { value: 'fts',       label: 'FTS',          title: 'Inverted index: enable_full_text_index=1, query_plan_direct_read_from_text_index=1' },
            { value: 'bloom',     label: 'Bloom filter',  title: 'Token bloom filter: use_skip_indexes_on_data_read=1, enable_full_text_index=0' },
            { value: 'full_scan', label: 'Full scan',     title: 'No index: use_skip_indexes_on_data_read=0, enable_full_text_index=0, uses ILIKE' },
          ] as const).map(({ value, label, title }) => (
            <Button
              key={value}
              onClick={() => setIndexMode(value)}
              title={title}
              type={indexMode === value ? (value === 'full_scan' ? 'danger' : 'primary') : 'secondary'}
            >
              {label}
            </Button>
          ))}
        </div>
      </header>

      {/* ─── Search bar ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-8 pb-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-center text-ch-muted text-sm mb-4">
            Search 10B+ GitHub events by technology, topic, or keyword
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <SearchField
                value={term}
                onChange={(value) => setTerm(value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') search(term) }}
                placeholder="clickhouse, iceberg, vector..."
              />
            </div>
            <Button
              type="primary"
              onClick={() => search(term)}
              disabled={reposState === 'loading'}
              loading={reposState === 'loading'}
              label={reposState === 'loading' ? 'Searching…' : 'Search'}
            />
          </div>

          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <ButtonGroup
                options={DATE_RANGES.map((r) => ({ value: r.value, label: r.label }))}
                selected={since}
                onClick={setSince}
              />
              <span className="text-ch-border">|</span>
              <ButtonGroup
                options={[
                  { value: 'issues', label: 'Issues' },
                  { value: 'prs',    label: 'Pull Requests' },
                ]}
                selected={mode}
                onClick={(v) => setMode(v as 'issues' | 'prs')}
              />
              <span className="text-ch-border">|</span>
              <ButtonGroup
                options={[
                  { value: 'all', label: 'AND' },
                  { value: 'any', label: 'OR'  },
                ]}
                selected={op}
                onClick={(v) => setOp(v as 'any' | 'all')}
              />
            </div>

            {repos.length === 0 && reposState === 'idle' && (
              <div className="flex flex-wrap gap-1">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    type="secondary"
                    onClick={() => { setTerm(s); search(s) }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Histogram ───────────────────────────────────────────────────── */}
      {histState !== 'idle' && (
        <div className="px-6 pb-3 flex-shrink-0" style={{ height: 180 }}>
          <Panel hasBorder radii="lg" padding="sm" className="h-full">
            <div className="flex flex-col w-full h-full">
              <div className="flex items-center justify-between flex-shrink-0 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-white">
                  Mentions over time
                  <span className="font-normal normal-case text-ch-muted ml-1">
                    · per {histGranularity === 'toStartOfMonth' ? 'month' : histGranularity === 'toStartOfWeek' ? 'week' : 'day'}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {histSql     && <SQLButton onClick={() => openSQL(histSql)} />}
                  <RowsBadge rows={histReadRows} loading={histState === 'loading'} />
                  {histElapsed && <ElapsedBadge elapsed={histElapsed} indexMode={indexMode} />}
                </div>
              </div>
              {histState === 'loading' && histData.length === 0 && <Spinner label="Loading…" />}
              {histData.length > 0 && (
                <div className={`flex-1 min-h-0 transition-opacity duration-200 ${histState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                  <Histogram data={histData} granularity={histGranularity} />
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* ─── Results ─────────────────────────────────────────────────────── */}
      <div className="lg:flex-1 flex flex-col lg:flex-row gap-4 px-6 pb-6 lg:min-h-0">

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
              events powered by ClickHouse.
              <br /><br />
              Toggle between Full-Text Search, Bloom filter or Full scan to compare performances.
            </p>
          </div>
        ) : (
          <>
            {/* ── Left: bubble chart ───────────────────────────────────────── */}
            <div className="flex flex-col lg:flex-1 min-h-[380px] lg:min-h-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-white">
                  Top Repos
                  <span className="text-ch-muted font-normal">
                    {' '}·{' '}{DATE_RANGES.find((r) => r.value === since)?.label}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  {reposSql && <SQLButton onClick={() => openSQL(reposSql)} />}
                  <RowsBadge rows={reposReadRows} loading={reposState === 'loading'} />
                  {reposElapsed && <ElapsedBadge elapsed={reposElapsed} indexMode={indexMode} />}
                </div>
              </div>

              {reposState === 'loading' && <Spinner label="Scanning GitHub events…" />}
              {reposState === 'error'   && <p className="text-red-400 text-sm">{reposError}</p>}
              {reposState === 'done' && repos.length === 0 && (
                <p className="text-ch-muted text-sm">No results found.</p>
              )}
              {reposState === 'done' && repos.length > 0 && (
                <Panel hasBorder radii="lg" padding="none" className="min-h-[320px] lg:flex-1 overflow-hidden lg:min-h-0">
                  <PackedBubbleChart data={repos} onSelect={selectRepo} selectedRepo={selectedRepo} />
                </Panel>
              )}
            </div>

            {/* ── Right: detail panel ──────────────────────────────────────── */}
            <div className="lg:flex-1 flex flex-col lg:min-h-0 gap-3">
              {!selectedRepo ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-ch-muted text-sm">Click a bubble to explore activity and {mode === 'issues' ? 'issues' : 'pull requests'}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ch-yellow font-mono">{selectedRepo}</span>
                    <Button
                      type="secondary"
                      onClick={() => { setSelectedRepo(null); setPrsState('idle'); setContribState('idle'); setContribData([]) }}
                    >
                      ✕
                    </Button>
                  </div>

                  {/* Heatmap — temporarily disabled
                  <div className="border border-ch-border rounded-xl bg-ch-gray p-4 flex flex-col flex-shrink-0" style={{ height: 200 }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                        Activity by day &amp; hour (UTC)
                      </h3>
                      <div className="flex items-center gap-2">
                        {heatmapState === 'done' && heatmapSql && (
                          <SQLButton onClick={() => openSQL(heatmapSql)} />
                        )}
                        {heatmapState === 'done' && heatmapElapsed && (
                          <ElapsedBadge elapsed={heatmapElapsed} indexMode={indexMode} />
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
                  */}

                  {/* Top Contributors */}
                  <Panel hasBorder radii="lg" padding="sm" className="flex-shrink-0" style={{ height: 200 }}>
                    <div className="flex flex-col w-full h-full">
                      <div className="flex items-center justify-between mb-2 flex-shrink-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                          Top Contributors
                        </h3>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={excludeBots}
                            onCheckedChange={() => toggleExcludeBots()}
                            label="Exclude bots"
                            dir="end"
                            orientation="horizontal"
                          />
                            <RowsBadge rows={contribReadRows} loading={contribState === 'loading'} />
                          {contribSql && <SQLButton onClick={() => openSQL(contribSql)} />}
                          {contribElapsed && <ElapsedBadge elapsed={contribElapsed} indexMode={indexMode} />}
                        </div>
                      </div>
                      {contribState === 'loading' && contribData.length === 0 && (
                        <Spinner label="Loading contributors…" />
                      )}
                      {contribState === 'error' && (
                        <p className="text-red-400 text-xs py-2">Failed to load contributors — check console for details.</p>
                      )}
                      {contribData.length > 0 && (
                        <div className={`flex-1 min-h-0 transition-opacity duration-200 ${contribState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                          <ContributorsChart data={contribData} />
                        </div>
                      )}
                    </div>
                  </Panel>

                  {/* Issues */}
                  <Panel hasBorder radii="lg" padding="sm" className="min-h-[240px] lg:flex-1 lg:min-h-0">
                    <div className="flex flex-col w-full h-full">
                      <div className="flex items-center justify-between mb-2 flex-shrink-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                          {mode === 'issues' ? 'Top Issues' : 'Top Pull Requests'}
                        </h3>
                        <div className="flex items-center gap-2">
                          <RowsBadge rows={prsReadRows} loading={prsState === 'loading'} />
                          {prsSql && <SQLButton onClick={() => openSQL(prsSql)} />}
                          {prsElapsed && <ElapsedBadge elapsed={prsElapsed} indexMode={indexMode} />}
                        </div>
                      </div>
                      {prsState === 'loading' && prs.length === 0 && <Spinner label="Loading issues…" />}
                      {prsState === 'error' && (
                        <p className="text-red-400 text-xs py-2">Failed to load issues — check console for details.</p>
                      )}
                      {prs.length > 0 && (
                        <div className={`flex-1 lg:overflow-y-auto lg:min-h-0 transition-opacity duration-200 ${prsState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                          <PRList prs={prs} repo={selectedRepo!} mode={mode} />
                        </div>
                      )}
                    </div>
                  </Panel>
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
    <Button type="secondary" onClick={onClick}>
      {'<'}/{'>'}  SQL
    </Button>
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

function ElapsedBadge({ elapsed, indexMode }: { elapsed: string; indexMode: string }) {
  const icon  = indexMode === 'fts' ? '⚡' : indexMode === 'bloom' ? '🔍' : '🐢'
  const state = indexMode === 'full_scan' ? 'danger' : 'success'
  return (
    <Badge text={`${elapsed}s ${icon}`} state={state} size="sm" />
  )
}

function RowsBadge({ rows, loading }: { rows: number; loading: boolean }) {
  if (rows === 0) return null
  return (
    <span className={`text-xs font-mono text-ch-muted tabular-nums ${loading ? 'animate-pulse' : ''}`}>
      {fmtRows(rows)} rows
    </span>
  )
}
