# GitTrends — GitHub trends analysis powered by ClickHouse

GitTrends lets you search and compare how any topic, technology, or keyword trends across **10 billion+ GitHub events** — issues, pull requests, and comments — in real time.

It is a demo of [ClickHouse full-text search capabilities](https://clickhouse.com/docs/engines/table-engines/mergetree-family/textindexes), showing the performance difference between an **inverted index (FTS)**, a **token bloom filter**, and a raw **full table scan** on the same dataset.

<img width="1919" height="948" alt="CleanShot 2026-03-06 at 10 26 19" src="https://github.com/user-attachments/assets/c55aa3e4-2ca4-4ab7-9701-88112ee8d62e" />

---

## Features

- **Multi-term comparison** — search up to 4 keywords simultaneously and see their mention trends overlaid on a single chart, Google Trends style
- **Mentions over time** — resizable histogram (daily / weekly / monthly buckets depending on the selected range)
- **Top Repos** — bubble chart grouped by GitHub organisation, sized by mention count
- **Top Contributors** — stacked bar chart of issues, PRs, and comments per author for any selected repo
- **Top Issues / PRs** — ranked lists of the most-mentioned issues and pull requests for any selected repo
- **Index mode toggle** — switch between FTS (inverted index), Bloom filter, and full scan to compare query times live
- **Repo filter** — narrow all queries to one or more specific repositories
- **URL persistence** — search terms are stored in `?q=` query params, making results shareable

---

## Architecture

The app is a **Next.js 15** single-page application that queries ClickHouse directly from the browser using the HTTP API with the `JSONEachRowWithProgress` streaming format. This allows live row-scan progress updates while results stream in.

```
Browser  →  ClickHouse HTTP API  (lib/ch-stream.ts, JSONEachRowWithProgress)
```

There is no server-side data layer — all queries run directly from the browser.

### Key files

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Main SPA — all state, query orchestration, and layout |
| `lib/ch-stream.ts` | Browser-compatible ClickHouse streaming client |
| `lib/queries.ts` | SQL query builders for all data sections |
| `components/Histogram.tsx` | ECharts multi-series line / bar chart |
| `components/PackedBubbleChart.tsx` | D3 packed bubble chart with collision layout |
| `components/ContributorsChart.tsx` | ECharts horizontal stacked bar chart |
| `components/PRList.tsx` | Issues / PR ranked list |

### Tech stack

- [Next.js 15](https://nextjs.org) + React 19
- [ClickHouse JS client](https://github.com/ClickHouse/clickhouse-js) + [@clickhouse/click-ui](https://github.com/ClickHouse/click-ui)
- [ECharts](https://echarts.apache.org) via `echarts-for-react`
- [D3 hierarchy](https://github.com/d3/d3-hierarchy) for the bubble chart layout
- Tailwind CSS + Inter font

---

## Dataset

The default dataset is the public `github.github_events` table on [sql.clickhouse.com](https://sql.clickhouse.com), which contains every public GitHub event since 2011. It is freely accessible with the `demo` user (no password required).

The table has a full-text inverted index on the `body` column, allowing sub-second keyword searches across 10B+ rows. The app lets you compare that against a token bloom filter and a full table scan on the same query.

---

## Running locally

### Prerequisites

- Node.js 18+ and npm
- Access to a ClickHouse instance (the public demo works out of the box — no sign-up required)

### 1. Clone the repository

```bash
git clone https://github.com/ClickHouse/gittrends.git
cd gittrends
```

### 2. Install dependencies

The project requires `--legacy-peer-deps` because `@clickhouse/click-ui` declares a React 18 peer dependency while the app uses React 19.

```bash
npm install --legacy-peer-deps
```

### 3. Configure environment variables

Copy the example env file:

```bash
cp .env.example .env.local
```

The defaults in `.env.example` point to the public ClickHouse demo instance, so **no changes are needed** to run the app against the public dataset.

If you want to run against your own ClickHouse instance, edit `.env.local`:

```env
NEXT_PUBLIC_CLICKHOUSE_URL=https://sql-clickhouse.clickhouse.com
NEXT_PUBLIC_CLICKHOUSE_USER=demo
NEXT_PUBLIC_CLICKHOUSE_PASSWORD=
NEXT_PUBLIC_CLICKHOUSE_DB=github
NEXT_PUBLIC_CLICKHOUSE_TABLE=github_events
```

> **Note:** `NEXT_PUBLIC_*` variables are embedded in the client-side JavaScript bundle and are visible to anyone who inspects your site. Use a dedicated read-only ClickHouse user with no write permissions.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Production build

```bash
npm run build
npm start
```

---

## Using your own data

The SQL queries in `lib/queries.ts` expect a table with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `event_type` | String | `IssuesEvent`, `PullRequestEvent`, `IssueCommentEvent`, `PullRequestReviewCommentEvent`, `PullRequestReviewEvent` |
| `repo_name` | String | `owner/repo` format |
| `repo_id` | UInt64 | Numeric repository ID |
| `created_at` | DateTime | Event timestamp |
| `body` | String | Issue / PR / comment body text |
| `title` | String | Issue or PR title |
| `number` | UInt32 | Issue or PR number |
| `actor_login` | String | GitHub username of the actor |
| `comments` | UInt32 | Comment count |
| `state` | String | `open` or `closed` |

The full-text index on `body` is what makes FTS mode fast. Without it, queries fall back to full scans.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
