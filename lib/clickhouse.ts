import { createClient } from '@clickhouse/client'

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
