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
FORCE = "--force" in sys.argv

CARD_CLASSES = ["rv", "rv-d1", "rv-d2"]


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
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="nav" aria-label="Primary">
  <div class="nav-in">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>N5HQ</a>
    <nav aria-label="Sections" style="display:contents">
      <ul class="nav-links">
        <li><a href="/#about">About</a></li>
        <li><a href="/#portfolio">Portfolio</a></li>
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/lab/">Lab</a></li>
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
    <div class="meta rv on rv-d2">
      <span class="chip">{category}</span>
      <span class="chip">{date} · {day}</span>
      <span class="chip">{readtime} min read</span>
      <span class="chip badge-ai">{pct}% AI</span>
    </div>
  </div>
</section>
<article class="band" style="padding-top:0">
  <div class="wrap">
    <div class="prose rv on rv-d3">
{prose}
    </div>
    {nav}
  </div>
</article>
</main>

<footer class="footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>N5HQ</a>
        <p>Full-Stack &amp; Infrastructure — web apps, firewalls, VLANs, and enterprise systems.</p>
      </div>
      <nav class="fcol" aria-label="Footer sections">
        <h4>Sections</h4>
        <ul>
          <li><a href="/#about">About</a></li>
          <li><a href="/#portfolio">Portfolio</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/lab/">Lab</a></li>
          <li><a href="/#contact">Contact</a></li>
        </ul>
      </nav>
      <div class="foot-note">
        <p>Self-hosted homelab running 24/7 — personal infrastructure.</p>
        <a class="foot-lab" href="/lab/">Lab dashboard →</a>
      </div>
    </div>
    <div class="legal"><p>© 2026 N5HQ. All rights reserved.</p></div>
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
        category=esc_attr(fm.get("category", "Journal")),
        date=fm["date"], day=esc_attr(fm.get("day", "")),
        readtime=read_time(body), pct=esc_attr(fm.get("claude_pct", "0")),
        prose=md_to_html(body), nav=nav_html(older, newer),
    )


def patch_nav(path, older, newer):
    txt = open(path, encoding="utf-8").read()
    new = re.sub(r'<nav class="postfoot.*?</nav>', nav_html(older, newer), txt, flags=re.DOTALL)
    if new != txt:
        open(path, "w", encoding="utf-8").write(new)
        return True
    return False


def build_index(posts):
    cards = []
    for i, fm in enumerate(posts):
        cls = CARD_CLASSES[min(i, len(CARD_CLASSES) - 1)]
        cards.append(
            f'      <li><a class="postcard {cls}" href="/blog/posts/{fm["date"]}.html">\n'
            f'        <span class="postmeta"><span class="cat">{esc_attr(fm.get("category","Journal"))}</span>'
            f'<span>{fm["date"]}</span></span>\n'
            f'        <h3>{esc_attr(fm["title"])}</h3>\n'
            f'        <p>{esc_attr(fm.get("excerpt",""))}</p>\n'
            f"      </a></li>"
        )
    block = '<ul class="posts">\n' + "\n".join(cards) + "\n    </ul>"
    txt = open(INDEX, encoding="utf-8").read()
    new = re.sub(r'<ul class="posts">.*?</ul>', block, txt, flags=re.DOTALL)
    open(INDEX, "w", encoding="utf-8").write(new)


def main():
    journals = []
    for root, _, files in os.walk(JOURNALS_DIR):
        for f in files:
            if f.endswith(".md"):
                parsed = parse_journal(os.path.join(root, f))
                if parsed:
                    journals.append(parsed)
    # newest first
    journals.sort(key=lambda p: p[0]["date"], reverse=True)
    if not journals:
        print("No journals found in", JOURNALS_DIR)
        return

    os.makedirs(POSTS_DIR, exist_ok=True)
    for i, (fm, body) in enumerate(journals):
        newer = journals[i - 1][0] if i > 0 else None
        older = journals[i + 1][0] if i + 1 < len(journals) else None
        path = os.path.join(POSTS_DIR, f"{fm['date']}.html")
        if FORCE or not os.path.exists(path):
            open(path, "w", encoding="utf-8").write(render_post(fm, body, older, newer))
            print(("regenerated " if os.path.exists(path) and FORCE else "created    ") + os.path.relpath(path, REPO))
        elif patch_nav(path, older, newer):
            print("nav fixed  " + os.path.relpath(path, REPO))

    build_index([fm for fm, _ in journals])
    print(f"index rebuilt with {len(journals)} posts")


if __name__ == "__main__":
    main()
