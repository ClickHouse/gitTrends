// Browser-compatible ClickHouse streaming client.
// Uses the HTTP API with JSONEachRowWithProgress format to get live row scan counts.

export type IndexMode = 'fts' | 'bloom' | 'full_scan'

const CH_URL      = process.env.NEXT_PUBLIC_CLICKHOUSE_URL      ?? 'https://sql-clickhouse.clickhouse.com'
const CH_USER     = process.env.NEXT_PUBLIC_CLICKHOUSE_USER     ?? 'demo'
const CH_PASSWORD = process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD ?? ''
export const CH_DB    = process.env.NEXT_PUBLIC_CLICKHOUSE_DB    ?? 'github'
export const CH_TABLE = process.env.NEXT_PUBLIC_CLICKHOUSE_TABLE ?? 'github_events'

// ── Query utilities (pure, no Node.js deps) ──────────────────────────────────

export function bodyCondition(term: string, op: string, mode: IndexMode): {
  condition: string
  params: Record<string, string>
} {
  const tokens = term.split(/\s+/).filter(Boolean)

  if (mode === 'fts') {
    const fn = op === 'all' ? 'hasAllTokens' : 'hasAnyTokens'
    return { condition: `${fn}(body, {term:String})`, params: { term } }
  }

  const lower = tokens.map(t => t.toLowerCase())

  if (mode === 'bloom') {
    if (lower.length === 1) {
      return { condition: `hasAny(tokens(lower(body)), [{term:String}])`, params: { term: lower[0] } }
    }
    const params = Object.fromEntries(lower.map((t, i) => [`t${i}`, t]))
    const refs = lower.map((_, i) => `{t${i}:String}`).join(', ')
    const fn = op === 'all' ? 'hasAll' : 'hasAny'
    return { condition: `${fn}(tokens(lower(body)), [${refs}])`, params }
  }

  // full_scan
  if (lower.length === 1) {
    return { condition: `hasToken(lower(body), {term:String})`, params: { term: lower[0] } }
  }
  const params = Object.fromEntries(lower.map((t, i) => [`t${i}`, t]))
  const clauses = lower.map((_, i) => `hasToken(lower(body), {t${i}:String})`)
  return { condition: clauses.join(op === 'all' ? ' AND ' : ' OR '), params }
}

export function indexSettings(mode: IndexMode): Record<string, string> {
  if (mode === 'fts') return {
    enable_parallel_replicas: '1',
    enable_full_text_index: '1',
    use_skip_indexes: '1',
    use_query_condition_cache: '0',
    query_plan_direct_read_from_text_index: '1',
    use_skip_indexes_on_data_read: '1',
  }
  if (mode === 'bloom') return {
    enable_parallel_replicas: '1',
    enable_full_text_index: '0',
    use_skip_indexes: '1',
    use_query_condition_cache: '0',
  }
  return {
    enable_parallel_replicas: '1',
    enable_full_text_index: '0',
    use_skip_indexes: '0',
    use_query_condition_cache: '0',
  }
}

export function toDisplaySql(query: string, params: Record<string, string>, mode: IndexMode): string {
  let sql = query.trim()
  for (const [key, value] of Object.entries(params)) {
    const v = String(value)
    sql = sql.replace(new RegExp(`\\{${key}:String\\}`, 'g'), `'${v.replace(/'/g, "\\'")}'`)
    sql = sql.replace(new RegExp(`\\{${key}:(?:U?Int|Float)\\d*\\}`, 'g'), v)
  }
  const s = indexSettings(mode)
  const settingsStr = Object.entries(s).map(([k, v]) => `    ${k} = ${v}`).join(',\n')
  return sql + `\nSETTINGS\n${settingsStr}`
}

// ── Progress ─────────────────────────────────────────────────────────────────

export interface Progress {
  readRows: number
  totalRows: number
}

export function fmtRows(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

// ── Core streaming query ──────────────────────────────────────────────────────

export async function chStream<T>(
  query: string,
  params: Record<string, string>,
  mode: IndexMode,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ rows: T[]; elapsed: string; sql: string }> {
  const sql = toDisplaySql(query, params, mode)
  const settings = indexSettings(mode)

  const urlParams = new URLSearchParams({ user: CH_USER, password: CH_PASSWORD, database: CH_DB, ...settings })
  for (const [key, value] of Object.entries(params)) {
    urlParams.set(`param_${key}`, String(value))
  }

  const start = performance.now()
  const response = await fetch(`${CH_URL}/?${urlParams}`, {
    method: 'POST',
    body: query.trim() + '\nFORMAT JSONEachRowWithProgress',
    signal,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const rows: T[] = []
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nlIdx: number
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).trim()
      buffer = buffer.slice(nlIdx + 1)
      if (!line) continue
      try {
        const obj = JSON.parse(line)
        if ('progress' in obj) {
          onProgress({
            readRows: Number(obj.progress.read_rows),
            totalRows: Number(obj.progress.total_rows_to_read),
          })
        } else if ('row' in obj) {
          rows.push(obj.row as T)
        }
      } catch { /* skip malformed lines */ }
    }
  }

  return { rows, elapsed: ((performance.now() - start) / 1000).toFixed(2), sql }
}
