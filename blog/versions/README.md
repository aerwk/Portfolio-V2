# Blog version variants

Every post in here exists in three versions. **Only the summary is published.**

| File | Length | Published? | What it is |
|---|---|---|---|
| `<date>.original.md` | no limit (~1000 words) | **no** | Full context. Issues, troubleshooting, paths taken, what was wrong, how it was worked around. Leads with the mistakes. |
| `<date>.summary.md` | **≤ 500 words** | **yes** — this is what ships | Orthodox blog register. Leads with what was completed, how, and what was used. Errors mentioned briefly rather than structurally. |
| `<date>.tldr.md` | **≤ 100 words**, target 50 | **no** | What happened and why it mattered. Prose, no headings, no bullets. |

## How the published page is produced

`blog/posts/<date>.html` is generated from the **summary** body with the
**original's** frontmatter, so title, date, time, day, excerpt, category, tags
and `claude_pct` are identical across all three versions. Only the prose and the
derived read-time differ.

To rebuild after editing a summary:

    python3 scripts/reconstruct_journals.py <staging-dir>
    # overwrite the affected dates in <staging-dir> with: original frontmatter + summary body
    rm blog/posts/<date>.html
    JOURNALS_DIR=<staging-dir> python3 scripts/build_blog.py

Then confirm the blast radius is nav-only on every other post:

    git diff -- blog/posts ':(exclude)blog/posts/<date>.html' \
      | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -v 'postfoot\|btn-ghost'

That must print nothing. See CLAUDE.md → Current Status for why
`build_blog.py` must never be pointed at the real journals directory.

## Why this folder is not published

`blog/versions/` is in `.vercelignore`. Vercel serves every static file it is
handed, so without that line these would be fetchable as raw markdown at
`/blog/versions/<date>.original.md`. It is tracked in git deliberately — held
back from the deploy, not from version control.

The intent is that the **v3 redesign** ships a switcher on each post —
`tl;dr | summary | original` — with summary as the default view. When that
lands, the original and tl;dr get published through it. Until then they stay
here. Do not wire them into the current design.

## Scope

Applied so far to **September 2026 only** (2026-09-04 … 2026-09-08), which was
a deliberate limit to keep the first pass small. Earlier posts have no variants
yet and still publish their full-length original as the only version. Extending
backwards means generating a summary and a tl;dr per post, then rebuilding that
post the same way.

## The vault journal

The vault journal at `01 Journals/2026 Journals/09 September/<date>.md` holds the
**original**, not the summary. That is the honest record of the day and should
stay that way. `<date>.original.md` here is its copy.
