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
# The live origin is CT 141 on pve02, not the n5ubuntu Docker copy. That copy was
# decommissioned on 2026-08-11 (stopped, restart=no) and is NOT an origin.
PVE="${PORTAL_PVE:-pve02}"
CTID="${PORTAL_CTID:-141}"
DOCROOT="${PORTAL_DOCROOT:-/var/www/portal}"

echo "repo:  $REPO"
echo "dest:  $PVE CT $CTID $DOCROOT"

TMP=$(ssh "$PVE" mktemp -d)
rsync -a --delete "$REPO/assets/" "$PVE:$TMP/assets/"
rsync -a "$REPO/portal-src/index.html" "$PVE:$TMP/index.html"
# --no-same-permissions + an explicit chmod pass: tar would otherwise restore the
# temp dir's own 0700 mode onto the docroot and nginx could not traverse it.
ssh "$PVE" "pct exec $CTID -- mkdir -p $DOCROOT/assets && \
  tar -C $TMP -cf - . | pct exec $CTID -- tar -C $DOCROOT --no-same-owner --no-same-permissions -xf - && \
  pct exec $CTID -- chown -R root:root $DOCROOT && \
  pct exec $CTID -- find $DOCROOT -type d -exec chmod 755 {} + && \
  pct exec $CTID -- find $DOCROOT -type f -exec chmod 644 {} + && rm -rf $TMP"

echo "--- verifying the served copy matches the repo ---"
for f in assets/style.css assets/brandmotion.js assets/n5hqstaticv2.png assets/foot-n5hq.png; do
  local_sum=$(md5sum "$REPO/$f" | cut -d' ' -f1)
  remote_sum=$(ssh "$PVE" "pct exec $CTID -- md5sum $DOCROOT/$f" | cut -d' ' -f1)
  if [ "$local_sum" = "$remote_sum" ]; then echo "  ok    $f"; else echo "  DRIFT $f"; exit 1; fi
done
echo "--- proving the origin actually serves ---"
for u in / /assets/style.css /assets/brandmotion.js; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "http://10.0.0.41:8080$u")
  if [ "$code" = "200" ]; then echo "  200   $u"; else echo "  $code   $u"; exit 1; fi
done
echo "portal deployed"
