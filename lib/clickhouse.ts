import { createClient } from '@clickhouse/client'

export type IndexMode = 'fts' | 'bloom' | 'full_scan'

/** Build the WHERE body condition + query params for any index mode. */
export function bodyCondition(term: string, op: string, mode: IndexMode): {
  condition: string
  params: Record<string, string>
} {
  const tokens = term.split(/\s+/).filter(Boolean)

  if (mode === 'fts') {
    const fn = op === 'all' ? 'hasAllTokens' : 'hasAnyTokens'
    return { condition: `${fn}(body, {term:String})`, params: { term } }
  }

  // bloom and full_scan both work on lower(body), so tokens are lowercased
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

  // full_scan: hasToken on lower(body)
  if (lower.length === 1) {
    return { condition: `hasToken(lower(body), {term:String})`, params: { term: lower[0] } }
  }
  const params = Object.fromEntries(lower.map((t, i) => [`t${i}`, t]))
  const clauses = lower.map((_, i) => `hasToken(lower(body), {t${i}:String})`)
  return { condition: clauses.join(op === 'all' ? ' AND ' : ' OR '), params }
}

export function indexSettings(mode: IndexMode) {
  if (mode === 'fts') return {
    enable_full_text_index: 1 as const,
    use_skip_indexes: 1 as const,
    use_query_condition_cache: 0 as const,
    query_plan_direct_read_from_text_index: 1 as const,
    use_skip_indexes_on_data_read: 1 as const,
  }
  if (mode === 'bloom') return {
    enable_full_text_index: 0 as const,
    use_skip_indexes: 1 as const,
    use_query_condition_cache: 0 as const,
  }
  /* full_scan */ return {
    enable_full_text_index: 0 as const,
    use_skip_indexes: 0 as const,
    use_query_condition_cache: 0 as const,
  }
}

/** Produce a human-readable SQL string with params substituted and SETTINGS appended. */
export function toDisplaySql(
  query: string,
  params: Record<string, string>,
  indexMode: IndexMode,
): string {
  let sql = query.trim()
  for (const [key, value] of Object.entries(params)) {
    sql = sql.replace(new RegExp(`\\{${key}:String\\}`, 'g'), `'${value.replace(/'/g, "\\'")}'`)
    sql = sql.replace(new RegExp(`\\{${key}:(?:U?Int|Float)\\d*\\}`, 'g'), value)
  }
  const s = indexSettings(indexMode)
  const settingsStr = Object.entries(s).map(([k, v]) => `    ${k} = ${v}`).join(',\n')
  sql += `\nSETTINGS\n${settingsStr}`
  return sql
}

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'https://sql-clickhouse.clickhouse.com',
  username: process.env.CLICKHOUSE_USER ?? 'demo',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DB ?? 'github',
  request_timeout: 300_000, // 5 min — queries are slow without inverted index
  clickhouse_settings: {
    max_result_rows: '1000',
    enable_full_text_index: 1,
    query_plan_direct_read_from_text_index: 1,
    use_skip_indexes_on_data_read: 1,
    enable_parallel_replicas: 1,
  },
})
