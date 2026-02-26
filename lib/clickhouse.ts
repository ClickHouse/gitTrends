import { createClient } from '@clickhouse/client'

export type IndexMode = 'fts' | 'bloom' | 'full_scan'

/** Build the body search condition + query params for bloom filter mode.
 *  Splits the term into individual tokens (tokenbf_v1 rejects multi-word strings). */
export function bloomBodyCondition(term: string, op: string): {
  condition: string
  params: Record<string, string>
} {
  const tokens = term.split(/\s+/).filter(Boolean)
  if (tokens.length === 1) {
    return { condition: `hasTokenCaseInsensitive(body, {term:String})`, params: { term } }
  }
  const params = Object.fromEntries(tokens.map((t, i) => [`t${i}`, t]))
  const clauses = tokens.map((_, i) => `hasTokenCaseInsensitive(body, {t${i}:String})`)
  return { condition: clauses.join(op === 'all' ? ' AND ' : ' OR '), params }
}

export function indexSettings(mode: IndexMode) {
  if (mode === 'fts')   return { enable_full_text_index: 1, query_plan_direct_read_from_text_index: 1, use_skip_indexes_on_data_read: 1 }
  if (mode === 'bloom') return { enable_full_text_index: 0, query_plan_direct_read_from_text_index: 0, use_skip_indexes_on_data_read: 1 }
  /* full_scan */       return { enable_full_text_index: 0, query_plan_direct_read_from_text_index: 0, use_skip_indexes_on_data_read: 0 }
}

/** Produce a human-readable SQL string for the ClickHouse playground.
 *  Substitutes named params and appends the SETTINGS clause. */
export function toDisplaySql(
  query: string,
  params: Record<string, string>,
  indexMode: IndexMode,
): string {
  let sql = query.trim()
  for (const [key, value] of Object.entries(params)) {
    // String params get single-quoted; numeric types (UInt*/Int*/Float*) are unquoted
    sql = sql.replace(new RegExp(`\\{${key}:String\\}`, 'g'), `'${value.replace(/'/g, "\\'")}'`)
    sql = sql.replace(new RegExp(`\\{${key}:(?:U?Int|Float)\\d*\\}`, 'g'), value)
  }
  const s = indexSettings(indexMode)
  sql += `\nSETTINGS\n    enable_full_text_index = ${s.enable_full_text_index},\n    query_plan_direct_read_from_text_index = ${s.query_plan_direct_read_from_text_index},\n    use_skip_indexes_on_data_read = ${s.use_skip_indexes_on_data_read}`
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
    enable_parallel_replicas: 1
  },
})
