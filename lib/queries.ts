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

function repoFilterClause(repos: string[]): { condition: string; params: Record<string, string> } {
  if (repos.length === 0) return { condition: '1=1', params: {} }
  const condition = `repo_name IN (${repos.map((_, i) => `{rf${i}:String}`).join(', ')})`
  const params: Record<string, string> = Object.fromEntries(repos.map((r, i) => [`rf${i}`, r]))
  return { condition, params }
}

export function buildRepoSuggestionsQuery(q: string) {
  return {
    sql: `SELECT repo_name
FROM ${CH_DB}.top_repos
WHERE repo_name ILIKE {q:String}
ORDER BY stars DESC
LIMIT 8`,
    params: { q: `%${q}%` },
  }
}

export function buildReposQuery(
  term: string, op: string, mode: IndexMode, since: string, repoFilter: string[] = []
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const rf = repoFilterClause(repoFilter)
  const eventFilter = `event_type IN ('IssueCommentEvent','IssuesEvent','PullRequestEvent','PullRequestReviewCommentEvent','PullRequestReviewEvent')`
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
  AND ${rf.condition}
GROUP BY repo_name
ORDER BY mentions DESC
LIMIT 20`,
    params: { ...body.params, ...rf.params },
  }
}

export function buildHistogramQuery(
  term: string, op: string, mode: IndexMode, since: string, repoFilter: string[] = []
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const bucketFn    = BUCKET_FN[since] ?? 'toStartOfMonth'
  const rf = repoFilterClause(repoFilter)
  const eventFilter = `event_type IN ('IssueCommentEvent','IssuesEvent','PullRequestEvent','PullRequestReviewCommentEvent','PullRequestReviewEvent')`
  return {
    sql: `SELECT
  ${bucketFn}(created_at) AS bucket,
  count() AS count
FROM ${CH_DB}.${CH_TABLE}
WHERE
  ${eventFilter}
  AND ${body.condition}
  AND ${dateFilter}
  AND ${rf.condition}
GROUP BY bucket
ORDER BY bucket ASC`,
    params: { ...body.params, ...rf.params },
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
LIMIT 8`,
    params: { repo_id: repoId, ...body.params },
  }
}

export function buildPrsQuery(
  term: string, op: string, mode: IndexMode, since: string,
  repoId: string, qmode: string
) {
  const body = bodyCondition(term, op, mode)
  const dateFilter  = SINCE_SQL[since] ?? SINCE_SQL['1M']
  const eventFilter = qmode === 'prs'
    ? `event_type IN ('PullRequestEvent', 'PullRequestReviewCommentEvent', 'PullRequestReviewEvent')`
    : `event_type IN ('IssueCommentEvent', 'IssuesEvent')`
  return {
    sql: `SELECT
  number,
  any(title)       AS title,
  any(actor_login) AS actor_login,
  min(created_at)  AS opened_at,
  any(comments)    AS comments,
  any(state)       AS state,
  count()          AS mentions
FROM ${CH_DB}.${CH_TABLE}
WHERE
  repo_id = {repo_id:String}
  AND ${eventFilter}
  AND ${body.condition}
  AND ${dateFilter}
GROUP BY number
ORDER BY mentions DESC
LIMIT 20`,
    params: { repo_id: repoId, ...body.params },
  }
}
