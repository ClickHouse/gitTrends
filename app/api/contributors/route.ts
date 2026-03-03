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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const term      = searchParams.get('term')?.trim()
  const indexMode = (searchParams.get('indexMode') ?? 'fts') as IndexMode
  const since     = searchParams.get('since') ?? '1M'
  const repo_id   = searchParams.get('repo_id')?.trim()
  const excludeBots = searchParams.get('excludeBots') !== 'false'

  if (!term || !repo_id) {
    return NextResponse.json({ error: 'Missing term or repo_id' }, { status: 400 })
  }

  const op          = searchParams.get('op') ?? 'all'
  const database    = process.env.CLICKHOUSE_DB
  const table       = process.env.CLICKHOUSE_TABLE ?? 'github_events'
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const body        = bodyCondition(term, op, indexMode)
  const queryParams = { repo_id, ...body.params }
  const botFilter   = excludeBots
    ? `AND actor_login NOT LIKE '%[bot]%'\n      AND actor_login NOT LIKE '%-bot'`
    : ''

  const query = `
    SELECT
      actor_login,
      countIf(event_type = 'IssuesEvent')                                              AS issues,
      countIf(event_type = 'PullRequestEvent')                                         AS prs,
      countIf(event_type IN ('IssueCommentEvent', 'PullRequestReviewCommentEvent'))     AS comments,
      count()                                                                           AS total
    FROM ${database}.${table}
    WHERE
      repo_id = {repo_id:String}
      AND event_type IN ('IssueCommentEvent', 'IssuesEvent', 'PullRequestEvent', 'PullRequestReviewCommentEvent')
      AND ${body.condition}
      AND ${dateFilter}
      ${botFilter}
    GROUP BY actor_login
    ORDER BY total DESC
    LIMIT 10
  `

  const sql = toDisplaySql(query, queryParams, indexMode)

  try {
    const start = Date.now()
    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
      clickhouse_settings: indexSettings(indexMode),
    })
    const rows = await result.json<{
      actor_login: string
      issues: string
      prs: string
      comments: string
      total: string
    }>()
    const elapsed = ((Date.now() - start) / 1000).toFixed(2)

    return NextResponse.json({ rows, elapsed, sql })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, sql }, { status: 500 })
  }
}
