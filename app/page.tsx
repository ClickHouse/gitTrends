'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import PRList from '@/components/PRList'
import { Button, ButtonGroup, Panel, Badge, Switch } from '@clickhouse/click-ui'
import { chStream, fmtRows, type IndexMode } from '@/lib/ch-stream'
import { buildReposQuery, buildHistogramQuery, buildContributorsQuery, buildPrsQuery, buildRepoSuggestionsQuery } from '@/lib/queries'
import { SERIES_COLORS, type HistSeries } from '@/components/Histogram'

const PackedBubbleChart  = dynamic(() => import('@/components/PackedBubbleChart'),  { ssr: false })
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
interface ContributorRow { actor_login: string; issues: string; prs: string; comments: string; total: string }
interface Issue {
  number: number; title: string; actor_login: string; opened_at: string
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

  const [compareTerms,   setCompareTerms]   = useState<string[]>([])
  const [compareInput,   setCompareInput]   = useState('')
  const [compareData,    setCompareData]    = useState<Record<string, { bucket: string; count: string }[]>>({})
  const [compareLoading, setCompareLoading] = useState<Record<string, boolean>>({})
  const compareTermsRef = useRef<string[]>([])

  const [repoFilter,             setRepoFilter]             = useState<string[]>([])
  const [repoFilterInput,        setRepoFilterInput]        = useState('')
  const [repoSuggestions,        setRepoSuggestions]        = useState<string[]>([])
  const [repoSuggestionsLoading, setRepoSuggestionsLoading] = useState(false)

  const openSQL = useCallback((sql: string) => {
    const encoded = btoa(unescape(encodeURIComponent(sql)))
    window.open(`https://sql.clickhouse.com/?query=${encodeURIComponent(encoded)}`, '_blank')
  }, [])

  // Fetch histogram for a single compare term (all settings passed as params to avoid stale closures)
  const fetchCompareHist = useCallback(async (
    ct: string, currentOp: string, currentIndexMode: IndexMode, currentSince: string, currentMode: string, currentRepoFilter: string[]
  ) => {
    setCompareLoading((prev) => ({ ...prev, [ct]: true }))
    try {
      const q = buildHistogramQuery(ct, currentOp, currentIndexMode, currentSince, currentMode, currentRepoFilter)
      const { rows } = await chStream<{ bucket: string; count: string }>(q.sql, q.params, currentIndexMode, () => {})
      setCompareData((prev) => ({ ...prev, [ct]: rows }))
    } catch { /* ignore */ }
    setCompareLoading((prev) => ({ ...prev, [ct]: false }))
  }, [])

  const addCompareTerm = useCallback((ct: string) => {
    const t = ct.trim()
    if (!t || compareTermsRef.current.includes(t) || compareTermsRef.current.length >= 4) return
    const next = [...compareTermsRef.current, t]
    compareTermsRef.current = next
    setCompareTerms(next)
    setCompareInput('')
    fetchCompareHist(t, op, indexMode, since, mode, repoFilter)
  }, [op, indexMode, since, mode, fetchCompareHist, repoFilter])

  const removeCompareTerm = useCallback((ct: string) => {
    const next = compareTermsRef.current.filter((x) => x !== ct)
    compareTermsRef.current = next
    setCompareTerms(next)
    setCompareData((prev) => { const d = { ...prev }; delete d[ct]; return d })
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

      const reposQ = buildReposQuery(t, op, indexMode, since, mode, repoFilter)
      chStream<RepoRow>(reposQ.sql, reposQ.params, indexMode, (p) => setReposReadRows(p.readRows), signal)
        .then(({ rows, elapsed, sql }) => {
          setReposSql(sql); setRepos(rows); setReposElapsed(elapsed); setReposState('done')
        })
        .catch((e) => { if (!isAbort(e)) { setReposError(e.message); setReposState('error') } })

      const histQ = buildHistogramQuery(t, op, indexMode, since, mode, repoFilter)
      chStream<{ bucket: string; count: string }>(histQ.sql, histQ.params, indexMode, (p) => setHistReadRows(p.readRows), signal)
        .then(({ rows, elapsed, sql }) => {
          setHistSql(sql); setHistData(rows); setHistElapsed(elapsed)
          setHistGranularity(histQ.granularity); setHistState('done')
        })
        .catch((e) => { if (!isAbort(e)) setHistState('error') })

      for (const ct of compareTermsRef.current) {
        fetchCompareHist(ct, op, indexMode, since, mode, repoFilter)
      }
    },
    [indexMode, since, mode, op, fetchCompareHist, repoFilter]
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
      if (!repoId) return

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

  useEffect(() => {
    if (repos.length > 0 || reposState === 'loading') search(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexMode, since, mode, op, repoFilter])

  useEffect(() => {
    if (repoFilterInput.trim().length < 2) { setRepoSuggestions([]); return }
    const timer = setTimeout(async () => {
      setRepoSuggestionsLoading(true)
      try {
        const q = buildRepoSuggestionsQuery(repoFilterInput.trim())
        const { rows } = await chStream<{ repo_name: string }>(q.sql, q.params, 'fts', () => {})
        setRepoSuggestions(rows.map((r) => r.repo_name).filter((r) => !repoFilter.includes(r)))
      } catch { /* ignore */ }
      setRepoSuggestionsLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [repoFilterInput, repoFilter])


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

          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(term) }}>
            <input
              className="flex-1 bg-ch-gray border border-ch-border rounded-lg px-4 py-2 text-sm text-white placeholder-ch-muted outline-none focus:border-ch-yellow transition-colors"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="clickhouse, iceberg, vector..."
              autoFocus
            />
            <RepoFilter
              selected={repoFilter}
              input={repoFilterInput}
              onInputChange={setRepoFilterInput}
              suggestions={
                repoFilterInput.length >= 2
                  ? repoSuggestions
                  : repos.map((r) => r.repo_name).filter((r) => !repoFilter.includes(r)).slice(0, 8)
              }
              suggestionsLoading={repoSuggestionsLoading}
              onAdd={(repo) => setRepoFilter((prev) => prev.includes(repo) ? prev : [...prev, repo])}
              onRemove={(repo) => setRepoFilter((prev) => prev.filter((r) => r !== repo))}
            />
            <button
              type="submit"
              disabled={reposState === 'loading'}
              className="px-4 py-2 bg-ch-yellow text-black text-sm font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
            >
              {reposState === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </form>

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
        <div className="px-6 pb-3 flex-shrink-0" style={{ height: 210 }}>
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
                  <SQLButton onClick={() => histSql && openSQL(histSql)} visible={!!histSql && histState !== 'loading'} />
                  <RowsBadge rows={histReadRows} loading={histState === 'loading'} />
                  <LiveElapsedBadge elapsed={histElapsed} loading={histState === 'loading'} indexMode={indexMode} />
                </div>
              </div>

              {/* Compare term chips + add input */}
              <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 mb-1 min-h-[24px]">
                {compareTerms.map((ct, i) => (
                  <span
                    key={ct}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                    style={{ borderColor: SERIES_COLORS[i + 1], color: SERIES_COLORS[i + 1] }}
                  >
                    {compareLoading[ct] && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: SERIES_COLORS[i + 1] }} />}
                    {ct}
                    <button onClick={() => removeCompareTerm(ct)} className="opacity-50 hover:opacity-100 leading-none ml-0.5">×</button>
                  </span>
                ))}
                {compareTerms.length < 4 && (
                  <form onSubmit={(e) => { e.preventDefault(); addCompareTerm(compareInput) }}>
                    <input
                      value={compareInput}
                      onChange={(e) => setCompareInput(e.target.value)}
                      placeholder="+ compare term"
                      className="text-xs bg-ch-dark border border-dashed border-[#555] hover:border-[#888] focus:border-ch-yellow rounded px-2 py-0.5 outline-none text-white/60 placeholder-[#666] focus:text-white w-28 transition-colors"
                    />
                  </form>
                )}
              </div>

              {histState === 'loading' && histData.length === 0 && <Spinner label="Loading…" />}
              {histData.length > 0 && (
                <div className={`flex-1 min-h-0 transition-opacity duration-200 ${histState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                  <Histogram
                    series={[
                      { term, data: histData },
                      ...compareTerms.map((ct) => ({ term: ct, data: compareData[ct] ?? [] })),
                    ] satisfies HistSeries[]}
                    granularity={histGranularity}
                  />
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
                  <SQLButton onClick={() => reposSql && openSQL(reposSql)} visible={!!reposSql} />
                  <RowsBadge rows={reposReadRows} loading={reposState === 'loading'} />
                  <LiveElapsedBadge elapsed={reposElapsed} loading={reposState === 'loading'} indexMode={indexMode} />
                </div>
              </div>

              {reposState === 'loading' && repos.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <Spinner label="Scanning GitHub events…" />
                </div>
              )}
              {reposState === 'error'   && <p className="text-red-400 text-sm">{reposError}</p>}
              {reposState === 'done' && repos.length === 0 && (
                <p className="text-ch-muted text-sm">No results found.</p>
              )}
              {repos.length > 0 && (
                <Panel hasBorder radii="lg" padding="none" className="min-h-[320px] lg:flex-1 overflow-hidden lg:min-h-0">
                  <div className={`w-full h-full transition-opacity duration-200 ${reposState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                    <PackedBubbleChart data={repos} onSelect={selectRepo} selectedRepo={selectedRepo} />
                  </div>
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
                          <SQLButton onClick={() => contribSql && openSQL(contribSql)} visible={!!contribSql} />
                          <LiveElapsedBadge elapsed={contribElapsed} loading={contribState === 'loading'} indexMode={indexMode} />
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
                          <SQLButton onClick={() => prsSql && openSQL(prsSql)} visible={!!prsSql} />
                          <LiveElapsedBadge elapsed={prsElapsed} loading={prsState === 'loading'} indexMode={indexMode} />
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

function SQLButton({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <span className={visible ? '' : 'invisible'}>
      <Button type="secondary" onClick={onClick}>
        {'<'}/{'>'}  SQL
      </Button>
    </span>
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

function LiveElapsedBadge({ elapsed, loading, indexMode }: { elapsed: string | null; loading: boolean; indexMode: string }) {
  const [live, setLive] = useState('0.00')
  const startRef = useRef(0)

  useEffect(() => {
    if (!loading) return
    startRef.current = performance.now()
    setLive('0.00')
    const id = setInterval(() => {
      setLive(((performance.now() - startRef.current) / 1000).toFixed(2))
    }, 100)
    return () => clearInterval(id)
  }, [loading])

  if (!loading && !elapsed) return null
  const icon  = indexMode === 'fts' ? '⚡' : indexMode === 'bloom' ? '🔍' : '🐢'
  const state = indexMode === 'full_scan' ? 'danger' : 'success'
  return <Badge text={`${loading ? live : elapsed}s ${icon}`} state={state} size="sm" />
}

function RowsBadge({ rows, loading }: { rows: number; loading: boolean }) {
  if (rows === 0) return null
  return (
    <div className={`flex flex-col items-center text-xs font-mono text-ch-muted tabular-nums leading-tight w-[88px] ${loading ? 'animate-pulse' : ''}`}>
      <span>{fmtRows(rows)}</span>
      <span>rows scanned</span>
    </div>
  )
}

function RepoFilter({
  selected, input, onInputChange, suggestions, suggestionsLoading, onAdd, onRemove,
}: {
  selected: string[]
  input: string
  onInputChange: (v: string) => void
  suggestions: string[]
  suggestionsLoading: boolean
  onAdd: (repo: string) => void
  onRemove: (repo: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = selected.length === 0 ? 'All repos' : `${selected.length} repo${selected.length > 1 ? 's' : ''}`

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors whitespace-nowrap ${
          selected.length > 0
            ? 'border-ch-yellow text-ch-yellow bg-ch-gray'
            : 'border-ch-border text-ch-muted bg-ch-gray hover:border-[#555]'
        }`}
      >
        {label} <span className="text-[10px] opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-[#111] border border-ch-border rounded-lg shadow-2xl w-72 p-2">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-ch-border">
              {selected.map((r) => (
                <span key={r} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-ch-gray border border-ch-yellow text-ch-yellow font-mono">
                  {r}
                  <button type="button" onClick={() => onRemove(r)} className="opacity-60 hover:opacity-100 leading-none">×</button>
                </span>
              ))}
            </div>
          )}
          <input
            autoFocus
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Search repos…"
            className="w-full bg-ch-gray border border-ch-border rounded px-3 py-1.5 text-sm text-white placeholder-ch-muted outline-none focus:border-ch-yellow transition-colors"
          />
          <div className="mt-1 max-h-48 overflow-y-auto">
            {suggestionsLoading && <p className="text-xs text-ch-muted px-2 py-2">Searching…</p>}
            {!suggestionsLoading && suggestions.length === 0 && input.length < 2 && (
              <p className="text-xs text-ch-muted px-2 py-2">Type to search repos</p>
            )}
            {!suggestionsLoading && suggestions.length === 0 && input.length >= 2 && (
              <p className="text-xs text-ch-muted px-2 py-2">No repos found</p>
            )}
            {suggestions.map((repo) => (
              <button
                key={repo}
                type="button"
                onClick={() => { onAdd(repo); onInputChange('') }}
                className="w-full text-left px-2 py-1.5 text-xs text-white hover:bg-ch-gray rounded transition-colors font-mono"
              >
                {repo}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
