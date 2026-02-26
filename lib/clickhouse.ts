import { createClient } from '@clickhouse/client'

/** Produce a human-readable SQL string for the ClickHouse playground.
 *  Substitutes named params and appends the SETTINGS clause. */
export function toDisplaySql(
  query: string,
  params: Record<string, string>,
  useIndex: boolean,
): string {
  let sql = query.trim()
  for (const [key, value] of Object.entries(params)) {
    // String params get single-quoted; numeric types (UInt*/Int*/Float*) are unquoted
    sql = sql.replace(new RegExp(`\\{${key}:String\\}`, 'g'), `'${value.replace(/'/g, "\\'")}'`)
    sql = sql.replace(new RegExp(`\\{${key}:(?:U?Int|Float)\\d*\\}`, 'g'), value)
  }
  // sql = sql.replace('FROM github_events', 'FROM github.github_events')
  const v = useIndex ? 1 : 0
  sql += `\nSETTINGS\n    enable_full_text_index = ${v},\n    query_plan_direct_read_from_text_index = ${v},\n    use_skip_indexes_on_data_read = ${v}`
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
  },
})
