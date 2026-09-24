#!/usr/bin/env python3
"""Generate the /dev/v3 deployable preview -- or, with --prod, the real
production site -- from the design-loop source.

Eric's "edge draft" redesign (01 Design/design-loop/src) is design source, not
deployable output: every page inlines its wordmark lockup (3 SVGs -- rest,
hover state, and the flashbang-mode hover state, with the hover behaviour
driven by CSS/JS rather than baked-in video clips) as base64, plus a base64
OTF font on the home page, and its internal
links point at the LIVE site's real paths (/, /about/, /portfolio/, /blog/,
/blog/posts/*.html). This script extracts every inlined asset to a real file,
rewrites every internal link to be base-prefixed, and emits the result as a
tracked, deployable tree.

Usage:
    python3 scripts/build_dev_preview.py                # preview at /dev/v3 (default)
    python3 scripts/build_dev_preview.py --base=/dev/v4  # preview at a different prefix
    python3 scripts/build_dev_preview.py --prod          # PRODUCTION build: writes the
                                                           # real site at the repo root
                                                           # (home/index.html, about/,
                                                           # portfolio/, blog/, blog/posts/,
                                                           # assets/, sitemap-ericli.xml)

Idempotent: re-running with the same mode overwrites its output with byte-identical
output (no timestamps, no random ordering). No third-party deps.

Preview source -> output map (base-prefixed, under dev/v3/ or --base):
    p3/home.html      -> {base}/index.html
    p4/about.html     -> {base}/about/index.html
    p4/projects.html  -> {base}/portfolio/index.html
    p4/blog.html      -> {base}/blog/index.html
    (every published post -> {base}/blog/posts/<date>.html, see generate_post_pages)

Prod source -> output map (base="", written at the repo root -- this IS the live
site that Vercel's existing rewrites (`/` -> `/home/index.html`, `/about` ->
`/about/index.html`, `/portfolio` -> `/portfolio/index.html`, `/blog` ->
`/blog/index.html`) already expect):
    p3/home.html      -> REPO/home/index.html       (never REPO/index.html)
    p4/about.html     -> REPO/about/index.html
    p4/projects.html  -> REPO/portfolio/index.html
    p4/blog.html      -> REPO/blog/index.html
    (every published post -> REPO/blog/posts/<date>.html)
"""
import hashlib
import json
import os
import re
import sys
from html import unescape as unescape_entities

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "01 Design", "design-loop", "src")
P3 = os.path.join(SRC, "p3")
P4 = os.path.join(SRC, "p4")
# Historical source of truth for published post bodies is the v2 published
# HTML, now moved out of the served tree to blog/v2/posts/ (2026-09-24
# cutover) -- see the note on generate_post_pages()/extract_published_post().
BLOG_POSTS_DIR = os.path.join(REPO, "blog", "v2", "posts")
POST_SKELETON_PATH = os.path.join(P4, "post.html")

DEFAULT_BASE = "/dev/v3"

# theme-color / og:image used only in --prod mode.
PROD_THEME_COLOR = "#12130f"  # v3's --carbon token (p3/home.html, p4/subpage.css :root)
OG_IMAGE_PATH = os.path.join(REPO, "assets", "og.jpg")
OG_IMAGE_URL = "https://ericli.n5hq.me/assets/og.jpg"
SITE_ORIGIN = "https://ericli.n5hq.me"


def get_pages(prod):
    """(source file, output path relative to the base dir) for the 4 static
    pages. In --prod mode the home page MUST land at home/index.html --
    never REPO/index.html, which would collide with the host-routing rewrite
    (see CLAUDE.md: 'never recreate a root index.html')."""
    if prod:
        return [
            (os.path.join(P3, "home.html"), "home/index.html"),
            (os.path.join(P4, "about.html"), "about/index.html"),
            (os.path.join(P4, "projects.html"), "portfolio/index.html"),
            (os.path.join(P4, "blog.html"), "blog/index.html"),
        ]
    return [
        (os.path.join(P3, "home.html"), "index.html"),
        (os.path.join(P4, "about.html"), "about/index.html"),
        (os.path.join(P4, "projects.html"), "portfolio/index.html"),
        (os.path.join(P4, "blog.html"), "blog/index.html"),
        # post.html retired from PAGES (PHASE 5, 2026-09-11): every published
        # post gets its own generated page -- see generate_post_pages().
        # post.html is still read (POST_SKELETON_PATH) as the shared
        # skeleton, but never written verbatim itself.
    ]


LOGOS_DIR = os.path.join(REPO, "assets", "logos")


def get_static_assets(prod):
    """(source file, output path relative to the base dir) for plain JS/CSS
    assets. In --prod mode the logo set is deliberately excluded: base=""
    means every page's /assets/logos/*.svg reference already resolves
    straight to the real root assets/logos/ directory (which is newer than
    anything here and already includes protonpass.svg), so copying them
    would be redundant self-writes, not new files."""
    assets = [
        (os.path.join(P3, "instruments.js"), "assets/instruments.js"),
        (os.path.join(P3, "hero.js"), "assets/hero.js"),
        (os.path.join(P4, "subpage.css"), "assets/subpage.css"),
        (os.path.join(P4, "subpage.js"), "assets/subpage.js"),
    ]
    if not prod:
        # The /about/ tooling marquee references the site's real logo set by
        # absolute path (/assets/logos/*.svg); base_prefix_internal_links()
        # rewrites that to {base}/assets/logos/*.svg for every emitted page
        # in preview mode, so those files must exist under dev/v3/assets/
        # too, not just at the site root. Glob (not hardcoded names) so a
        # logo added or removed at the site root is reflected automatically.
        assets += [
            (os.path.join(LOGOS_DIR, name), f"assets/logos/{name}")
            for name in sorted(os.listdir(LOGOS_DIR))
            if name.endswith(".svg")
        ]
    return assets


# instruments.css is not a straight copy: its @font-face carries the base64 OTF,
# which gets extracted like the other embedded assets (see extract_font()).
INSTRUMENTS_CSS = os.path.join(P3, "instruments.css")

# Rewrite these relative same-directory references (as they appear literally in
# the source HTML) to absolute {base}-prefixed asset URLs.
LOCAL_REF_REWRITES = {
    'href="instruments.css"': 'href="{base}/assets/instruments.css"',
    'src="instruments.js"': 'src="{base}/assets/instruments.js"',
    'src="hero.js"': 'src="{base}/assets/hero.js"',
    'href="subpage.css"': 'href="{base}/assets/subpage.css"',
    'src="subpage.js"': 'src="{base}/assets/subpage.js"',
}

DATA_URI_RE = re.compile(r'data:[a-zA-Z0-9/+.\-]+;base64,[A-Za-z0-9+/=]+')

GENERATED_COMMENT = (
    "<!-- GENERATED FILE. Produced by scripts/build_dev_preview.py from the design\n"
    "     source in `01 Design/design-loop/src` (gitignored). Do not hand-edit this\n"
    "     file directly -- edit the source and re-run the generator instead. -->"
)


def get_args():
    """Returns (base, prod). --prod forces base="" and ignores --base."""
    prod = "--prod" in sys.argv[1:]
    if prod:
        return "", True
    base = DEFAULT_BASE
    for i, arg in enumerate(sys.argv[1:]):
        if arg.startswith("--base="):
            base = arg.split("=", 1)[1]
        elif arg == "--base" and i + 2 < len(sys.argv):
            base = sys.argv[i + 2]
    base = "/" + base.strip("/")
    return base, False


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def write_binary(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


# A path written once by *this* run of the script; used by write_binary_checked()
# so the safety check below can't flag our own idempotent re-writes within a
# single build.
_WRITTEN_THIS_RUN = set()

# Tracked list (repo-relative) of every asset a previous --prod run wrote.
# Files listed here are ours to overwrite when the design source changes;
# anything else already at the target path is a real root asset (www's lab
# page, 404.html) and must not be clobbered. Rewritten at the end of every
# --prod run from _WRITTEN_THIS_RUN.
OWNED_MANIFEST = os.path.join(REPO, "scripts", "v3-owned-assets.txt")


def read_owned_manifest():
    if not os.path.exists(OWNED_MANIFEST):
        return set()
    with open(OWNED_MANIFEST, encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip() and not line.startswith("#")}


_OWNED_BY_PREVIOUS_RUN = read_owned_manifest()


def write_owned_manifest():
    rels = sorted(os.path.relpath(p, REPO) for p in _WRITTEN_THIS_RUN)
    write(OWNED_MANIFEST,
          "# Generated by scripts/build_dev_preview.py --prod. Assets the v3 build\n"
          "# owns and may overwrite; anything else at these paths is protected.\n"
          + "".join(r + "\n" for r in rels))


def write_binary_checked(path, data):
    """Like write_binary(), but refuses to silently clobber a pre-existing
    file the build does not own, if its content would change. Owned = written
    earlier in this run, or listed in OWNED_MANIFEST by a previous run.
    Used only for STATIC_ASSETS / extracted lockup+font assets in --prod
    mode, where the output directory is the live repo root and a name
    collision with a real root asset would be a real bug, not a rebuild."""
    rel = os.path.relpath(path, REPO)
    owned = path in _WRITTEN_THIS_RUN or rel in _OWNED_BY_PREVIOUS_RUN
    if os.path.exists(path) and not owned:
        with open(path, "rb") as f:
            existing = f.read()
        if existing != data:
            raise SystemExit(
                "refusing to overwrite a pre-existing file with different "
                f"content (not in {os.path.relpath(OWNED_MANIFEST, REPO)}, "
                f"so it looks like a real root asset, not our own output): {rel}"
            )
    write_binary(path, data)
    _WRITTEN_THIS_RUN.add(path)


def write_checked(path, content):
    write_binary_checked(path, content.encode("utf-8"))


# ---------------------------------------------------------------------------
# Asset extraction
# ---------------------------------------------------------------------------

def find_attr_data_uri(html, marker):
    """Find the data: URI immediately following a literal marker string
    (e.g. 'class="lk-rest" src="') in html. Returns the raw data: URI text."""
    i = html.find(marker)
    if i == -1:
        raise SystemExit(f"asset marker not found: {marker!r}")
    start = i + len(marker)
    m = DATA_URI_RE.match(html, start)
    if not m:
        raise SystemExit(f"expected a data: URI right after marker: {marker!r}")
    return m.group(0)


def decode_data_uri(uri, expected_mime=None):
    """Decode a data: URI's payload. If expected_mime is given, fail loudly
    (rather than silently writing the wrong extension) when the URI's declared
    MIME type doesn't match."""
    header, b64 = uri.split(",", 1)
    if expected_mime is not None:
        mime = header[len("data:"):].split(";", 1)[0]
        if mime != expected_mime:
            raise SystemExit(
                f"expected a {expected_mime!r} data: URI, got {mime!r}: {header!r}"
            )
    import base64
    return base64.b64decode(b64)


def extract_lockup_assets(html):
    """Return {asset_filename: raw_bytes} for the three embedded lockup SVGs,
    located by their markup role (not by position) so a reordering of the
    source can't silently mis-map an asset. logo-hover-fb.svg is the
    flashbang-mode hover mark (2026-09-24): same drawing as logo-hover.svg
    but with the violet fill (#5e18eb) swapped for the flashbang accent
    #01bdff and every other fill swapped for its f() (invert+hue-rotate180)
    equivalent -- see p4/subpage.css's flashbang block for f()'s definition.
    The 'class="lk-hover-fb" src="' and 'class="lk-hover" src="' markers are
    each other's full attribute string (not a bare substring -- the closing
    quote lands right after "-fb" vs. right after "hover"), so html.find()
    for either one always lands on its own <img>, in either search order."""
    out = {}
    out["logo-rest.svg"] = decode_data_uri(
        find_attr_data_uri(html, 'class="lk-rest" src="'), expected_mime="image/svg+xml"
    )
    out["logo-hover-fb.svg"] = decode_data_uri(
        find_attr_data_uri(html, 'class="lk-hover-fb" src="'), expected_mime="image/svg+xml"
    )
    out["logo-hover.svg"] = decode_data_uri(
        find_attr_data_uri(html, 'class="lk-hover" src="'), expected_mime="image/svg+xml"
    )
    return out


def replace_lockup_refs(html, base):
    """Swap every embedded lockup data: URI for its extracted {base}/assets/ URL."""
    def sub_attr(html, marker, filename):
        old = find_attr_data_uri(html, marker)
        return html.replace(marker + old, marker + f"{base}/assets/{filename}", 1)

    html = sub_attr(html, 'class="lk-rest" src="', "logo-rest.svg")
    html = sub_attr(html, 'class="lk-hover-fb" src="', "logo-hover-fb.svg")
    html = sub_attr(html, 'class="lk-hover" src="', "logo-hover.svg")
    return html


def extract_font(css_text):
    m = re.search(r'url\(data:font/otf;base64,([A-Za-z0-9+/=]+)\)', css_text)
    if not m:
        raise SystemExit("expected @font-face base64 OTF in instruments.css")
    import base64
    return base64.b64decode(m.group(1))


def replace_font_ref(css_text, base):
    return re.sub(
        r'url\(data:font/otf;base64,[A-Za-z0-9+/=]+\)',
        f"url({base}/assets/bigger-display.otf)",
        css_text,
        count=1,
    )


# ---------------------------------------------------------------------------
# Link rewriting
# ---------------------------------------------------------------------------

# href="/..." or src="/..." but not "//" (protocol-relative) -- these are the
# internal absolute paths that must stay inside the preview.
INTERNAL_ATTR_RE = re.compile(r'(href|src)="(/(?!/)[^"]*)"')


def base_prefix_internal_links(html, base):
    def sub(m):
        attr, path = m.group(1), m.group(2)
        return f'{attr}="{base}{path}"'
    return INTERNAL_ATTR_RE.sub(sub, html)


def rewrite_local_refs(html, base):
    for old, new_tpl in LOCAL_REF_REWRITES.items():
        html = html.replace(old, new_tpl.format(base=base))
    return html


TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)
THEME_COLOR_META_RE = re.compile(r'<meta name="theme-color"[^>]*>\n?')


def canonical_path_for(rel, prod):
    """The site-relative canonical path (e.g. "/about/") for an output's
    rel path (e.g. "about/index.html" in --prod mode)."""
    if not prod:
        return None
    if rel == "home/index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def inject_head_meta(html, prod=False, canonical_path=None):
    """Non-prod (preview): add noindex, as before.

    Prod: strip any pre-existing <meta name="theme-color"> (about/projects/
    blog/post already carry one from the design source; home.html doesn't --
    this makes every emitted page carry exactly one, uniformly), then inject
    canonical, og:url, og:title (= the page's own <title>), og:type
    ("article" for posts, "website" otherwise), og:image (if assets/og.jpg
    exists), twitter:card, the favicon link, and theme-color -- matching the
    tag shapes already shipped on the live v2 posts (blog/v2/posts/*.html)."""
    if not prod:
        return html.replace(
            "</title>", "</title>\n<meta name=\"robots\" content=\"noindex, nofollow\">", 1
        )

    title_m = TITLE_RE.search(html)
    if not title_m:
        raise SystemExit("inject_head_meta: no <title> found")
    title_text = title_m.group(1)

    page_type = "article" if canonical_path.startswith("/blog/posts/") else "website"
    canonical_url = f"{SITE_ORIGIN}{canonical_path}"

    lines = [
        f'<link rel="canonical" href="{canonical_url}">',
        f'<meta property="og:url" content="{canonical_url}">',
        f'<meta property="og:title" content="{title_text}">',
        f'<meta property="og:type" content="{page_type}">',
    ]
    if os.path.exists(OG_IMAGE_PATH):
        lines.append(f'<meta property="og:image" content="{OG_IMAGE_URL}">')
    lines.append('<meta name="twitter:card" content="summary_large_image">')
    lines.append('<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">')
    lines.append(f'<meta name="theme-color" content="{PROD_THEME_COLOR}">')

    html = THEME_COLOR_META_RE.sub("", html)
    block = "\n" + "\n".join(lines)
    return html.replace("</title>", "</title>" + block, 1)


def inject_base_script(html, base):
    """Set window.__N5_BASE before subpage.js runs, so its base-aware regexes
    (see p4/subpage.js) match/build URLs under this prefix. Harmless on pages
    that don't load subpage.js, and harmless in --prod mode (base="")."""
    marker = f'<script src="{base}/assets/subpage.js"></script>'
    if marker not in html:
        return html
    return html.replace(
        marker,
        f'<script>window.__N5_BASE={base!r};</script>\n{marker}',
        1,
    )


def add_generated_comment(html):
    if html.startswith("<!doctype html>"):
        nl = html.index("\n")
        return html[: nl + 1] + GENERATED_COMMENT + "\n" + html[nl + 1 :]
    return GENERATED_COMMENT + "\n" + html


# ---------------------------------------------------------------------------
# Post pages: real bodies for every published post, routed at
# {base}/blog/posts/<date>.html (or, in --prod mode, blog/posts/<date>.html
# at the repo root), plus a regenerated blog.html fixture so the archive
# tree/listing carries every published post.
#
# The ONLY faithful source for post bodies is the published HTML in
# blog/v2/posts/*.html -- div.prose's innerHTML is taken verbatim. Do not
# route this through the vault journals or scripts/reconstruct_journals.py:
# that path flattens <h2>/<strong> to plain text (see pane-swap-plan.md,
# "PHASE 5" / "Body extraction -- the trap").
# ---------------------------------------------------------------------------

POST_DATE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.html$')
H1_TITLE_RE = re.compile(r'<h1 class="rv on rv-d1">(.*?)</h1>', re.S)
META_CHIPS_BLOCK_RE = re.compile(r'<div class="meta rv on rv-d2">(.*?)</div>', re.S)
CHIP_RE = re.compile(r'<span class="chip[^"]*">(.*?)</span>', re.S)
DESCRIPTION_RE = re.compile(r'<meta name="description" content="(.*?)">', re.S)
PROSE_START_RE = re.compile(r'<div class="prose rv on rv-d3">')
TAGROW_START_RE = re.compile(r'<div class="tagrow tags-foot"')

MONTH_ABBR = {
    "01": "JAN", "02": "FEB", "03": "MAR", "04": "APR",
    "05": "MAY", "06": "JUN", "07": "JUL", "08": "AUG",
    "09": "SEP", "10": "OCT", "11": "NOV", "12": "DEC",
}


def html_text_escape(s):
    """Escape plain decoded text for insertion into an HTML text node."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def html_attr_escape(s):
    return html_text_escape(s).replace('"', "&quot;")


def list_published_post_dates():
    dates = []
    for name in os.listdir(BLOG_POSTS_DIR):
        m = POST_DATE_RE.match(name)
        if m:
            dates.append(m.group(1))
    dates.sort(reverse=True)  # ISO date strings sort lexicographically -- newest first
    return dates


def extract_published_post(date):
    """Read blog/v2/posts/<date>.html and pull out everything a v3 post page
    needs, straight from the published markup -- title, chips, and
    div.prose's innerHTML verbatim (see module docstring above)."""
    path = os.path.join(BLOG_POSTS_DIR, f"{date}.html")
    raw = read(path)

    h1_m = H1_TITLE_RE.search(raw)
    if not h1_m:
        raise SystemExit(f"{path}: could not find the post <h1>")
    title = unescape_entities(h1_m.group(1).strip())

    meta_m = META_CHIPS_BLOCK_RE.search(raw)
    if not meta_m:
        raise SystemExit(f"{path}: could not find the .meta chip block")
    chips = [unescape_entities(c.strip()) for c in CHIP_RE.findall(meta_m.group(1))]
    if len(chips) != 5:
        raise SystemExit(f"{path}: expected 5 chips (category/date/read/ai/author), found {len(chips)}: {chips!r}")
    category, date_chip, read_chip, ai_chip, author_chip = chips

    date_parts = [p.strip() for p in date_chip.split("·")]
    if len(date_parts) != 3:
        raise SystemExit(f"{path}: expected 'DATE · DAY · TIME' chip, got {date_chip!r}")
    date_str, day_str, time_str = date_parts

    desc_m = DESCRIPTION_RE.search(raw)
    description = unescape_entities(desc_m.group(1)) if desc_m else ""

    prose_start_m = PROSE_START_RE.search(raw)
    tagrow_m = TAGROW_START_RE.search(raw)
    if not prose_start_m or not tagrow_m or tagrow_m.start() < prose_start_m.end():
        raise SystemExit(f"{path}: could not locate div.prose ... div.tagrow bounds")
    chunk = raw[prose_start_m.end():tagrow_m.start()]
    close_idx = chunk.rfind("</div>")
    if close_idx == -1:
        raise SystemExit(f"{path}: div.prose has no closing </div> before .tagrow-foot")
    prose_html = chunk[:close_idx].strip()
    if not prose_html:
        raise SystemExit(f"{path}: extracted prose body is empty")

    return {
        "date": date,
        "title": title,
        "category": category,
        "date_str": date_str,
        "day_str": day_str,
        "time_str": time_str,
        "read_chip": read_chip,
        "ai_chip": ai_chip,
        "author_chip": author_chip,
        "description": description,
        "prose_html": prose_html,
    }


def load_all_posts():
    """All published posts, newest first -- the single ordered list every
    other piece (blog.html's fixture, each post page's #blog-list-view,
    and prev/next) is derived from."""
    return [extract_published_post(d) for d in list_published_post_dates()]


def post_breadcrumb_html(post):
    """Emit EXACTLY what renderCrumbSegs() in subpage.js (~:520-544) produces
    client-side for a post breadcrumb -- BLOG / year / month as clickable
    `data-crumb-scope` buttons (see the click handler + [data-crumb-scope]
    router hand-off, ~:813-840) and the trailing day as a plain, non-
    interactive span (Defect 1, 2026-09-11). Scope JSON uses
    separators=(',', ':') to match what JSON.stringify() produces
    client-side -- no extra whitespace, since the verify suite does
    byte-identity checks on this markup."""
    year = post["date"][0:4]
    month_num = post["date"][5:7]
    day_num = post["date"][8:10]
    mon = MONTH_ABBR.get(month_num)
    if not mon:
        raise SystemExit(f"post {post['date']!r}: unrecognised month {month_num!r}")
    segs = [
        ("BLOG", {"type": "root"}),
        (year, {"type": "year", "year": year}),
        (mon, {"type": "month", "year": year, "month": month_num}),
        (day_num, None),  # trailing segment: current position, not a link
    ]
    parts = []
    for i, (label, scope) in enumerate(segs):
        if i:
            parts.append('<span aria-hidden="true"> &gt; </span>')
        if scope is not None:
            scope_json = json.dumps(scope, separators=(",", ":"))
            parts.append(
                '<button type="button" class="crumb-seg crumb-link" '
                f"data-crumb-scope='{scope_json}'>{label}</button>"
            )
        else:
            parts.append(f'<span class="crumb-seg crumb-current">{label}</span>')
    return '<nav class="post-crumb label" aria-label="Breadcrumb">' + "".join(parts) + "</nav>"


def post_chips_html(post):
    fields = [
        post["category"], post["date_str"], post["day_str"], post["time_str"],
        post["read_chip"], post["ai_chip"], post["author_chip"],
    ]
    joined = " · ".join(html_text_escape(f) for f in fields)
    return f'<p class="post-chips label">{joined}</p>'


def prevnext_html(posts, idx):
    """Newest-first `posts`: .pn-prev is the OLDER post (idx+1), .pn-next
    the NEWER post (idx-1) -- matches subpage.js:582-612's buildPrevNext.
    Omit the slot's link at either end of the range."""
    older = posts[idx + 1] if idx + 1 < len(posts) else None
    newer = posts[idx - 1] if idx > 0 else None

    def slot(post, label):
        if not post:
            return ""
        return (
            f'<a class="pill" href="/blog/posts/{post["date"]}.html" '
            f'title="{html_attr_escape(post["title"])}">'
            f'<span class="pill-l">{label}</span>'
            f'<span class="pill-c" aria-hidden="true">{label}</span></a>'
        )

    return (
        '<nav class="post-prevnext" aria-label="Post navigation">'
        f'<span class="pn-prev">{slot(older, "‹ Previous")}</span>'
        f'<span class="pn-next">{slot(newer, "Next ›")}</span>'
        '</nav>'
    )


def post_row_html(post):
    meta = f'{html_text_escape(post["category"])} · {post["date"]}'
    return (
        f'<a class="post-row" href="/blog/posts/{post["date"]}.html">'
        f'<span class="post-meta">{meta}</span>'
        f'<span class="post-title">{html_text_escape(post["title"])}</span></a>'
    )


def blog_list_view_html(posts):
    """The hidden #blog-list-view block: blog.html's own data source for
    the archive tree AND (PHASE 5) the same block every generated post page
    must also carry -- see subpage.js's __n5ReadPostRows(), which reads
    whatever #blog-list-view is live in the current document."""
    rows = "\n      ".join(post_row_html(p) for p in posts)
    return (
        '<div id="blog-list-view" hidden>\n'
        '  <p class="label">Blog</p>\n'
        '  <h1 class="page-title">Tech Journey Journal</h1>\n'
        '  <p class="lede">What changed, what prompted it, what broke, and what I learned '
        'getting it working again. Written as I go, so the record shows the route — '
        "where I started, where I am, and where I'm going.</p>\n\n"
        '  <section>\n'
        '    <p class="label">All posts</p>\n'
        '    <div class="post-list">\n'
        f'      {rows}\n'
        '    </div>\n'
        '  </section>\n'
        '  </div>'
    )


def posts_json_html(posts):
    """The #n5-blog-posts JSON payload: category/date/title/summary per
    post, keyed by date. `summary` comes from the published page's own
    <meta name="description"> -- author-written, not invented here."""
    data = {}
    for p in posts:
        entry = {
            "category": p["category"],
            "date": f'{p["date"]} · {p["time_str"]}',
            "title": p["title"],
        }
        if p["description"]:
            entry["summary"] = p["description"]
        data[p["date"]] = entry
    return json.dumps(data, indent=2, ensure_ascii=False)


def find_matching_div_end(html, start_tag_end):
    """Given the index right after an opening <div ...> tag, scan forward
    tracking nested <div> depth and return the index right after the
    matching closing </div>. Robust to reindentation, unlike a fixed-
    indent regex."""
    depth = 1
    i = start_tag_end
    div_open_re = re.compile(r'<div\b')
    div_close_re = re.compile(r'</div>')
    while depth > 0:
        next_open = div_open_re.search(html, i)
        next_close = div_close_re.search(html, i)
        if not next_close:
            raise SystemExit("find_matching_div_end: ran out of </div> while scanning")
        if next_open and next_open.start() < next_close.start():
            depth += 1
            i = next_open.end()
        else:
            depth -= 1
            i = next_close.end()
    return i


def replace_one(html, pattern, replacement, label):
    """Replace the single expected match of `pattern` (re.S) in `html`.
    Fails loudly if the marker is missing or ambiguous, rather than
    silently no-opping or clobbering the wrong occurrence."""
    matches = list(re.finditer(pattern, html, re.S))
    if len(matches) != 1:
        raise SystemExit(f"post skeleton: expected exactly 1 match for {label}, found {len(matches)}")
    m = matches[0]
    return html[:m.start()] + replacement + html[m.end():]


def render_post_page(skeleton, post, posts, idx):
    """Fill post.html's skeleton in for one published post -- title,
    breadcrumb, h1, chips, prev/next, and the article body (verbatim
    prose), plus the hidden #blog-list-view every generated post page
    must carry (see blog_list_view_html)."""
    html = skeleton

    html = replace_one(
        html, r'<title>.*?</title>',
        f'<title>{html_text_escape(post["title"])} — Eric Li</title>',
        "<title>",
    )
    html = replace_one(
        html, r'<nav class="post-crumb label" aria-label="Breadcrumb">.*?</nav>',
        post_breadcrumb_html(post), "breadcrumb nav",
    )
    html = replace_one(
        html, r'<h1 class="post-title-h">.*?</h1>',
        f'<h1 class="post-title-h">{html_text_escape(post["title"])}</h1>',
        "h1.post-title-h",
    )
    html = replace_one(
        html, r'<p class="post-chips label">.*?</p>',
        post_chips_html(post), "p.post-chips",
    )
    html = replace_one(
        html, r'<!-- This is a standalone.*?</nav>',
        prevnext_html(posts, idx), "prev/next nav",
    )
    html = replace_one(
        html, r'<article class="prose">.*?</article>',
        f'<article class="prose">\n{post["prose_html"]}\n  </article>',
        "article.prose",
    )
    html = replace_one(
        html, r'<main class="page" id="main">',
        '<main class="page" id="main">\n  ' + blog_list_view_html(posts) + '\n',
        "<main id=\"main\"> opening tag",
    )
    return html


def landing_template_html(post):
    """The landing <template id="post-tpl-<date>"> in blog.html -- the ONE
    inline template renderFull() (subpage.js:553-560) looks for to render
    the blog index's default "latest post" view. Built from the NEWEST
    published post every run (PHASE 5, task B3) so it can never point at a
    stale post again: same h1 / .post-chips / article.prose shape as
    render_post_page()'s output, reusing post_chips_html() so the two never
    drift, and the verbatim prose body from extract_published_post()."""
    return (
        f'<template id="post-tpl-{post["date"]}">\n'
        f'  <h1>{html_text_escape(post["title"])}</h1>\n'
        f'  {post_chips_html(post)}\n\n'
        '  <article class="prose">\n'
        f'{post["prose_html"]}\n'
        '  </article>\n'
        '  </template>'
    )


def update_blog_html(posts):
    """Sync the SOURCE p4/blog.html fixture (its #blog-list-view a.post-row
    rows, the #n5-blog-posts JSON, and the landing post-tpl <template>) from
    blog/v2/posts/ -- computed, not hand-maintained, so it cannot go stale
    again (PHASE 5, tasks 4 and B3). Runs in both preview and --prod mode."""
    path = os.path.join(P4, "blog.html")
    html = read(path)

    marker = '<div id="blog-list-view" hidden>'
    start = html.find(marker)
    if start == -1:
        raise SystemExit(f"{path}: #blog-list-view marker not found")
    tag_end = start + len(marker)
    end = find_matching_div_end(html, tag_end)
    html = html[:start] + blog_list_view_html(posts) + html[end:]

    # Exactly one landing template must exist, always for the newest post --
    # replace whatever post-tpl-<date> is currently baked in (see module
    # docstring / PHASE 5 for why this must never be hand-maintained).
    tpl_matches = list(re.finditer(r'<template id="post-tpl-[^"]*">.*?</template>', html, re.S))
    if len(tpl_matches) != 1:
        raise SystemExit(f"{path}: expected exactly 1 post-tpl <template>, found {len(tpl_matches)}")
    tpl_m = tpl_matches[0]
    html = html[:tpl_m.start()] + landing_template_html(posts[0]) + html[tpl_m.end():]

    json_marker = '<script type="application/json" id="n5-blog-posts">'
    json_tag_start = html.find(json_marker)
    if json_tag_start == -1:
        raise SystemExit(f"{path}: #n5-blog-posts <script> tag not found")
    json_start = json_tag_start + len(json_marker)
    json_end = html.find("</script>", json_start)
    if json_end == -1:
        raise SystemExit(f"{path}: unterminated #n5-blog-posts <script>")
    html = html[:json_start] + "\n" + posts_json_html(posts) + "\n" + html[json_end:]

    write(path, html)
    return path


def generate_post_pages(posts, base, out_dir, prod):
    """Emit blog/posts/<date>.html for every published post (under out_dir,
    which is dev/v3/ in preview mode or the repo root in --prod mode), each
    put through the SAME post-processing pipeline as every other page."""
    skeleton = read(POST_SKELETON_PATH)
    report = []
    for idx, post in enumerate(posts):
        raw = render_post_page(skeleton, post, posts, idx)

        # Validates the skeleton's lockup markers are present (raises if not);
        # no sha check against canonical needed -- render_post_page() never
        # touches that markup, so it stays byte-identical across every
        # generated page and to post.html by construction.
        extract_lockup_assets(raw)

        rel = f"blog/posts/{post['date']}.html"
        html = base_prefix_internal_links(raw, base)
        html = replace_lockup_refs(html, base)
        html = rewrite_local_refs(html, base)
        html = inject_head_meta(html, prod, f"/blog/posts/{post['date']}.html" if prod else None)
        html = inject_base_script(html, base)
        html = add_generated_comment(html)

        out_path = os.path.join(out_dir, rel)
        write(out_path, html)
        report.append((rel, len(html.encode("utf-8"))))
    return report


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(base, prod):
    out_dir = REPO if prod else os.path.join(REPO, base.lstrip("/"))
    pages = get_pages(prod)
    static_assets = get_static_assets(prod)
    written = []

    write_asset = write_binary_checked if prod else write_binary
    write_text_asset = write_checked if prod else write

    # 0) Load every published post (blog/v2/posts/*.html, newest first) and
    #    sync the SOURCE p4/blog.html fixture from it -- BEFORE that file is
    #    read below as a `pages` entry, so the regenerated {base}/blog/index.html
    #    output carries the up-to-date row list and JSON in the same run.
    posts = load_all_posts()
    if not posts:
        raise SystemExit(f"no published posts found in {BLOG_POSTS_DIR}")
    update_blog_html(posts)

    # 1) Extract the two lockup SVGs + font from the canonical source (home.html
    #    for the lockup, instruments.css for the font), then verify every page's
    #    embedded copies are byte-identical before swapping them for URLs.
    canonical_html = read(pages[0][0])
    canonical_assets = extract_lockup_assets(canonical_html)
    for name, data in canonical_assets.items():
        write_asset(os.path.join(out_dir, "assets", name), data)
        written.append((f"assets/{name}", len(data)))

    css_text = read(INSTRUMENTS_CSS)
    font_bytes = extract_font(css_text)
    write_asset(os.path.join(out_dir, "assets", "bigger-display.otf"), font_bytes)
    written.append(("assets/bigger-display.otf", len(font_bytes)))

    processed_css = replace_font_ref(css_text, base)
    write_text_asset(os.path.join(out_dir, "assets", "instruments.css"), processed_css)
    written.append(("assets/instruments.css", len(processed_css)))

    # 2) Copy the plain JS/CSS assets verbatim.
    for src_path, rel in static_assets:
        content = read(src_path)
        write_text_asset(os.path.join(out_dir, rel), content)
        written.append((rel, len(content)))

    # 3) Process each page.
    page_report = []
    for src_path, rel in pages:
        raw = read(src_path)
        before = len(raw.encode("utf-8"))

        page_assets = extract_lockup_assets(raw)
        for name, data in page_assets.items():
            if sha(data) != sha(canonical_assets[name]):
                raise SystemExit(
                    f"{src_path}: embedded asset for {name!r} differs from the "
                    "canonical copy in home.html -- refusing to silently overwrite"
                )

        # Order matters: prefix the source's own absolute internal links FIRST
        # (data: URIs don't start with "/" so they're untouched), THEN splice in
        # the already-{base}-prefixed asset URLs -- reversing this would run the
        # generic "/..." prefixer a second time over the freshly-inserted asset
        # URLs and double them up (e.g. /dev/v3/dev/v3/assets/...).
        html = base_prefix_internal_links(raw, base)
        html = replace_lockup_refs(html, base)
        html = rewrite_local_refs(html, base)
        html = inject_head_meta(html, prod, canonical_path_for(rel, prod))
        html = inject_base_script(html, base)
        html = add_generated_comment(html)

        out_path = os.path.join(out_dir, rel)
        write(out_path, html)
        after = len(html.encode("utf-8"))
        page_report.append((rel, before, after))
        written.append((rel, after))

    # 4) Generate every published post's own page -- same post-processing
    #    pipeline, applied inside generate_post_pages().
    post_page_report = generate_post_pages(posts, base, out_dir, prod)
    written.extend(post_page_report)

    return out_dir, page_report, written, post_page_report, posts


def assert_no_unprefixed_links(out_dir, base):
    """Scan every emitted file for an internal href/src that escaped the base
    prefix. Fails loudly (raises) rather than reporting a soft warning.
    Works for base="" (--prod mode) too: every internal href/src the regex
    matches already starts with "/", which trivially satisfies the "starts
    with base + '/'" check when base is empty -- i.e. this becomes a no-op
    guard in prod (there is no prefix to escape), rather than crashing."""
    offenders = []
    for root, _, files in os.walk(out_dir):
        for fname in files:
            if not fname.endswith((".html", ".htm")):
                continue
            path = os.path.join(root, fname)
            html = read(path)
            for m in re.finditer(r'(href|src)="(/[^"]*)"', html):
                path_val = m.group(2)
                if path_val.startswith("//"):
                    continue  # protocol-relative external URL, not internal
                if not path_val.startswith(base + "/") and path_val != base:
                    offenders.append((os.path.relpath(path, out_dir), m.group(0)))
    if offenders:
        msg = "\n".join(f"  {f}: {tag}" for f, tag in offenders)
        raise SystemExit(f"unprefixed internal link(s) found:\n{msg}")
    return True


def assert_prod_invariants(written):
    """Hard-fail assertions for a --prod build. `written` is the (rel, size)
    list from build(), i.e. only files THIS run emitted -- deliberately not
    a whole-repo scan, so dev/v3/'s own internal "/dev/v3" references (if
    that directory still exists) don't false-positive this check."""
    root_index = os.path.join(REPO, "index.html")
    if os.path.exists(root_index):
        raise SystemExit(
            f"PROD INVARIANT VIOLATED: {root_index} exists -- a root index.html "
            "silently kills per-host routing (Vercel serves the filesystem before "
            "rewrites). Never recreate it."
        )

    # Scoped to FUNCTIONAL /dev/v3 routing (a live href/src/url()/base
    # assignment that would actually resolve under the retired preview
    # prefix), not a raw substring match. A raw substring match also flags
    # two published posts (2026-09-08, 2026-09-11) whose PROSE narrates the
    # /dev/v3 preview build as a historical topic, and a documentation
    # comment in assets/subpage.js describing the shared base-path
    # mechanism generically -- neither is a routing bug, and rewriting
    # published post prose to scrub a true historical fact would violate
    # the "all copy comes from the live site" / don't-touch-journal-content
    # rules elsewhere in this repo's CLAUDE.md.
    DEVV3_LINK_RE = re.compile(r'(?:href|src)="/dev/v3|url\(/dev/v3|__N5_BASE\s*=\s*[\'"]\s*/dev/v3')
    devv3_offenders = []
    noindex_offenders = []
    for rel, _ in written:
        path = os.path.join(REPO, rel)
        if rel.endswith((".html", ".htm", ".css", ".js")):
            try:
                text = read(path)
            except UnicodeDecodeError:
                continue
            if DEVV3_LINK_RE.search(text):
                devv3_offenders.append(rel)
            # Same scoping rationale as DEVV3_LINK_RE above: the actual
            # <meta name="robots" content="noindex...> tag inject_head_meta()
            # emits in preview mode, not the bare word -- 2026-09-08 and
            # 2026-09-11's published prose both discuss noindex as a topic
            # (in <code> spans) while writing about the preview build.
            if rel.endswith((".html", ".htm")) and '<meta name="robots" content="noindex' in text:
                noindex_offenders.append(rel)

    if devv3_offenders:
        raise SystemExit(
            "PROD INVARIANT VIOLATED: '/dev/v3' found in emitted file(s):\n  "
            + "\n  ".join(devv3_offenders)
        )
    if noindex_offenders:
        raise SystemExit(
            "PROD INVARIANT VIOLATED: 'noindex' found in emitted HTML file(s):\n  "
            + "\n  ".join(noindex_offenders)
        )
    return True


def write_sitemap_ericli(posts):
    """--prod only: regenerate sitemap-ericli.xml from scratch -- /, /about/,
    /portfolio/, /blog/, and every published post (oldest-first, matching
    the existing file's convention), dropping the retired v2 portfolio
    subpages (completed/homelab/disclaude-sesh/in-progress/upcoming), which
    308-redirect to /portfolio/ now and should not also self-list."""
    urls = ["/", "/about/", "/portfolio/", "/blog/"]
    urls += [f"/blog/posts/{p['date']}.html" for p in sorted(posts, key=lambda p: p["date"])]
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    lines += [f"  <url><loc>{SITE_ORIGIN}{u}</loc></url>" for u in urls]
    lines.append("</urlset>")
    path = os.path.join(REPO, "sitemap-ericli.xml")
    write(path, "\n".join(lines) + "\n")
    return path, len(urls)


def main():
    base, prod = get_args()
    out_dir, page_report, written, post_page_report, posts = build(base, prod)
    ok = assert_no_unprefixed_links(out_dir, base)

    print(f"mode: {'PROD' if prod else 'preview'}")
    print(f"base path: {base!r}")
    print(f"output dir: {os.path.relpath(out_dir, REPO) or '.'}")
    print()
    print("pages (before -> after extraction, bytes):")
    total_before = total_after = 0
    for rel, before, after in page_report:
        total_before += before
        total_after += after
        print(f"  {rel:32s} {before:>8,} -> {after:>8,}  ({before - after:+,})")
    print(f"  {'TOTAL':32s} {total_before:>8,} -> {total_after:>8,}  ({total_before - total_after:+,})")
    print()
    print(f"post pages generated: {len(post_page_report)} files")
    post_total = sum(sz for _, sz in post_page_report)
    print(f"  total bytes: {post_total:,}")
    print()
    print(f"assets + pages written: {len(written)} files")
    total_size = sum(sz for _, sz in written)
    dir_size = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, fs in os.walk(out_dir)
        for f in fs
    )
    print(f"total output dir size on disk: {dir_size:,} bytes")
    print(f"no-unprefixed-internal-links assertion: {'PASS' if ok else 'FAIL'}")

    if prod:
        prod_ok = assert_prod_invariants(written)
        print(f"prod invariants (no root index.html / no /dev/v3 / no noindex): {'PASS' if prod_ok else 'FAIL'}")
        sitemap_path, n_urls = write_sitemap_ericli(posts)
        print(f"sitemap: {os.path.relpath(sitemap_path, REPO)} ({n_urls} urls)")
        write_owned_manifest()
        print(f"owned-asset manifest: {os.path.relpath(OWNED_MANIFEST, REPO)} ({len(_WRITTEN_THIS_RUN)} files)")


if __name__ == "__main__":
    main()
