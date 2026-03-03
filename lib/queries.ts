// SQL query builders for all data sections (client-side, no server deps)
import { bodyCondition, IndexMode, CH_DB, CH_TABLE } from './ch-stream'

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

export function buildReposQuery(
  term: string, op: string, mode: IndexMode, since: string, qmode: string
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const eventFilter = qmode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`
  return {
    sql: `SELECT
  repo_name,
  dictGet('${CH_DB}.repo_name_to_id_dict', 'repo_id', cityHash64(repo_name)) AS repo_id,
  count() AS mentions
FROM ${CH_DB}.${CH_TABLE}
WHERE
  ${eventFilter}
  AND ${body.condition}
  AND ${dateFilter}
GROUP BY repo_name
ORDER BY mentions DESC
LIMIT 20`,
    params: body.params,
  }
}

export function buildHistogramQuery(
  term: string, op: string, mode: IndexMode, since: string, qmode: string
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const bucketFn    = BUCKET_FN[since] ?? 'toStartOfMonth'
  const eventFilter = qmode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`
  return {
    sql: `SELECT
  ${bucketFn}(created_at) AS bucket,
  count() AS count
FROM ${CH_DB}.${CH_TABLE}
WHERE
  ${eventFilter}
  AND ${body.condition}
  AND ${dateFilter}
GROUP BY bucket
ORDER BY bucket ASC`,
    params: body.params,
    granularity: bucketFn,
  }
}

export function buildContributorsQuery(
  term: string, op: string, mode: IndexMode, since: string,
  repoId: string, excludeBots: boolean
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const botFilter  = excludeBots
    ? `AND actor_login NOT LIKE '%[bot]%'\n  AND actor_login NOT LIKE '%-bot'`
    : ''
  return {
    sql: `SELECT
  actor_login,
  countIf(event_type = 'IssuesEvent')                                            AS issues,
  countIf(event_type = 'PullRequestEvent')                                       AS prs,
  countIf(event_type IN ('IssueCommentEvent','PullRequestReviewCommentEvent'))    AS comments,
  count()                                                                         AS total
FROM ${CH_DB}.${CH_TABLE}
WHERE
  repo_id = {repo_id:String}
  AND event_type IN ('IssueCommentEvent','IssuesEvent','PullRequestEvent','PullRequestReviewCommentEvent')
  AND ${body.condition}
  AND ${dateFilter}
  ${botFilter}
GROUP BY actor_login
ORDER BY total DESC
LIMIT 10`,
    params: { repo_id: repoId, ...body.params },
  }
}

export function buildPrsQuery(
  term: string, op: string, mode: IndexMode, since: string,
  repoId: string, qmode: string
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const outerEvent  = qmode === 'prs' ? `'PullRequestEvent'` : `'IssuesEvent'`
  const innerEvents = qmode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`
  return {
    sql: `SELECT
  e.number,
  any(e.title)       AS title,
  any(e.actor_login) AS actor_login,
  min(e.created_at)  AS created_at,
  any(e.comments)    AS comments,
  any(e.state)       AS state,
  m.mentions
FROM ${CH_DB}.${CH_TABLE} AS e
INNER JOIN (
  SELECT number, count() AS mentions
  FROM ${CH_DB}.${CH_TABLE}
  WHERE
    repo_id = {repo_id:String}
    AND ${innerEvents}
    AND ${body.condition}
    AND ${dateFilter}
  GROUP BY number
  ORDER BY mentions DESC
  LIMIT 20
) AS m ON e.number = m.number
WHERE
  e.repo_id = {repo_id:String}
  AND e.event_type = ${outerEvent}
GROUP BY e.number, m.mentions
ORDER BY m.mentions DESC`,
    params: { repo_id: repoId, ...body.params },
  }
}
