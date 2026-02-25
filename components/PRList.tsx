'use client'

interface PR {
  number: number
  title: string
  actor_login: string
  created_at: string
  comments: number
  additions: number
  deletions: number
  merged: number
  state: string
}

interface PRListProps {
  prs: PR[]
  repo: string
}

export default function PRList({ prs, repo }: PRListProps) {
  if (prs.length === 0) {
    return (
      <p className="text-center text-ch-muted py-8 text-sm">
        No pull requests found for this search.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-full pr-1">
      {prs.map((pr) => {
        const date = new Date(pr.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        const isMerged = pr.merged === 1
        const isOpen = pr.state === 'open'
        const prUrl = `https://github.com/${repo}/pull/${pr.number}`

        return (
          <a
            key={`${pr.number}-${pr.created_at}`}
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-ch-border bg-ch-gray hover:border-[#FAFF6966] transition-colors p-3 group"
          >
            <div className="flex items-start gap-2">
              {/* PR status dot */}
              <span
                className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${
                  isMerged ? 'bg-purple-400' : isOpen ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white group-hover:text-ch-yellow leading-snug line-clamp-2">
                  {pr.title}
                </p>
                <p className="mt-1 text-xs text-ch-muted">
                  #{pr.number} · {pr.actor_login} · {date}
                </p>
                <div className="mt-1.5 flex gap-3 text-xs text-ch-muted">
                  <span title="Comments">💬 {pr.comments}</span>
                  <span className="text-green-500">+{Number(pr.additions).toLocaleString()}</span>
                  <span className="text-red-400">−{Number(pr.deletions).toLocaleString()}</span>
                  {isMerged && (
                    <span className="text-purple-400">merged</span>
                  )}
                </div>
              </div>
            </div>
          </a>
        )
      })}
    </div>
  )
}
