#!/usr/bin/env python3
"""Rebuild journal frontmatter from ALREADY-PUBLISHED post HTML.

Why this exists
---------------
On 2026-08-27 a sweep rewrote most vault journals into ~600-byte stubs, most of
them titled "No work evidenced". The published posts for those days are rich —
the journals regressed, the HTML did not.

That matters because build_blog.py patches every existing post's metadata FROM
its journal on every run: patch_meta() and patch_tags() rewrite the chip time,
day, category, AI percentage, tags, and the prev/next nav titles. Run against
the real journals directory it will happily retitle 34 published posts to
"No work evidenced" and retag them `none-evidenced`. (`--force` is worse: it
regenerates the prose too, destroying the posts outright.)

So: build a staging journals directory whose entries for already-published days
are derived from the published HTML, drop the genuinely new journals in
alongside, and point the generator at that.

    python3 scripts/reconstruct_journals.py <staging-dir>
    cp <new-journals>/*.md <staging-dir>/
    JOURNALS_DIR=<staging-dir> python3 scripts/build_blog.py

Then confirm the blast radius before trusting it:

    git diff blog/posts/ | grep -E '^[+-]' | grep -v '^[+-][+-]' \
        | grep -v 'postfoot\|btn-ghost'

That should print nothing. Anything else means a published post's metadata moved.

The body written here is the post's own prose flattened to text. It is not
faithful Markdown and is not meant to be re-rendered — it exists so read_time()
computes the same figure the post already displays. Never run --force against
this staging directory.
"""
import datetime
import glob
import html
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(REPO, "blog", "posts")

# stripped before the body is flattened to text, so read_time() matches the
# figure already baked into the post
STRIP = (
    r"<script.*?</script>",
    r"<nav class=\"postfoot.*?</nav>",
    r"<div class=\"tagrow.*?</div>",
    r"<div class=\"meta[^\"]*\">.*?</div>",
)


def quote_safe(s):
    """Frontmatter values are double-quoted; no escaping, so swap the quote."""
    return s.replace('"', "'")


def parse_post(raw, date):
    title = re.search(r"<title>(.*?)\s*—\s*N5HQ</title>", raw, re.S)
    title = html.unescape(title.group(1)).strip() if title else date

    # the meta div holds several chips in order: category, date, read time, AI, author
    meta = re.search(r'<div class="meta[^"]*">(.*?)</div>', raw, re.S)
    chips = re.findall(r'<span class="chip">([^<]*)</span>', meta.group(1) if meta else "")
    chips = [html.unescape(c).strip() for c in chips]

    is_date = lambda c: re.match(r"^\d{4}-\d{2}-\d{2}\s*·", c)
    datechip = next((c for c in chips if is_date(c)), None)
    category = next((c for c in chips if not is_date(c) and "min read" not in c), "Homelab")

    day, time24 = "Monday", "00:00"
    if datechip:
        parts = [p.strip() for p in datechip.split("·")]
        if len(parts) >= 3:
            day = parts[1]
            try:
                time24 = datetime.datetime.strptime(parts[2], "%I:%M %p").strftime("%H:%M")
            except ValueError:
                pass  # keep the default rather than guess at an unparseable chip

    ai = re.search(r'badge-ai">(\d+)% AI', raw)
    foot = re.search(r'<div class="tagrow tags-foot".*?</div>', raw, re.S)
    tags = re.findall(r'data-tag="([^"]+)"', foot.group(0)) if foot else ["homelab"]

    exc = (re.search(r'<meta name="description" content="([^"]*)"', raw)
           or re.search(r'<meta property="og:description" content="([^"]*)"', raw))

    body = re.search(r"<article.*?</article>", raw, re.S)
    body = body.group(0) if body else raw
    for pat in STRIP:
        body = re.sub(pat, "", body, flags=re.S)
    prose = html.unescape(re.sub(r"<[^>]+>", "", body)).strip()

    return {
        "title": title,
        "time": time24,
        "day": day,
        "excerpt": html.unescape(exc.group(1)) if exc else title,
        "category": category,
        "tags": tags,
        "claude_pct": ai.group(1) if ai else "50",
        "prose": prose,
    }


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)

    n = 0
    for path in sorted(glob.glob(os.path.join(POSTS, "*.html"))):
        date = os.path.basename(path)[:-5]
        fm = parse_post(open(path, encoding="utf-8").read(), date)
        with open(os.path.join(out, date + ".md"), "w", encoding="utf-8") as fh:
            fh.write(
                f'---\ntitle: "{quote_safe(fm["title"])}"\ndate: {date}\n'
                f'time: "{fm["time"]}"\nday: {fm["day"]}\n'
                f'excerpt: "{quote_safe(fm["excerpt"])}"\n'
                f'category: "{quote_safe(fm["category"])}"\ntags:\n'
                + "".join(f"  - {t}\n" for t in fm["tags"])
                + f'claude_pct: {fm["claude_pct"]}\n---\n\n# {date}\n\n{fm["prose"]}\n'
            )
        n += 1
    print(f"reconstructed {n} journals from published HTML -> {out}")


if __name__ == "__main__":
    main()
