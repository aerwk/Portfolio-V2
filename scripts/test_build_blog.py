#!/usr/bin/env python3
"""Regression tests for build_blog.py rendering safety.

RULE: no journal content may ever produce executable or attribute-breaking HTML.

Journals used to be written only by hand, so the renderer could assume friendly
input. That assumption is being removed (drafts may be machine-generated, and
journal text is derived from transcripts containing arbitrary third-party text).
Once input is untrusted, the renderer is a security boundary.

Run:  python3 scripts/test_build_blog.py
Exit: 0 all passed, 1 a rule was violated.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("bb", os.path.join(HERE, "build_blog.py"))
bb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bb)

FAILURES = []


def check(name, body, must_not_contain=(), must_contain=()):
    out = bb.md_to_html(body)
    for bad in must_not_contain:
        if bad.lower() in out.lower():
            FAILURES.append(f"{name}: output contained {bad!r}\n    input:  {body}\n    output: {out}")
            return
    for good in must_contain:
        if good not in out:
            FAILURES.append(f"{name}: output missing {good!r}\n    input:  {body}\n    output: {out}")
            return
    print(f"  ok   {name}")


# --- attribute breakout ------------------------------------------------------
check("quote in URL cannot open a new attribute",
      '[x](https://a/" onmouseover="alert(1))',
      must_not_contain=['onmouseover="', '" on'])

check("quote in URL is entity-escaped",
      '[x](https://a/"b)',
      must_contain=["&quot;"])

# --- dangerous schemes -------------------------------------------------------
for scheme in ("javascript:alert(1)", "JaVaScRiPt:alert(1)",
               "data:text/html;base64,PHN2Zz4=", "vbscript:msgbox(1)"):
    check(f"scheme rejected: {scheme[:22]}",
          f"[click]({scheme})",
          must_not_contain=["<a href", scheme.split(":")[0].lower() + ":"])

# --- legitimate links still work --------------------------------------------
check("https link still renders",
      "[disclaude-sesh](https://github.com/aerwk/disclaude-sesh)",
      must_contain=['<a href="https://github.com/aerwk/disclaude-sesh">'])
check("root-relative link still renders",
      "[blog](/blog/)", must_contain=['<a href="/blog/">'])
check("anchor link still renders",
      "[top](#top)", must_contain=['<a href="#top">'])

# --- raw HTML in body text ---------------------------------------------------
check("script tag in prose is escaped, not executed",
      "before <script>alert(1)</script> after",
      must_not_contain=["<script"])
check("img onerror in prose is escaped",
      '<img src=x onerror=alert(1)>',
      must_not_contain=["<img"])

# --- ampersand handling ------------------------------------------------------
check("ampersand in URL is escaped once",
      "[q](https://x/?a=1&b=2)",
      must_contain=["&amp;b=2"], must_not_contain=["&amp;amp;"])

if FAILURES:
    print("\nFAILED — rendering safety rule violated:\n")
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print(f"\nall {len(FAILURES) == 0 and 'checks' or ''} passed")
sys.exit(0)
