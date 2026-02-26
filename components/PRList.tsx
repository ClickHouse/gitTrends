'use client'

interface Issue {
  number: number
  title: string
  actor_login: string
  created_at: string
  comments: number
  state: string
}

interface IssueListProps {
  prs: Issue[]
  repo: string
  mode: 'issues' | 'prs'
}

export default function IssueList({ prs, repo, mode }: IssueListProps) {
  if (prs.length === 0) {
    return (
      <p className="text-center text-ch-muted py-8 text-sm">
        No {mode === 'issues' ? 'issues' : 'pull requests'} found for this search.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-full pr-1">
      {prs.map((issue) => {
        const date = new Date(issue.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        const isOpen = issue.state === 'open'
        const issueUrl = `https://github.com/${repo}/${mode === 'prs' ? 'pull' : 'issues'}/${issue.number}`

        return (
          <a
            key={`${issue.number}-${issue.created_at}`}
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-ch-border bg-ch-gray hover:border-[#FAFF6966] transition-colors p-3 group"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${
                  isOpen ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white group-hover:text-ch-yellow leading-snug line-clamp-2">
                  {issue.title}
                </p>
                <p className="mt-1 text-xs text-ch-muted">
                  #{issue.number} · {issue.actor_login} · {date}
                </p>
                <div className="mt-1.5 flex gap-3 text-xs text-ch-muted">
                  <span title="Comments">💬 {issue.comments}</span>
                  <span className={isOpen ? 'text-green-400' : 'text-red-400'}>
                    {isOpen ? 'open' : 'closed'}
                  </span>
                </div>
              </div>
            </div>
          </a>
        )
      })}
    </div>
  )
}
