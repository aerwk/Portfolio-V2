#!/usr/bin/env python3
"""Generate the /dev/v3 deployable preview from the design-loop source.

Eric's "edge draft" redesign (01 Design/design-loop/src) is design source, not
deployable output: every page inlines its wordmark lockup (2 PNGs + 4 video
clips) as base64, plus a base64 OTF font on the home page, and its internal
links point at the LIVE site's real paths (/, /about/, /portfolio/, /blog/,
/blog/posts/*.html). This script extracts every inlined asset to a real file
under dev/v3/assets/ (written once, referenced by every page), rewrites every
internal link to be --base-prefixed so the preview never escapes itself, and
emits the result as a tracked directory ready to serve at n5hq.me/dev/v3.

Usage:
    python3 scripts/build_dev_preview.py                # emit at /dev/v3 (default)
    python3 scripts/build_dev_preview.py --base=/dev/v4  # emit at a different prefix

Idempotent: re-running with the same --base overwrites dev/v3/ with byte-identical
output (no timestamps, no random ordering). No third-party deps.

Source -> output map (URL, not filename, drives the target directory — projects.html's
own internal links call it "/portfolio/", matching the live site's convention):
    p3/home.html      -> {base}/index.html
    p4/about.html     -> {base}/about/index.html
    p4/projects.html  -> {base}/portfolio/index.html
    p4/blog.html      -> {base}/blog/index.html
    p4/post.html      -> {base}/blog/posts/2026-08-22.html   (the one real post page)
    p4/contact.html   -> {base}/contact/index.html
"""
import hashlib
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "01 Design", "design-loop", "src")
P3 = os.path.join(SRC, "p3")
P4 = os.path.join(SRC, "p4")

DEFAULT_BASE = "/dev/v3"

# (source file, output path relative to the base dir)
PAGES = [
    (os.path.join(P3, "home.html"), "index.html"),
    (os.path.join(P4, "about.html"), "about/index.html"),
    (os.path.join(P4, "projects.html"), "portfolio/index.html"),
    (os.path.join(P4, "blog.html"), "blog/index.html"),
    (os.path.join(P4, "post.html"), "blog/posts/2026-08-22.html"),
    (os.path.join(P4, "contact.html"), "contact/index.html"),
]

STATIC_ASSETS = [
    (os.path.join(P3, "instruments.js"), "assets/instruments.js"),
    (os.path.join(P3, "hero.js"), "assets/hero.js"),
    (os.path.join(P4, "subpage.css"), "assets/subpage.css"),
    (os.path.join(P4, "subpage.js"), "assets/subpage.js"),
]

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


def get_base():
    base = DEFAULT_BASE
    for i, arg in enumerate(sys.argv[1:]):
        if arg.startswith("--base="):
            base = arg.split("=", 1)[1]
        elif arg == "--base" and i + 2 < len(sys.argv):
            base = sys.argv[i + 2]
    base = "/" + base.strip("/")
    return base


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


def find_video_sources(html, role):
    """Return [(mime, data_uri), ...] for the <source> tags inside the
    <video ... data-role="{role}" ...>...</video> element, in document order."""
    vstart = html.find(f'data-role="{role}"')
    if vstart == -1:
        raise SystemExit(f"video with data-role={role!r} not found")
    vend = html.find("</video>", vstart)
    if vend == -1:
        raise SystemExit(f"unterminated <video data-role={role!r}>")
    chunk = html[vstart:vend]
    sources = []
    for m in re.finditer(r'<source src="(data:[^"]+)" type="video/(webm|mp4)">', chunk):
        sources.append((m.group(2), m.group(1)))
    if len(sources) != 2:
        raise SystemExit(f"expected 2 <source> tags for data-role={role!r}, found {len(sources)}")
    return sources


def decode_data_uri(uri):
    import base64
    b64 = uri.split(",", 1)[1]
    return base64.b64decode(b64)


def extract_lockup_assets(html):
    """Return {asset_filename: raw_bytes} for the six embedded lockup assets,
    located by their markup role (not by position) so a reordering of the
    source can't silently mis-map an asset."""
    out = {}
    out["logo-rest.png"] = decode_data_uri(find_attr_data_uri(html, 'class="lk-rest" src="'))
    out["logo-hover.png"] = decode_data_uri(find_attr_data_uri(html, 'class="lk-hover" src="'))
    hoverin = find_video_sources(html, "hoverin")
    hoverout = find_video_sources(html, "hoverout")
    for mime, uri in hoverin:
        out[f"logo-entry.{mime}"] = decode_data_uri(uri)
    for mime, uri in hoverout:
        out[f"logo-exit.{mime}"] = decode_data_uri(uri)
    return out


def replace_lockup_refs(html, base):
    """Swap every embedded lockup data: URI for its extracted {base}/assets/ URL."""
    def sub_attr(html, marker, filename):
        old = find_attr_data_uri(html, marker)
        return html.replace(marker + old, marker + f"{base}/assets/{filename}", 1)

    html = sub_attr(html, 'class="lk-rest" src="', "logo-rest.png")
    html = sub_attr(html, 'class="lk-hover" src="', "logo-hover.png")

    for role, names in (
        ("hoverin", ("logo-entry.webm", "logo-entry.mp4")),
        ("hoverout", ("logo-exit.webm", "logo-exit.mp4")),
    ):
        vstart = html.find(f'data-role="{role}"')
        vend = html.find("</video>", vstart)
        chunk = html[vstart:vend]
        new_chunk = chunk
        srcs = list(re.finditer(r'<source src="(data:[^"]+)" type="video/(webm|mp4)">', chunk))
        # replace in reverse so earlier offsets stay valid
        for m, name in zip(reversed(srcs), reversed(names)):
            s, e = m.span(1)
            new_chunk = new_chunk[:s] + f"{base}/assets/{name}" + new_chunk[e:]
        html = html[:vstart] + new_chunk + html[vend:]
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


def inject_head_meta(html):
    return html.replace(
        "</title>", "</title>\n<meta name=\"robots\" content=\"noindex, nofollow\">", 1
    )


def inject_base_script(html, base):
    """Set window.__N5_BASE before subpage.js runs, so its base-aware regexes
    (see p4/subpage.js) match/build URLs under this prefix. Harmless on pages
    that don't load subpage.js."""
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
# Build
# ---------------------------------------------------------------------------

def build(base):
    out_dir = os.path.join(REPO, base.lstrip("/"))
    written = []

    # 1) Extract the six lockup assets + font from the canonical source (home.html
    #    for the lockup, instruments.css for the font), then verify every page's
    #    embedded copies are byte-identical before swapping them for URLs.
    canonical_html = read(PAGES[0][0])
    canonical_assets = extract_lockup_assets(canonical_html)
    for name, data in canonical_assets.items():
        write_binary(os.path.join(out_dir, "assets", name), data)
        written.append((f"assets/{name}", len(data)))

    css_text = read(INSTRUMENTS_CSS)
    font_bytes = extract_font(css_text)
    write_binary(os.path.join(out_dir, "assets", "bigger-display.otf"), font_bytes)
    written.append(("assets/bigger-display.otf", len(font_bytes)))

    processed_css = replace_font_ref(css_text, base)
    write(os.path.join(out_dir, "assets", "instruments.css"), processed_css)
    written.append(("assets/instruments.css", len(processed_css)))

    # 2) Copy the plain JS/CSS assets verbatim.
    for src_path, rel in STATIC_ASSETS:
        content = read(src_path)
        write(os.path.join(out_dir, rel), content)
        written.append((rel, len(content)))

    # 3) Process each page.
    page_report = []
    for src_path, rel in PAGES:
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
        html = inject_head_meta(html)
        html = inject_base_script(html, base)
        html = add_generated_comment(html)

        out_path = os.path.join(out_dir, rel)
        write(out_path, html)
        after = len(html.encode("utf-8"))
        page_report.append((rel, before, after))
        written.append((rel, after))

    return out_dir, page_report, written


def assert_no_unprefixed_links(out_dir, base):
    """Scan every emitted file for an internal href/src that escaped the base
    prefix. Fails loudly (raises) rather than reporting a soft warning."""
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


def main():
    base = get_base()
    out_dir, page_report, written = build(base)
    ok = assert_no_unprefixed_links(out_dir, base)

    print(f"base path: {base}")
    print(f"output dir: {os.path.relpath(out_dir, REPO)}")
    print()
    print("pages (before -> after extraction, bytes):")
    total_before = total_after = 0
    for rel, before, after in page_report:
        total_before += before
        total_after += after
        print(f"  {rel:32s} {before:>8,} -> {after:>8,}  ({before - after:+,})")
    print(f"  {'TOTAL':32s} {total_before:>8,} -> {total_after:>8,}  ({total_before - total_after:+,})")
    print()
    print(f"assets + pages written: {len(written)} files")
    total_size = sum(sz for _, sz in written)
    dir_size = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, fs in os.walk(out_dir)
        for f in fs
    )
    print(f"total dev/v3/ size on disk: {dir_size:,} bytes")
    print(f"no-unprefixed-internal-links assertion: {'PASS' if ok else 'FAIL'}")


if __name__ == "__main__":
    main()
