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
  const indexMode = (searchParams.get('indexMode') ?? 'fts') as IndexMode
  const since     = searchParams.get('since') ?? '1M'

  if (!term) {
    return NextResponse.json({ error: 'Missing term' }, { status: 400 })
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
  const queryParams = indexMode === 'full_scan' ? { pattern: `%${term}%` } : indexMode === 'bloom' ? bloom.params : { term }

  const query = `
    SELECT
      repo_name,
      dictGet(github.repo_name_to_id_dict, 'repo_id', cityHash64(repo_name)) AS repo_id,
      count() AS mentions
    FROM ${database}.${table}
    WHERE
      ${eventFilter}
      AND ${bodyCondition}
      AND ${dateFilter}
    GROUP BY repo_name
    ORDER BY mentions DESC
    LIMIT 20
  `

  const sql = toDisplaySql(query, indexMode === 'full_scan' ? { pattern: `%${term}%` } : indexMode === 'bloom' ? bloom.params : { term }, indexMode)

  try {
    const start = Date.now()
    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
      clickhouse_settings: indexSettings(indexMode),
    })
    const rows = await result.json<{ repo_name: string; repo_id: string; mentions: string }>()
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)

    return NextResponse.json({ rows, elapsed, indexMode, sql })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, sql }, { status: 500 })
  }
}
