#!/usr/bin/env bash
# Build the v3 production site and stage its output paths for commit.
#
# Usage:
#   scripts/publish.sh
#
# What it does:
#   1. Runs `python3 scripts/build_dev_preview.py --prod`, which regenerates
#      home/index.html, about/index.html, portfolio/index.html,
#      blog/index.html, blog/posts/<date>.html (one per published post),
#      the v3 assets under assets/ (instruments.js, hero.js, subpage.css,
#      subpage.js, instruments.css, bigger-display.otf, logo-*.png/mp4/webm),
#      and sitemap-ericli.xml.
#   2. `git add`s exactly those output paths -- NOT `-A` / `-a`, so nothing
#      else staged in the working tree (or left over from an unrelated
#      change) gets swept into the commit by accident.
#
# What it deliberately does NOT do:
#   - It never runs scripts/build_blog.py. That script is the RETIRED v2
#     blog pipeline (blog/v2/posts/, blog/v2/index.html) -- it is a separate
#     step, run separately, and only against a staging journals directory,
#     never the real vault journals (see CLAUDE.md's stub-journal warning).
#   - It never commits or pushes. Staging only -- review `git status` /
#     `git diff --cached` and commit by hand.
#
# The full blog-update workflow, when a new day's post needs to reach v3:
#   1. python3 scripts/reconstruct_journals.py <staging-dir>
#      (builds a staging journals dir: reconstructed entries for already-
#      published days + the genuinely new journal(s) alongside)
#   2. JOURNALS_DIR=<staging-dir> python3 scripts/build_blog.py
#      (writes/patches blog/v2/posts/<date>.html and blog/v2/index.html --
#      the v2 archive, still the source of truth build_dev_preview.py reads
#      post bodies from)
#   3. scripts/publish.sh
#      (regenerates the v3 site, including the new post's v3 page, from the
#      now-updated blog/v2/posts/)
#
# publish.sh is step 3 ONLY. Steps 1-2 are separate, deliberate, and never
# run automatically by this script.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "==> Building v3 production site (scripts/build_dev_preview.py --prod)"
python3 scripts/build_dev_preview.py --prod

echo "==> Staging v3 output paths"
git add \
  home/index.html \
  about/index.html \
  portfolio/index.html \
  blog/index.html \
  blog/posts/ \
  assets/instruments.js \
  assets/hero.js \
  assets/subpage.css \
  assets/subpage.js \
  assets/instruments.css \
  assets/bigger-display.otf \
  assets/logo-rest.png \
  assets/logo-hover.png \
  assets/logo-entry.webm \
  assets/logo-entry.mp4 \
  assets/logo-exit.webm \
  assets/logo-exit.mp4 \
  sitemap-ericli.xml

echo "==> Done. Review with:  git status --short  &&  git diff --cached --stat"
echo "    This script never commits or pushes -- do that by hand after review."
