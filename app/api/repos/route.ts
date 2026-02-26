import { NextRequest, NextResponse } from 'next/server'
import { clickhouse, toDisplaySql } from '@/lib/clickhouse'

export const runtime = 'nodejs'
export const maxDuration = 300

const SINCE_SQL: Record<string, string> = {
  '1M':  `created_at >= (now() - toIntervalMonth(1))`,
  '3M':  `created_at >= (now() - toIntervalMonth(3))`,
  '1Y':  `created_at >= (now() - toIntervalYear(1))`,
  'all': `1=1`,
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const term     = searchParams.get('term')?.trim()
  const useIndex = searchParams.get('useIndex') !== 'false'
  const since    = searchParams.get('since') ?? '1M'

  if (!term) {
    return NextResponse.json({ error: 'Missing term' }, { status: 400 })
  }
  const database = process.env.CLICKHOUSE_DB
  const table = process.env.CLICKHOUSE_TABLE ?? 'github_events'
  const dateFilter = SINCE_SQL[since] ?? SINCE_SQL['1M']

  const query = `
    SELECT
      repo_name,
      dictGet(github.repo_name_to_id_dict, 'repo_id', cityHash64(repo_name)) AS repo_id,
      count() AS mentions
    FROM ${database}.${table}
    WHERE
      event_type IN (
        'IssueCommentEvent',
        'IssuesEvent'
      )
      AND hasAnyTokens(body, {term:String})
      AND ${dateFilter}
    GROUP BY repo_name
    ORDER BY mentions DESC
    LIMIT 20
  `

  const sql = toDisplaySql(query, { term }, useIndex)

  try {
    const start = Date.now()
    const result = await clickhouse.query({
      query,
      query_params: { term },
      format: 'JSONEachRow',
      clickhouse_settings: {
        query_plan_direct_read_from_text_index: useIndex ? 1 : 0,
        use_skip_indexes_on_data_read: useIndex ? 1 : 0,
      },
    })
    const rows = await result.json<{ repo_name: string; repo_id: string; mentions: string }>()
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)

    return NextResponse.json({ rows, elapsed, useIndex, sql })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, sql }, { status: 500 })
  }
}
