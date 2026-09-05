# Development timeline

A rough accounting of how long this project actually took, derived from git
commit timestamps (the most reliable record available) rather than from
memory or a time-tracking tool.

## Calendar span

- First commit: **2026-08-15** (the original idea/spec)
- Last pre-1.0 commit: **2026-09-04** (Cloudflare Pages deploy workflow)
- Total calendar span: **21 days**
- Days with at least one commit: **13**
- There was one multi-day pause with zero activity: **2026-08-25 to 2026-08-30**
  (6 days)

So, in round numbers: about **3 calendar weeks**, with roughly **1 week** of
that being an inactive gap - call it **2 weeks of actual calendar-time
engagement**.

## Commit activity by day

| Date | Commits | First → last commit (same day) |
|---|---|---|
| 2026-08-15 | 1 | 17:50 → 17:50 |
| 2026-08-16 | 5 | 16:51 → 20:17 |
| 2026-08-17 | 6 | 05:17 → 19:20 |
| 2026-08-18 | 12 | 02:51 → 16:54 |
| 2026-08-19 | 12 | 03:35 → 05:39 |
| 2026-08-22 | 17 | 03:03 → 20:16 |
| 2026-08-23 | 21 | 03:00 → 20:12 |
| 2026-08-24 | 8 | 06:12 → 21:17 |
| *(2026-08-25 to 2026-08-30: no activity)* | | |
| 2026-08-31 | 13 | 07:43 → 20:42 |
| 2026-09-01 | 10 | 03:17 → 17:35 |
| 2026-09-02 | 11 | 04:33 → 20:36 |
| 2026-09-03 | 8 | 07:05 → 17:26 |
| 2026-09-04 | 9 | 08:17 → 17:41 |

**Total: 133 commits across 13 active days.**

## Estimating "actual" hours worked

Summing each active day's first-commit-to-last-commit window gives roughly
**~145 hours** of elapsed wall-clock time across those 13 days. That number
should be read carefully, not taken at face value:

- It measures the *span* between the first and last commit of a day, not
  continuous attention - it includes normal breaks, thinking time, and
  (importantly) time spent waiting on background work.
- A meaningful fraction of that span was spent with autonomous Coder/
  Validator sub-agents doing independent implementation and review work in
  the background (each such task typically took somewhere between 5 and 30
  minutes of real wall-clock time), not continuous human-in-the-loop
  interaction.
- Development was AI-orchestrated throughout: a human owner directing
  scope and design decisions, an orchestrating AI assistant (Claude)
  managing a GitHub Issues/Project-board workflow and dispatching
  autonomous Coder and Validator sub-agents for implementation and
  independent review of essentially every change.

A fair summary: **roughly 2-3 calendar weeks**, **13 genuinely active
working days**, and something in the neighborhood of **60-100 hours** of
actually-engaged time (human + AI combined) once background agent-waiting
time is discounted from the raw ~145-hour span.

## Scale of the result

- **133 commits**
- **~330 GitHub Issues** (Epics and Stories) opened and closed against the
  project board in the original monorepo
  (`IncusLuminis/visualization-studio-tools`) - see
  [`MIGRATION.md`](MIGRATION.md) for why those didn't move with the code
- **1,098 catalog objects** in the final 1.0 scene (820 stars, 228 star
  clusters, 26 molecular clouds, 10 stellar associations, 5 HII regions, 4
  planetary nebulae, 3 supernova remnants, plus the Sun and one reference
  point), out to a real catalog edge of ~3,396 pc
- **3 independent large-scale structure models** (Gould Belt, Radcliffe
  Wave, Local Bubble), each sourced from its own peer-reviewed paper
