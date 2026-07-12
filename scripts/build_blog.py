#!/usr/bin/env python3
"""Generate Portfolio V2 blog post pages from vault journal entries.

A blog post = a vault journal entry (01 Journals/.../YYYY-MM-DD.md). This script
turns those journals into the static post pages under blog/posts/ and rebuilds
the blog/index.html post list, keeping prev/next links consistent.

Usage:
    python3 scripts/build_blog.py            # generate any missing posts, refresh index + nav
    python3 scripts/build_blog.py --force    # regenerate every post page from its journal
    JOURNALS_DIR=/path python3 scripts/build_blog.py

Defaults to ../../01 Journals relative to the repo root. No third-party deps.
Existing post prose is never touched unless --force is passed; only the
prev/next nav and the index list are refreshed.
"""
import os
import re
import sys
import html
import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNALS_DIR = os.environ.get("JOURNALS_DIR", os.path.join(REPO, "..", "..", "01 Journals"))
POSTS_DIR = os.path.join(REPO, "blog", "posts")
INDEX = os.path.join(REPO, "blog", "index.html")
HOME = os.path.join(REPO, "index.html")
FORCE = "--force" in sys.argv

CARD_CLASSES = ["rv", "rv-d1", "rv-d2"]
HOME_CARD_CLASSES = ["rv", "rv-d1", "rv-d1", "rv-d2", "rv"]
HOME_POST_COUNT = 5


def parse_journal(path):
    """Return (frontmatter dict, body markdown) or None if not a valid post."""
    raw = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", raw, re.DOTALL)
    if not m:
        return None
    fm_text, body = m.group(1), m.group(2)
    fm = {}
    key = None
    for line in fm_text.splitlines():
        if re.match(r"^\s+-\s", line):  # list item (tags)
            fm.setdefault(key, []).append(line.strip()[2:].strip())
            continue
        km = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if not km:
            continue
        key, val = km.group(1), km.group(2).strip()
        if val == "":
            fm[key] = []  # likely a list to follow
        else:
            fm[key] = val.strip().strip('"').strip("'")
    if "date" not in fm or "title" not in fm:
        return None
    try:
        datetime.date.fromisoformat(str(fm["date"]))
    except ValueError:
        return None
    return fm, body


def esc_attr(s):
    return html.escape(str(s), quote=True)


# slug -> display label; most are title-cased per word, these are special-cased
TAG_OVERRIDES = {"ux": "UX", "unifi": "UniFi", "github-actions": "GitHub Actions", "api": "API", "nas": "NAS", "ssd": "SSD", "usb": "USB", "iptv": "IPTV", "vlan": "VLAN", "vlans": "VLANs", "dns": "DNS", "vpn": "VPN"}


def tag_label(slug):
    if slug in TAG_OVERRIDES:
        return TAG_OVERRIDES[slug]
    return " ".join(w.capitalize() for w in slug.split("-"))


def tagrow_html(tags, foot=False):
    """Row of tag tiles. foot=True is the centered version at the end of a post."""
    if not tags:
        return ""
    chips = "".join(
        f'<a class="tagchip" data-tag="{t}" href="/blog/?tag={t}">{esc_attr(tag_label(t))}</a>'
        for t in tags
    )
    if foot:
        return f'<div class="tagrow tags-foot" aria-label="Tags">{chips}</div>'
    return f'<div class="tagrow">{chips}</div>'


DEFAULT_AUTHOR = "Eric Li"


def format_time(t):
    """'14:32' (AWST, stored 24h) -> '2:32 PM'. Returns '' if absent/invalid."""
    if not t:
        return ""
    try:
        return datetime.datetime.strptime(str(t).strip(), "%H:%M").strftime("%-I:%M %p")
    except ValueError:
        return str(t).strip()


def when_str(fm, with_day=True):
    bits = [fm["date"]]
    if with_day and fm.get("day"):
        bits.append(esc_attr(fm["day"]))
    t = format_time(fm.get("time"))
    if t:
        bits.append(t)
    return " · ".join(bits)


def meta_html(fm, readtime):
    parts = [
        f'<span class="chip">{esc_attr(fm.get("category", "Journal"))}</span>',
        f'<span class="chip">{when_str(fm)}</span>',
        f'<span class="chip">{readtime} min read</span>',
        f'<span class="chip badge-ai">{esc_attr(fm.get("claude_pct", "0"))}% AI</span>',
    ]
    author = fm.get("author", DEFAULT_AUTHOR)
    if author:
        parts.append(f'<span class="chip chip-author">{esc_attr(author)}</span>')
    return '<div class="meta rv on rv-d2">\n      ' + "\n      ".join(parts) + "\n    </div>"


def inline(text):
    """Inline markdown -> HTML on already &<>-escaped text."""
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)  # [[a|b]] -> b
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)              # [[a]]   -> a
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"<em>\1</em>", text)
    return text


def md_to_html(body):
    """Minimal markdown -> prose HTML for the journal format."""
    lines = body.split("\n")
    out, para, in_list = [], [], False

    def flush_para():
        nonlocal para
        if para:
            out.append("<p>" + inline(html.escape(" ".join(para), quote=False)) + "</p>")
            para = []

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for line in lines:
        s = line.strip()
        if not s:
            flush_para()
            close_list()
            continue
        if s.startswith("# "):          # body title (date) — skip, lives in hero
            continue
        h = re.match(r"^(#{2,3})\s+(.*)$", s)
        if h:
            flush_para()
            close_list()
            tag = "h2" if len(h.group(1)) == 2 else "h3"
            out.append(f"<{tag}>" + inline(html.escape(h.group(2), quote=False)) + f"</{tag}>")
            continue
        task = re.match(r"^-\s+\[( |x|X)\]\s+(.*)$", s)
        if task:
            flush_para()
            if not in_list:
                out.append('<ul>')
                in_list = True
            cls = "task-done" if task.group(1).lower() == "x" else "task-open"
            out.append(f'<li class="{cls}">' + inline(html.escape(task.group(2), quote=False)) + "</li>")
            continue
        item = re.match(r"^-\s+(.*)$", s)
        if item:
            flush_para()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append("<li>" + inline(html.escape(item.group(1), quote=False)) + "</li>")
            continue
        para.append(s)

    flush_para()
    close_list()
    return "\n".join(out)


def read_time(body):
    words = len(re.sub(r"[#*`\[\]()_>-]", " ", body).split())
    return max(1, round(words / 200))


def nav_html(older, newer):
    left = (f'<a class="btn btn-ghost" href="/blog/posts/{older["date"]}.html">'
            f'← {esc_attr(older["title"])}</a>') if older else "<span></span>"
    right = (f'<a class="btn btn-ghost" href="/blog/posts/{newer["date"]}.html">'
             f'{esc_attr(newer["title"])} →</a>') if newer else "<span></span>"
    return ('<nav class="postfoot rv on" aria-label="Post navigation">\n'
            f'      {left}\n      {right}\n    </nav>')


POST_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — N5HQ</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css?v=d3">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="nav" aria-label="Primary">
  <div class="nav-in">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span><span><span class="be">ERIC</span>LI</span></a>
    <nav aria-label="Sections" style="display:contents">
      <ul class="nav-links">
        <li><a href="/#about">About</a></li>
        <li><a href="/#portfolio">Portfolio</a></li>
        <li><a href="/blog/">Blog</a></li>
      </ul>
    </nav>
    <a class="btn btn-violet nav-cta" href="/#contact">Contact <span class="arr" aria-hidden="true">↗</span></a>
  </div>
</header>

<main id="main">
<section class="hero hero-sm" aria-label="Post header">
  <div class="wrap hero-in posthead">
    <a class="crumb rv on" href="/blog/">← The Journey</a>
    <h1 class="rv on rv-d1">{title}</h1>
    {meta}
  </div>
</section>
<article class="band band-tight">
  <div class="wrap">
    <div class="prose rv on rv-d3">
{prose}
    </div>
    {tags}
    {nav}
  </div>
</article>
</main>

<footer class="footer">
  <div class="wrap">
    <div class="foot-card">
      <div class="foot-top">
        <div class="foot-brand">
          <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>N5HQ</a>
          <p>Full-Stack &amp; Infrastructure — web apps, firewalls, VLANs, and enterprise systems.</p>
        <div class="foot-socials" aria-label="Social links">
          <a href="https://github.com/aerwk" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>GitHub</a>
          <a href="https://www.linkedin.com/in/eric-li-90a0a3163/" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>LinkedIn</a>
          <a href="https://instagram.com/ericliyk" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>Instagram</a>
        </div>
        </div>
        <div class="foot-note">
          <p>Self-hosted homelab running 24/7 — personal infrastructure.</p>
          <a class="foot-lab" href="/lab/">Lab dashboard →</a>
        </div>
      </div>
      <div class="foot-bottom">
        <nav class="foot-links" aria-label="Footer">
          <a href="/#about">About</a>
          <a href="/#portfolio">Portfolio</a>
          <a href="/blog/">Blog</a>
          <a href="/#contact">Contact</a>
        </nav>
        <p class="foot-legal">© 2026 N5HQ. All rights reserved.</p>
      </div>
    </div>
  </div>
</footer>

<script>
(() => {{
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('.rv:not(.on)');
  if (reduce || !('IntersectionObserver' in window)) {{ els.forEach(el => el.classList.add('on')); return; }}
  const io = new IntersectionObserver(entries => {{
    entries.forEach(e => {{ if (e.isIntersecting) {{ e.target.classList.add('on'); io.unobserve(e.target); }} }});
  }}, {{ rootMargin: '0px 0px -8% 0px', threshold: 0.05 }});
  els.forEach(el => io.observe(el));
}})();
</script>
</body>
</html>
"""


def render_post(fm, body, older, newer):
    return POST_TEMPLATE.format(
        title=esc_attr(fm["title"]),
        desc=esc_attr(fm.get("excerpt", "")),
        date=fm["date"],
        meta=meta_html(fm, read_time(body)),
        prose=md_to_html(body), tags=tagrow_html(fm.get("tags", []), foot=True),
        nav=nav_html(older, newer),
    )


def patch_nav(path, older, newer):
    txt = open(path, encoding="utf-8").read()
    new = re.sub(r'<nav class="postfoot.*?</nav>', nav_html(older, newer), txt, flags=re.DOTALL)
    if new != txt:
        open(path, "w", encoding="utf-8").write(new)
        return True
    return False


def patch_tags(path, fm):
    """Insert or refresh the tag row at the end of an existing post page."""
    row = tagrow_html(fm.get("tags", []), foot=True)
    if not row:
        return False
    txt = open(path, encoding="utf-8").read()
    if re.search(r'<div class="tagrow tags-foot".*?</div>', txt, re.DOTALL):
        new = re.sub(r'<div class="tagrow tags-foot".*?</div>', row, txt, flags=re.DOTALL)
    else:
        new = txt.replace('    <nav class="postfoot', "    " + row + '\n    <nav class="postfoot', 1)
    if new != txt:
        open(path, "w", encoding="utf-8").write(new)
        return True
    return False


def patch_meta(path, fm):
    """Refresh the meta row (date, time, read time, AI %, author) on an existing post."""
    txt = open(path, encoding="utf-8").read()
    m = re.search(r'(\d+) min read', txt)
    readtime = m.group(1) if m else read_time("")
    new = re.sub(r'<div class="meta[^"]*">.*?</div>', meta_html(fm, readtime), txt, count=1, flags=re.DOTALL)
    if new != txt:
        open(path, "w", encoding="utf-8").write(new)
        return True
    return False


def stamp_time(journal_path, t):
    """Persist a publish time into a journal's frontmatter (once)."""
    s = open(journal_path, encoding="utf-8").read()
    if re.search(r'^time:', s, re.M):
        return
    s2 = re.sub(r'^(date:.*)$', r'\1\ntime: "' + t + '"', s, count=1, flags=re.M)
    open(journal_path, "w", encoding="utf-8").write(s2)


def build_index(posts):
    cards = []
    for i, fm in enumerate(posts):
        cls = CARD_CLASSES[min(i, len(CARD_CLASSES) - 1)]
        tags = fm.get("tags", [])
        cards.append(
            f'      <li class="postcard {cls}" data-tags="{esc_attr(" ".join(tags))}">\n'
            f'        <span class="postmeta"><span class="cat">{esc_attr(fm.get("category","Journal"))}</span>'
            f'<span>{when_str(fm, with_day=False)}</span></span>\n'
            f'        <h3><a class="stretch" href="/blog/posts/{fm["date"]}.html">{esc_attr(fm["title"])}</a></h3>\n'
            f'        <p>{esc_attr(fm.get("excerpt",""))}</p>\n'
            f"        {tagrow_html(tags)}\n"
            f"      </li>"
        )
    block = '<ul class="posts">\n' + "\n".join(cards) + "\n    </ul>"
    txt = open(INDEX, encoding="utf-8").read()
    new = re.sub(r'<ul class="posts">.*?</ul>', block, txt, flags=re.DOTALL)
    open(INDEX, "w", encoding="utf-8").write(new)


def build_home(posts):
    """Refresh the latest-posts grid in the home page blog section.

    Replaces the five post cards with the newest entries and keeps the
    trailing call-to-action card. The home grid markup differs from the
    blog index, so it is built separately rather than reusing build_index.
    """
    if not os.path.exists(HOME):
        return False
    cards = []
    for i, fm in enumerate(posts[:HOME_POST_COUNT]):
        cls = HOME_CARD_CLASSES[min(i, len(HOME_CARD_CLASSES) - 1)]
        cards.append(
            f'      <li><a class="postcard {cls}" href="/blog/posts/{fm["date"]}.html">\n'
            f'        <span class="postmeta"><span class="cat">{esc_attr(fm.get("category","Journal"))}</span>'
            f'<span>{fm["date"]}</span></span>\n'
            f'        <h3>{esc_attr(fm["title"])}</h3>\n'
            f'        <p>{esc_attr(fm.get("excerpt",""))}</p>\n'
            f"      </a></li>"
        )
    cta = (
        '      <li class="rv rv-d2"><span class="postcard postcard-cta">\n'
        "        <h3>Blog</h3>\n"
        '        <a class="btn btn-violet" href="/blog/">Read All Posts '
        '<span class="arr" aria-hidden="true">↗</span></a>\n'
        "      </span></li>"
    )
    block = '<ul class="posts">\n' + "\n".join(cards) + "\n" + cta + "\n    </ul>"
    txt = open(HOME, encoding="utf-8").read()
    new = re.sub(r'<ul class="posts">.*?</ul>', block, txt, flags=re.DOTALL)
    if new != txt:
        open(HOME, "w", encoding="utf-8").write(new)
        return True
    return False


def main():
    journals = []
    for root, _, files in os.walk(JOURNALS_DIR):
        for f in files:
            if f.endswith(".md"):
                jpath = os.path.join(root, f)
                parsed = parse_journal(jpath)
                if parsed:
                    journals.append((parsed[0], parsed[1], jpath))
    # newest first
    journals.sort(key=lambda p: p[0]["date"], reverse=True)
    if not journals:
        print("No journals found in", JOURNALS_DIR)
        return

    awst_now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%H:%M")
    os.makedirs(POSTS_DIR, exist_ok=True)
    for i, (fm, body, jpath) in enumerate(journals):
        newer = journals[i - 1][0] if i > 0 else None
        older = journals[i + 1][0] if i + 1 < len(journals) else None
        path = os.path.join(POSTS_DIR, f"{fm['date']}.html")
        # stamp a publish time (AWST) the first time a post is generated
        if not fm.get("time") and (FORCE or not os.path.exists(path)):
            fm["time"] = awst_now
            stamp_time(jpath, awst_now)
        if FORCE or not os.path.exists(path):
            open(path, "w", encoding="utf-8").write(render_post(fm, body, older, newer))
            print(("regenerated " if os.path.exists(path) and FORCE else "created    ") + os.path.relpath(path, REPO))
        else:
            changed = patch_nav(path, older, newer)
            changed = patch_tags(path, fm) or changed
            changed = patch_meta(path, fm) or changed
            if changed:
                print("patched    " + os.path.relpath(path, REPO))

    posts = [fm for fm, _, _ in journals]
    build_index(posts)
    print(f"index rebuilt with {len(posts)} posts")
    if build_home(posts):
        print(f"home blog section refreshed (latest {HOME_POST_COUNT})")


if __name__ == "__main__":
    main()
