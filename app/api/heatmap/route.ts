import { NextRequest, NextResponse } from 'next/server'
import { clickhouse, toDisplaySql, indexSettings, bloomBodyCondition, IndexMode } from '@/lib/clickhouse'

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
  const term      = searchParams.get('term')?.trim()
  const repo_id   = searchParams.get('repo_id')?.trim()
  const indexMode = (searchParams.get('indexMode') ?? 'fts') as IndexMode
  const since     = searchParams.get('since') ?? '1M'

  if (!term || !repo_id) {
    return NextResponse.json({ error: 'Missing term or repo_id' }, { status: 400 })
  }
  const mode        = searchParams.get('mode') ?? 'issues'
  const op          = searchParams.get('op') ?? 'any'
  const database    = process.env.CLICKHOUSE_DB
  const table       = process.env.CLICKHOUSE_TABLE ?? 'github_events'
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const eventFilter = mode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`
  const bloom = bloomBodyCondition(term, op)
  const bodyCondition = indexMode === 'full_scan'
    ? `body ILIKE {pattern:String}`
    : indexMode === 'bloom'
    ? bloom.condition
    : op === 'all' ? `hasAllTokens(body, {term:String})` : `hasAnyTokens(body, {term:String})`
  const queryParams = indexMode === 'full_scan' ? { repo_id, pattern: `%${term}%` } : indexMode === 'bloom' ? { repo_id, ...bloom.params } : { term, repo_id }

  const query = `
    SELECT
      toDayOfWeek(created_at) AS day_of_week,
      toHour(created_at)      AS hour,
      count()                 AS cnt
    FROM ${database}.${table}
    WHERE
      repo_id = {repo_id:String}
      AND ${eventFilter}
      AND ${bodyCondition}
      AND ${dateFilter}
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `

  const sql = toDisplaySql(query, indexMode === 'full_scan' ? { repo_id, pattern: `%${term}%` } : indexMode === 'bloom' ? { repo_id, ...bloom.params } : { term, repo_id }, indexMode)

  try {
    const start = Date.now()
    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
      clickhouse_settings: indexSettings(indexMode),
    })
    const rows = await result.json<{ day_of_week: number; hour: number; cnt: string }>()
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)

    return NextResponse.json({ rows, elapsed, sql })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, sql }, { status: 500 })
  }
}
