import { NextRequest, NextResponse } from 'next/server'
import { clickhouse, toDisplaySql, indexSettings, bodyCondition, IndexMode } from '@/lib/clickhouse'

export const runtime = 'nodejs'
export const maxDuration = 300

const SINCE_SQL: Record<string, string> = {
  '1M':  `created_at >= (now() - toIntervalMonth(1))`,
  '3M':  `created_at >= (now() - toIntervalMonth(3))`,
  '1Y':  `created_at >= (now() - toIntervalYear(1))`,
  'all': `1=1`,
}

const BUCKET_FN: Record<string, string> = {
  '1M':  'toStartOfDay',
  '3M':  'toStartOfDay',
  '1Y':  'toStartOfWeek',
  'all': 'toStartOfMonth',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const term      = searchParams.get('term')?.trim()
  const indexMode = (searchParams.get('indexMode') ?? 'fts') as IndexMode
  const since     = searchParams.get('since') ?? '1M'

  if (!term) {
    return NextResponse.json({ error: 'Missing term' }, { status: 400 })
  }

  const mode        = searchParams.get('mode') ?? 'issues'
  const op          = searchParams.get('op') ?? 'all'
  const database    = process.env.CLICKHOUSE_DB
  const table       = process.env.CLICKHOUSE_TABLE ?? 'github_events'
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const bucketFn    = BUCKET_FN[since] ?? 'toStartOfMonth'
  const eventFilter = mode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`

  const body = bodyCondition(term, op, indexMode)

  const query = `
    SELECT
      ${bucketFn}(created_at) AS bucket,
      count() AS count
    FROM ${database}.${table}
    WHERE
      ${eventFilter}
      AND ${body.condition}
      AND ${dateFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `

  const sql = toDisplaySql(query, body.params, indexMode)

  try {
    const start = Date.now()
    const result = await clickhouse.query({
      query,
      query_params: body.params,
      format: 'JSONEachRow',
      clickhouse_settings: indexSettings(indexMode),
    })
    const rows = await result.json<{ bucket: string; count: string }>()
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)

    return NextResponse.json({ rows, elapsed, sql, granularity: bucketFn })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, sql }, { status: 500 })
  }
}
