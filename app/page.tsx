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

interface TermData {
  repos: RepoRow[]
  reposState: LoadState
  reposElapsed: string | null
  reposSql: string | null
  reposReadRows: number
  reposError: string | null
  selectedRepo: string | null
  repoContext: { repoId: string; op: string; indexMode: IndexMode; since: string } | null
  contribData: ContributorRow[]
  contribState: LoadState
  contribElapsed: string | null
  contribSql: string | null
  contribReadRows: number
  issuesData: Issue[]
  issuesState: LoadState
  issuesElapsed: string | null
  issuesSql: string | null
  issuesReadRows: number
  prsData: Issue[]
  prsState: LoadState
  prsElapsed: string | null
  prsSql: string | null
  prsReadRows: number
  detailTab: 'issues' | 'prs'
}

interface HistTermState {
  data: { bucket: string; count: string }[]
  state: LoadState
  elapsed: string | null
  sql: string | null
  readRows: number
}

const emptyTermData = (): TermData => ({
  repos: [], reposState: 'idle', reposElapsed: null, reposSql: null, reposReadRows: 0, reposError: null,
  selectedRepo: null, repoContext: null,
  contribData: [], contribState: 'idle', contribElapsed: null, contribSql: null, contribReadRows: 0,
  issuesData: [], issuesState: 'idle', issuesElapsed: null, issuesSql: null, issuesReadRows: 0,
  prsData: [], prsState: 'idle', prsElapsed: null, prsSql: null, prsReadRows: 0,
  detailTab: 'issues',
})

const emptyHistState = (): HistTermState => ({
  data: [], state: 'idle', elapsed: null, sql: null, readRows: 0,
})

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  // Multi-term state
  const [terms, setTerms] = useState<string[]>([])
  const [termInput, setTermInput] = useState('')
  const [activeTermIdx, setActiveTermIdx] = useState(0)
  const [termData, setTermData] = useState<Record<string, TermData>>({})
  const [histByTerm, setHistByTerm] = useState<Record<string, HistTermState>>({})
  const [histGranularity, setHistGranularity] = useState('toStartOfDay')
  const [histHeight, setHistHeight] = useState(260)
  const histDragRef = useRef<{ startY: number; startH: number } | null>(null)
  useEffect(() => {
    setHistHeight(Math.max(160, Math.round(window.innerHeight * 0.28)))
  }, [])

  // Global settings
  const [indexMode, setIndexMode] = useState<IndexMode>('fts')
  const [since, setSince] = useState('1M')
  const [op, setOp] = useState<'any' | 'all'>('all')
  const [excludeBots, setExcludeBots] = useState(true)

  // Repo filter
  const [repoFilter, setRepoFilter] = useState<string[]>([])
  const [repoFilterInput, setRepoFilterInput] = useState('')
  const [repoSuggestions, setRepoSuggestions] = useState<string[]>([])
  const [repoSuggestionsLoading, setRepoSuggestionsLoading] = useState(false)

  const abortRefs = useRef<Record<string, AbortController>>({})
  const termsRef = useRef<string[]>([])
  useEffect(() => { termsRef.current = terms }, [terms])

  const openSQL = useCallback((sql: string) => {
    const encoded = btoa(unescape(encodeURIComponent(sql)))
    window.open(`https://sql.clickhouse.com/?query=${encodeURIComponent(encoded)}`, '_blank')
  }, [])

  // Stable state updaters
  const updateTerm = useCallback((t: string, patch: Partial<TermData>) =>
    setTermData(prev => ({ ...prev, [t]: { ...(prev[t] ?? emptyTermData()), ...patch } })), [])

  const updateHist = useCallback((t: string, patch: Partial<HistTermState>) =>
    setHistByTerm(prev => ({ ...prev, [t]: { ...(prev[t] ?? emptyHistState()), ...patch } })), [])

  const fetchContributors = useCallback(async (
    term: string,
    ctx: { repoId: string; op: string; indexMode: IndexMode; since: string },
    tryExcludeBots: boolean,
    onFallback?: (newVal: boolean) => void,
  ) => {
    updateTerm(term, { contribState: 'loading', contribReadRows: 0 })
    try {
      const q = buildContributorsQuery(term, ctx.op, ctx.indexMode, ctx.since, ctx.repoId, tryExcludeBots)
      const res = await chStream<ContributorRow>(q.sql, q.params, ctx.indexMode, (p) =>
        updateTerm(term, { contribReadRows: p.readRows }))
      if (res.rows.length === 0 && tryExcludeBots) {
        onFallback?.(false)
        const q2 = buildContributorsQuery(term, ctx.op, ctx.indexMode, ctx.since, ctx.repoId, false)
        const res2 = await chStream<ContributorRow>(q2.sql, q2.params, ctx.indexMode, (p) =>
          updateTerm(term, { contribReadRows: p.readRows }))
        updateTerm(term, { contribSql: res2.sql, contribData: res2.rows, contribElapsed: res2.elapsed, contribState: 'done' })
      } else {
        updateTerm(term, { contribSql: res.sql, contribData: res.rows, contribElapsed: res.elapsed, contribState: 'done' })
      }
    } catch (e) { console.error('Contributors query failed:', e); updateTerm(term, { contribState: 'error' }) }
  }, [updateTerm])

  const selectRepo = useCallback((term: string, repoName: string) => {
    const td = termData[term]
    if (!td) return
    const repoId = td.repos.find(r => r.repo_name === repoName)?.repo_id
    if (!repoId) return

    const ctx = { repoId, op, indexMode, since }
    updateTerm(term, {
      selectedRepo: repoName, repoContext: ctx,
      issuesData: [], issuesState: 'loading', issuesElapsed: null, issuesSql: null, issuesReadRows: 0,
      prsData: [], prsState: 'loading', prsElapsed: null, prsSql: null, prsReadRows: 0,
      contribData: [], contribState: 'loading', contribElapsed: null, contribSql: null, contribReadRows: 0,
    })

    const issuesQ = buildPrsQuery(term, op, indexMode, since, repoId, 'issues')
    chStream<Issue>(issuesQ.sql, issuesQ.params, indexMode, (p) =>
      updateTerm(term, { issuesReadRows: p.readRows }))
      .then(({ rows, elapsed, sql }) =>
        updateTerm(term, { issuesSql: sql, issuesData: rows, issuesElapsed: elapsed, issuesState: 'done' }))
      .catch((e) => { console.error('Issues query failed:', e); updateTerm(term, { issuesState: 'error' }) })

    const prsQ = buildPrsQuery(term, op, indexMode, since, repoId, 'prs')
    chStream<Issue>(prsQ.sql, prsQ.params, indexMode, (p) =>
      updateTerm(term, { prsReadRows: p.readRows }))
      .then(({ rows, elapsed, sql }) =>
        updateTerm(term, { prsSql: sql, prsData: rows, prsElapsed: elapsed, prsState: 'done' }))
      .catch((e) => { console.error('PRs query failed:', e); updateTerm(term, { prsState: 'error' }) })

    fetchContributors(term, ctx, excludeBots, (newVal) => setExcludeBots(newVal))
  }, [termData, op, indexMode, since, excludeBots, updateTerm, fetchContributors])

  const searchTerm = useCallback((
    t: string, currentOp: string, currentIndexMode: IndexMode, currentSince: string, currentRepoFilter: string[]
  ) => {
    abortRefs.current[t]?.abort()
    const controller = new AbortController()
    abortRefs.current[t] = controller
    const signal = controller.signal

    updateTerm(t, {
      repos: [], reposState: 'loading', reposElapsed: null, reposError: null, reposSql: null, reposReadRows: 0,
      selectedRepo: null, repoContext: null,
      contribData: [], contribState: 'idle', contribElapsed: null, contribSql: null, contribReadRows: 0,
      issuesData: [], issuesState: 'idle', issuesElapsed: null, issuesSql: null, issuesReadRows: 0,
      prsData: [], prsState: 'idle', prsElapsed: null, prsSql: null, prsReadRows: 0,
    })
    updateHist(t, { data: [], state: 'loading', elapsed: null, sql: null, readRows: 0 })

    const isAbort = (e: unknown) => (e as Error).name === 'AbortError'

    const reposQ = buildReposQuery(t, currentOp, currentIndexMode, currentSince, currentRepoFilter)
    chStream<RepoRow>(reposQ.sql, reposQ.params, currentIndexMode, (p) =>
      updateTerm(t, { reposReadRows: p.readRows }), signal)
      .then(({ rows, elapsed, sql }) =>
        updateTerm(t, { reposSql: sql, repos: rows, reposElapsed: elapsed, reposState: 'done' }))
      .catch((e) => { if (!isAbort(e)) updateTerm(t, { reposError: e.message, reposState: 'error' }) })

    const histQ = buildHistogramQuery(t, currentOp, currentIndexMode, currentSince, currentRepoFilter)
    chStream<{ bucket: string; count: string }>(histQ.sql, histQ.params, currentIndexMode, (p) =>
      updateHist(t, { readRows: p.readRows }), signal)
      .then(({ rows, elapsed, sql }) => {
        updateHist(t, { sql, data: rows, elapsed, state: 'done' })
        setHistGranularity(histQ.granularity)
      })
      .catch((e) => { if (!isAbort(e)) updateHist(t, { state: 'error' }) })
  }, [updateTerm, updateHist])

  const addTerm = useCallback((t: string) => {
    const trimmed = t.trim()
    if (!trimmed || terms.includes(trimmed) || terms.length >= 4) return
    const nextTerms = [...terms, trimmed]
    setTerms(nextTerms)
    setActiveTermIdx(nextTerms.length - 1)
    setTermInput('')
    searchTerm(trimmed, op, indexMode, since, repoFilter)
  }, [terms, op, indexMode, since, repoFilter, searchTerm])

  const removeTerm = useCallback((t: string) => {
    const currentTerms = termsRef.current
    const idx = currentTerms.indexOf(t)
    setTerms(prev => prev.filter(x => x !== t))
    if (idx !== -1) {
      setActiveTermIdx(prev => {
        if (prev < idx) return prev
        if (prev > idx) return prev - 1
        // prev === idx: active tab removed → go to same position or clamp
        return Math.min(prev, Math.max(0, currentTerms.length - 2))
      })
    }
    setTermData(prev => { const d = { ...prev }; delete d[t]; return d })
    setHistByTerm(prev => { const d = { ...prev }; delete d[t]; return d })
    abortRefs.current[t]?.abort()
    delete abortRefs.current[t]
  }, [])

  const toggleExcludeBots = useCallback(() => {
    const newExclude = !excludeBots
    setExcludeBots(newExclude)
    const t = termsRef.current[activeTermIdx]
    if (!t) return
    setTermData(prev => {
      const ctx = prev[t]?.repoContext
      if (ctx) fetchContributors(t, ctx, newExclude)
      return prev
    })
  }, [excludeBots, activeTermIdx, fetchContributors])

  const resetAll = useCallback(() => {
    Object.values(abortRefs.current).forEach(ctrl => ctrl.abort())
    abortRefs.current = {}
    setTerms([])
    setTermInput('')
    setActiveTermIdx(0)
    setTermData({})
    setHistByTerm({})
  }, [])

  const onHistDragStart = useCallback((e: React.MouseEvent) => {
    histDragRef.current = { startY: e.clientY, startH: histHeight }
    const onMove = (ev: MouseEvent) => {
      if (!histDragRef.current) return
      const delta = ev.clientY - histDragRef.current.startY
      setHistHeight(Math.max(140, Math.min(Math.round(window.innerHeight * 0.82), histDragRef.current.startH + delta)))
    }
    const onUp = () => {
      histDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [histHeight])

  // Re-search all terms when global settings change
  useEffect(() => {
    if (termsRef.current.length > 0) {
      for (const t of termsRef.current) {
        searchTerm(t, op, indexMode, since, repoFilter)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexMode, since, op, repoFilter])

  // Repo filter suggestions
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

  // Derived active term data
  const activeTerm = terms[activeTermIdx] ?? terms[0]
  const atd = activeTerm ? (termData[activeTerm] ?? emptyTermData()) : null
  const activeTermRepos = atd?.repos ?? []
  const primaryHist = terms[0] ? (histByTerm[terms[0]] ?? emptyHistState()) : null

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
      {terms.length === 0 ? (
        /* ── Landing layout ─────────────────────────────────────────────── */
        <div className="px-6 pt-8 pb-4 flex-shrink-0">
          <div className="max-w-2xl mx-auto">
            <p className="text-center text-ch-muted text-sm mb-4">
              Search 10B+ GitHub events by technology, topic, or keyword
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); if (termInput.trim()) addTerm(termInput) }}
            >
              <div className="flex-1 flex flex-wrap items-center gap-1.5 bg-ch-gray border border-ch-border rounded-lg px-3 py-1.5 focus-within:border-ch-yellow transition-colors min-w-0">
                <input
                  className="flex-1 min-w-[120px] bg-transparent text-sm text-white placeholder-ch-muted outline-none py-0.5"
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  placeholder="clickhouse, iceberg, vector..."
                  autoFocus
                />
              </div>
              <RepoFilter
                selected={repoFilter}
                input={repoFilterInput}
                onInputChange={setRepoFilterInput}
                suggestions={
                  repoFilterInput.length >= 2
                    ? repoSuggestions
                    : activeTermRepos.map((r) => r.repo_name).filter((r) => !repoFilter.includes(r)).slice(0, 8)
                }
                suggestionsLoading={repoSuggestionsLoading}
                onAdd={(repo) => setRepoFilter((prev) => prev.includes(repo) ? prev : [...prev, repo])}
                onRemove={(repo) => setRepoFilter((prev) => prev.filter((r) => r !== repo))}
              />
              <button
                type="submit"
                disabled={!termInput.trim()}
                className="px-4 py-2 bg-ch-yellow text-black text-sm font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
              >
                Search
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
                    { value: 'all', label: 'AND' },
                    { value: 'any', label: 'OR'  },
                  ]}
                  selected={op}
                  onClick={(v) => setOp(v as 'any' | 'all')}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} type="secondary" onClick={() => addTerm(s)}>{s}</Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Compact layout when search is active ───────────────────────── */
        <div className="px-6 py-3 flex-shrink-0">
          <form
            className="flex items-center gap-2 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault()
              if (termInput.trim()) {
                addTerm(termInput)
              } else {
                for (const t of terms) searchTerm(t, op, indexMode, since, repoFilter)
              }
            }}
          >
            <ButtonGroup
              options={DATE_RANGES.map((r) => ({ value: r.value, label: r.label }))}
              selected={since}
              onClick={setSince}
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
            <span className="text-ch-border">|</span>
            <div className="flex-1 flex flex-wrap items-center gap-1.5 bg-ch-gray border border-ch-border rounded-lg px-3 py-1.5 focus-within:border-ch-yellow transition-colors min-w-[180px]">
              {terms.map((t, i) => (
                <span
                  key={t}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border flex-shrink-0"
                  style={{ borderColor: SERIES_COLORS[i % SERIES_COLORS.length], color: SERIES_COLORS[i % SERIES_COLORS.length] }}
                >
                  {t}
                  <button type="button" onClick={() => removeTerm(t)} className="opacity-50 hover:opacity-100 leading-none ml-0.5">×</button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[100px] bg-transparent text-sm text-white placeholder-ch-muted outline-none py-0.5"
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                placeholder={terms.length < 4 ? 'Add another term…' : ''}
                autoFocus
                disabled={terms.length >= 4}
              />
            </div>
            <RepoFilter
              selected={repoFilter}
              input={repoFilterInput}
              onInputChange={setRepoFilterInput}
              suggestions={
                repoFilterInput.length >= 2
                  ? repoSuggestions
                  : activeTermRepos.map((r) => r.repo_name).filter((r) => !repoFilter.includes(r)).slice(0, 8)
              }
              suggestionsLoading={repoSuggestionsLoading}
              onAdd={(repo) => setRepoFilter((prev) => prev.includes(repo) ? prev : [...prev, repo])}
              onRemove={(repo) => setRepoFilter((prev) => prev.filter((r) => r !== repo))}
            />
            <button
              type="submit"
              className="px-4 py-2 bg-ch-yellow text-black text-sm font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
            >
              {terms.some(t => termData[t]?.reposState === 'loading') ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>
      )}

      {/* ─── Histogram ───────────────────────────────────────────────────── */}
      {primaryHist && primaryHist.state !== 'idle' && (<>
        <div className="px-6 pb-0 flex-shrink-0" style={{ height: histHeight }}>
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
                  <SQLButton onClick={() => primaryHist.sql && openSQL(primaryHist.sql)} visible={!!primaryHist.sql && primaryHist.state !== 'loading'} />
                  <RowsBadge rows={primaryHist.readRows} loading={primaryHist.state === 'loading'} />
                  <LiveElapsedBadge elapsed={primaryHist.elapsed} loading={primaryHist.state === 'loading'} indexMode={indexMode} />
                </div>
              </div>

              {primaryHist.state === 'loading' && primaryHist.data.length === 0 && <Spinner label="Loading…" />}
              {terms.some(t => (histByTerm[t]?.data.length ?? 0) > 0) && (
                <div className={`flex-1 min-h-0 transition-opacity duration-200 ${primaryHist.state === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                  <Histogram
                    series={terms.map(t => ({ term: t, data: histByTerm[t]?.data ?? [] })) satisfies HistSeries[]}
                    granularity={histGranularity}
                  />
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Drag handle */}
        <div
          className="px-6 flex-shrink-0 flex items-center justify-center h-4 cursor-ns-resize group select-none"
          onMouseDown={onHistDragStart}
        >
          <div className="w-16 h-1 rounded-full bg-ch-border group-hover:bg-ch-yellow transition-colors duration-150" />
        </div>
      </>)}

      {/* ─── Results ─────────────────────────────────────────────────────── */}
      <div className="lg:flex-1 flex flex-col px-6 pb-6 lg:min-h-0">

        {/* Term tabs */}
        {terms.length > 1 && (
          <div className="flex gap-1 mb-3 flex-shrink-0">
            {terms.map((t, i) => (
              <button
                key={t}
                onClick={() => setActiveTermIdx(i)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${
                  i === activeTermIdx
                    ? 'font-semibold'
                    : 'border-transparent text-ch-muted hover:text-white'
                }`}
                style={i === activeTermIdx
                  ? { borderColor: SERIES_COLORS[i % SERIES_COLORS.length], color: SERIES_COLORS[i % SERIES_COLORS.length], background: SERIES_COLORS[i % SERIES_COLORS.length] + '18' }
                  : {}}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:min-h-0">
          {!atd || atd.reposState === 'idle' ? (
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
              <Panel hasBorder radii="lg" padding="sm" className="lg:flex-1 min-h-[240px] lg:min-h-0 overflow-hidden">
                <div className="flex flex-col w-full h-full">
                  <div className="flex items-center justify-between mb-2 flex-shrink-0 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-white flex-shrink-0">
                        Top Repos
                      </h2>
                      {atd.selectedRepo ? (
                        <>
                          <span className="text-ch-muted text-xs flex-shrink-0">→</span>
                          <span className="text-xs font-semibold text-ch-yellow font-mono truncate">{atd.selectedRepo}</span>
                          <button
                            className="flex-shrink-0 text-ch-muted hover:text-white transition-colors text-xs leading-none"
                            onClick={() => updateTerm(activeTerm, {
                              selectedRepo: null, repoContext: null,
                              issuesState: 'idle', issuesData: [],
                              prsState: 'idle', prsData: [],
                              contribState: 'idle', contribData: [],
                            })}
                          >✕</button>
                        </>
                      ) : (
                        <span className="text-ch-muted font-normal normal-case tracking-normal text-xs">
                          · {DATE_RANGES.find((r) => r.value === since)?.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SQLButton onClick={() => atd.reposSql && openSQL(atd.reposSql)} visible={!!atd.reposSql} />
                      <RowsBadge rows={atd.reposReadRows} loading={atd.reposState === 'loading'} />
                      <LiveElapsedBadge elapsed={atd.reposElapsed} loading={atd.reposState === 'loading'} indexMode={indexMode} />
                    </div>
                  </div>

                  {atd.reposState === 'loading' && atd.repos.length === 0 && (
                    <div className="flex-1 flex items-center justify-center">
                      <Spinner label="Scanning GitHub events…" />
                    </div>
                  )}
                  {atd.reposState === 'error' && <p className="text-red-400 text-sm">{atd.reposError}</p>}
                  {atd.reposState === 'done' && atd.repos.length === 0 && (
                    <p className="text-ch-muted text-sm">No results found.</p>
                  )}
                  {atd.repos.length > 0 && (
                    <div className={`flex-1 min-h-0 transition-opacity duration-200 ${atd.reposState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                      <PackedBubbleChart
                        data={atd.repos}
                        onSelect={(name) => selectRepo(activeTerm, name)}
                        selectedRepo={atd.selectedRepo}
                      />
                    </div>
                  )}
                </div>
              </Panel>

              {/* ── Right: detail panel ──────────────────────────────────────── */}
              <div className="lg:flex-1 flex flex-col lg:min-h-0 gap-3">
                {!atd.selectedRepo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-ch-muted text-sm">Click a bubble to explore contributors and issues / pull requests</p>
                  </div>
                ) : (
                  <>
                    {/* Top Contributors */}
                    <Panel hasBorder radii="lg" padding="sm" className="min-h-[140px] lg:min-h-0" style={{ flex: 2 }}>
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
                            <RowsBadge rows={atd.contribReadRows} loading={atd.contribState === 'loading'} />
                            <SQLButton onClick={() => atd.contribSql && openSQL(atd.contribSql)} visible={!!atd.contribSql} />
                            <LiveElapsedBadge elapsed={atd.contribElapsed} loading={atd.contribState === 'loading'} indexMode={indexMode} />
                          </div>
                        </div>
                        {atd.contribState === 'loading' && atd.contribData.length === 0 && (
                          <Spinner label="Loading contributors…" />
                        )}
                        {atd.contribState === 'error' && (
                          <p className="text-red-400 text-xs py-2">Failed to load contributors — check console for details.</p>
                        )}
                        {atd.contribData.length > 0 && (
                          <div className={`flex-1 min-h-0 transition-opacity duration-200 ${atd.contribState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                            <ContributorsChart data={atd.contribData} />
                          </div>
                        )}
                      </div>
                    </Panel>

                    {/* Issues / PRs panel */}
                    <Panel hasBorder radii="lg" padding="sm" className="min-h-[200px] lg:min-h-0" style={{ flex: 5 }}>
                      <div className="flex flex-col w-full h-full">
                        <div className="flex items-center justify-between mb-2 flex-shrink-0">
                          <div className="flex gap-1">
                            {(['issues', 'prs'] as const).map(tab => (
                              <button
                                key={tab}
                                onClick={() => updateTerm(activeTerm, { detailTab: tab })}
                                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                                  atd.detailTab === tab
                                    ? 'bg-ch-yellow text-black font-semibold'
                                    : 'bg-ch-gray text-ch-muted hover:text-white border border-ch-border'
                                }`}
                              >
                                {tab === 'issues' ? 'Top Issues' : 'Top PRs'}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {atd.detailTab === 'issues' ? (
                              <>
                                <RowsBadge rows={atd.issuesReadRows} loading={atd.issuesState === 'loading'} />
                                <SQLButton onClick={() => atd.issuesSql && openSQL(atd.issuesSql)} visible={!!atd.issuesSql} />
                                <LiveElapsedBadge elapsed={atd.issuesElapsed} loading={atd.issuesState === 'loading'} indexMode={indexMode} />
                              </>
                            ) : (
                              <>
                                <RowsBadge rows={atd.prsReadRows} loading={atd.prsState === 'loading'} />
                                <SQLButton onClick={() => atd.prsSql && openSQL(atd.prsSql)} visible={!!atd.prsSql} />
                                <LiveElapsedBadge elapsed={atd.prsElapsed} loading={atd.prsState === 'loading'} indexMode={indexMode} />
                              </>
                            )}
                          </div>
                        </div>

                        {atd.detailTab === 'issues' ? (
                          <>
                            {atd.issuesState === 'loading' && atd.issuesData.length === 0 && <Spinner label="Loading issues…" />}
                            {atd.issuesState === 'error' && <p className="text-red-400 text-xs py-2">Failed to load issues.</p>}
                            {atd.issuesData.length > 0 && (
                              <div className={`flex-1 lg:overflow-y-auto lg:min-h-0 transition-opacity duration-200 ${atd.issuesState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                                <PRList prs={atd.issuesData} repo={atd.selectedRepo!} mode="issues" />
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {atd.prsState === 'loading' && atd.prsData.length === 0 && <Spinner label="Loading pull requests…" />}
                            {atd.prsState === 'error' && <p className="text-red-400 text-xs py-2">Failed to load pull requests.</p>}
                            {atd.prsData.length > 0 && (
                              <div className={`flex-1 lg:overflow-y-auto lg:min-h-0 transition-opacity duration-200 ${atd.prsState === 'loading' ? 'opacity-40' : 'opacity-100'}`}>
                                <PRList prs={atd.prsData} repo={atd.selectedRepo!} mode="prs" />
                              </div>
                            )}
                          </>
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
