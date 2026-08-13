#!/usr/bin/env bash
# Deploy portal.n5hq.me from this repo to the nginx container that serves it.
#
# The portal page CANNOT be served by Vercel: it is a launcher for internal
# services and is gated by Cloudflare Access, which only applies to traffic
# arriving through the tunnel. Anything Vercel serves is public. portal-src/ is
# therefore excluded in .vercelignore and pushed here instead.
#
# Assets are copied from the repo rather than kept as a second copy, so the
# portal cannot drift from ericli.n5hq.me / www.n5hq.me again.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${PORTAL_HOST:-n5ubuntu}"
DEST="${PORTAL_DEST:-~/portal-site/site}"

echo "repo:  $REPO"
echo "dest:  $HOST:$DEST"

rsync -a --delete "$REPO/assets/" "$HOST:$DEST/assets/"
rsync -a "$REPO/portal-src/index.html" "$HOST:$DEST/index.html"

echo "--- verifying the served copy matches the repo ---"
for f in assets/style.css assets/brandmotion.js assets/n5hqstaticv2.png assets/foot-n5hq.png; do
  local_sum=$(md5sum "$REPO/$f" | cut -d' ' -f1)
  remote_sum=$(ssh "$HOST" "md5sum $DEST/$f" | cut -d' ' -f1)
  if [ "$local_sum" = "$remote_sum" ]; then echo "  ok    $f"; else echo "  DRIFT $f"; exit 1; fi
done
echo "portal deployed"
