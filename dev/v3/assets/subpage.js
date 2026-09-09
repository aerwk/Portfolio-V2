/* N5HQ edge draft — piece 4 "Subpage chrome" load-reveal
   Extends the home.html corner-reveal script (same WAAPI mechanics, same
   __n5RevealAt(ms)/__n5RevealPlay() scrub hooks) to the subpage's two
   corners (no .bl on subpages) plus the content column, which joins the
   choreography at 180ms — half-way between the corners' 0ms and 360ms. */

/* Base-path helpers (added for the /dev/v3 deploy build, scripts/build_dev_preview.py):
   a deployed copy sets window.__N5_BASE (e.g. '/dev/v3') in an inline <script> before
   this file loads, so every post-URL regex below can match/build paths under that
   prefix instead of the bare "/blog/posts/..." this file used to hardcode. Unset
   (the design source served at "/") resolves to '', which reproduces the exact prior
   behaviour — a single source of truth instead of sprinkling the prefix through the
   file. Declared at top level (not inside an IIFE) because two separate IIFEs below
   both need it. */
function __n5Base(){
  return (typeof window !== 'undefined' && window.__N5_BASE) || '';
}
function __n5EscapeRe(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(function(){
  'use strict';

  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { REDUCED = false; }

  var targets = [
    { el: document.getElementById('c-tl'), delay: 0 },
    { el: document.getElementById('main'), delay: 180 },
    { el: document.getElementById('c-tr'), delay: 360 }
  ].filter(function (t) { return !!t.el; });

  var revealAnims = [];

  function reveal(){
    if (REDUCED) {
      var k;
      for (k = 0; k < targets.length; k++) {
        targets[k].el.style.opacity = '1';
        targets[k].el.style.transform = 'none';
      }
      return;
    }
    var i;
    for (i = 0; i < targets.length; i++) {
      var t = targets[i];
      var anim = t.el.animate(
        [
          { opacity: .15, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 500, delay: t.delay, easing: 'ease-out', fill: 'both' }
      );
      revealAnims.push(anim);
    }
  }

  window.__n5RevealAt = function(ms){
    var i;
    for (i = 0; i < revealAnims.length; i++) {
      revealAnims[i].pause();
      revealAnims[i].currentTime = ms;
    }
  };
  window.__n5RevealPlay = function(){
    var i;
    for (i = 0; i < revealAnims.length; i++) revealAnims[i].play();
  };

  function whenReady(cb){
    function afterPaint(){
      requestAnimationFrame(function(){ requestAnimationFrame(cb); });
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(afterPaint, afterPaint);
    } else {
      afterPaint();
    }
  }

  whenReady(function(){
    reveal();
    window.__n5ReadyAt = performance.now();
    window.__n5PageReady = true;
  });
})();

/* Wordmark lockup: still image at rest; the entry clip autoplays once on
   load, the hover clip plays once per pointer-enter. Ported verbatim from
   home.html — the corner is "unchanged" per the subpage spec. */
(function(){
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.n5i-lockup').forEach(function(brand){
    var canvas = brand.querySelector('.lk-canvas');
    var clips = {};
    brand.querySelectorAll('.lk-clip').forEach(function(v){ clips[v.dataset.role] = v; });
    var ctx = canvas && canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
    /* reduced motion: CSS swaps the two stills on :hover, no video */
    if (reduced || !ctx || !clips.hoverin || !clips.hoverout) { brand.classList.remove('lk-armed'); return; }
    /* states: rest -> entering -> hover -> exiting -> rest. `wanted` is where the pointer
       says we should be; whenever a clip settles somewhere else, the opposite clip runs. */
    var state = 'rest', wanted = 'rest', current = null, loopId = 0, guard = 0, drawn = false;
    var stopLoop = function(){
      if (current && current.cancelVideoFrameCallback && loopId) current.cancelVideoFrameCallback(loopId);
      else if (loopId) cancelAnimationFrame(loopId);
      loopId = 0;
    };
    var fail = function(){
      stopLoop(); clearTimeout(guard); current = null; state = 'rest';
      brand.classList.remove('lk-armed'); brand.classList.remove('lk-play'); brand.classList.remove('lk-hov');
    };
    /* Frames are exported on black: key black to alpha by luminance, then retone so every
       frame carries the site's own colours whatever the encoder or decoder did to the export
       (Eric, 2026-09-08: the clip violet did not match the pill violet; ERIC must match the
       role label, LI must match the mark). Regions are spatial, measured on the still:
       mark x<.517; row 2 y>.49; the C ends at x=.764. Violet -> the brand token. Mark + LI ->
       the mark grey. ERIC -> Bone at .55 while the letters are grey (rest), white when the
       clip lights them; the C has no state of its own in the export, so it follows the E. */
    var MARK_R = 0.517, ROW2_TOP = 0.49, C_R = 0.764;
    var TOKEN = [94, 24, 235], BONE = [228, 223, 218], MARK = [184, 184, 184];
    var key = function(v){
      var W = canvas.width, H = canvas.height;
      try { ctx.drawImage(v, 0, 0, W, H); } catch(e){ return false; }
      var img = ctx.getImageData(0, 0, W, H), d = img.data;
      var ei = (Math.round(0.2 * (H - 1)) * W + Math.round(0.585 * (W - 1))) * 4;
      var em = Math.max(d[ei], d[ei+1], d[ei+2]) / 233;
      var lit = (em - 0.56) / 0.44; if (lit < 0) lit = 0; if (lit > 1) lit = 1;
      var xMark = MARK_R * W, yRow2 = ROW2_TOP * H, xC = C_R * W;
      for (var y = 0, i = 0; y < H; y++) for (var x = 0; x < W; x++, i += 4) {
        var r = d[i], g = d[i+1], b = d[i+2], m = r > g ? (r > b ? r : b) : (g > b ? g : b);
        if (m <= 6) { d[i] = d[i+1] = d[i+2] = d[i+3] = 0; continue; }
        var a = m / 233; if (a > 1) a = 1;
        r /= a; g /= a; b /= a;
        if (b > r + 40 && b > g + 60 && b > 120) {
          /* the export's violet keys to ~.92, not 1 — treat it as opaque ink so the on-screen colour is the token itself */
          var cv = a / 0.9; if (cv > 1) cv = 1;
          d[i] = TOKEN[0]; d[i+1] = TOKEN[1]; d[i+2] = TOKEN[2]; d[i+3] = cv * 255; continue;
        }
        if (x < xMark || (y > yRow2 && x > xC)) {
          var c = a / 0.75; if (c > 1) c = 1;
          d[i] = MARK[0]; d[i+1] = MARK[1]; d[i+2] = MARK[2]; d[i+3] = c * 255; continue;
        }
        var cov = a / 0.56; if (cov > 1) cov = 1;
        var w = (y > yRow2) ? lit : (a - 0.56) / 0.44; if (w < 0) w = 0; if (w > 1) w = 1;
        d[i] = BONE[0] + (255 - BONE[0]) * w; d[i+1] = BONE[1] + (255 - BONE[1]) * w; d[i+2] = BONE[2] + (255 - BONE[2]) * w;
        d[i+3] = cov * (0.55 + 0.45 * w) * 255;
      }
      ctx.putImageData(img, 0, 0);
      return true;
    };
    var settle = function(v){
      var to = (v === clips.hoverin) ? 'hover' : 'rest';
      stopLoop(); clearTimeout(guard); key(v);
      if (to === 'hover') brand.classList.add('lk-hov'); else brand.classList.remove('lk-hov');
      brand.classList.remove('lk-play'); /* canvas fades out over the settled still (CSS .3s) */
      state = to; current = null;
      if (wanted !== state) run(wanted === 'hover' ? 'hoverin' : 'hoverout');
    };
    var loop = function(){
      var v = current; if (!v) return;
      var ok = v.readyState >= 2 && key(v);
      if (ok && !drawn) {
        /* only once a real frame is on the canvas: show it, and drop the hover still under
           an exit clip (its first frame is the same violet, so nothing flashes) */
        drawn = true; brand.classList.add('lk-play');
        if (v === clips.hoverout) brand.classList.remove('lk-hov');
      }
      if (v.ended || v.paused) return;
      loopId = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    var run = function(name){
      var v = clips[name]; if (!v) return;
      state = (name === 'hoverin') ? 'entering' : 'exiting';
      stopLoop(); clearTimeout(guard);
      var r = brand.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      current = v; drawn = false;
      try { v.currentTime = 0; } catch(e){}
      var done = function(){ v.removeEventListener('ended', done); v.removeEventListener('error', onErr); if (current === v) settle(v); };
      var onErr = function(){ v.removeEventListener('ended', done); v.removeEventListener('error', onErr); fail(); };
      v.addEventListener('ended', done); v.addEventListener('error', onErr);
      guard = setTimeout(function(){ if (v.currentTime < 0.05) onErr(); }, 1500);
      var p = v.play();
      if (p && p.catch) p.catch(onErr);
      loop();
    };
    var over = function(){ wanted = 'hover'; if (state === 'rest') run('hoverin'); };
    var out = function(){ wanted = 'rest'; if (state === 'hover') run('hoverout'); };
    brand.addEventListener('mouseenter', over); brand.addEventListener('mouseleave', out);
    brand.addEventListener('focus', over); brand.addEventListener('blur', out);
  });
})();

/* Shared post-list reader (Eric, 2026-09-08, tree-listing pass): the archive tree
   builder, the tree-node listing view, AND the prev/next controls all need the same
   ordered, parsed view of the real post list (#blog-list-view .post-row) — the single
   source of truth, per Eric's "everything must stay derived from the rendered post
   list" instruction. One function, used by all three, so they can never disagree.
   DOM order is newest-first, matching the blog pipeline's own "All posts" output. */
function __n5ReadPostRows(){
  var listView = document.getElementById('blog-list-view');
  if (!listView) return [];
  var HREF_RE = new RegExp(__n5EscapeRe(__n5Base()) + '\\/blog\\/posts\\/(\\d{4})-(\\d{2})-(\\d{2})\\.html');
  var rows = listView.querySelectorAll('a.post-row');
  var posts = [];
  rows.forEach(function(row){
    var href = row.getAttribute('href') || '';
    var m = HREF_RE.exec(href);
    if (!m) return; // malformed row: skip rather than guess
    var titleEl = row.querySelector('.post-title');
    posts.push({
      year: m[1],
      month: m[2],
      day: m[3],
      id: m[1] + '-' + m[2] + '-' + m[3],
      href: href,
      title: titleEl ? titleEl.textContent.trim() : ''
    });
  });
  return posts;
}

/* Blog archive tree BUILDER (/blog/ only, guarded on [data-blog-tree]'s absence).
   Eric, 2026-09-08: "Add Blog as the root of the blog topology, and that section is now
   complete, and make sure if new posts are added, this navigation system is automatically
   updated." The tree used to be hand-written markup that duplicated the "All posts" list
   below it — two places to keep in sync, guaranteed to drift the next time a post is
   published. Fixed by deriving the tree from the list at runtime instead: this IIFE reads
   every real <a class="post-row"> already rendered in #blog-list-view (the list the site's
   blog pipeline generates), groups it by year/month parsed from the post's own href, and
   builds the root -> years -> months -> leaves DOM the accordion below expects. A new post
   needs zero extra work here — it appears in the tree because it exists in the list, and
   the two structures can never disagree because one is generated from the other.
   Migration note for the real repo: `scripts/build_blog.py` only has to keep generating
   the "All posts" list exactly as it does today; it needs to know nothing about this tree.
   This IIFE runs BEFORE the accordion IIFE below on purpose — it only builds DOM (root/year/
   month <button data-acc-trigger> + <div class="acc-panel"> pairs, all collapsed/inert), it
   does not bind any click handlers or duplicate the accordion's open/close logic. The
   accordion IIFE queries [data-acc-trigger] synchronously after this one has already run in
   the same <script>, so it binds to the freshly-built triggers exactly as if they had been
   hand-written; the blog swap IIFE further below (which binds the leaf clicks) runs later
   still, so it too sees the finished tree. window.__n5RebuildBlogTree exposes the builder
   itself (idempotent — clears and rebuilds the whole <nav> each call) purely as a test hook
   for confirming the auto-update behaviour without a real deploy.

   Eric, 2026-09-09: "the tree does not work for a mobile page... The nav tree will have to
   be replaced by a drop down menu to select year, month and day." buildMobileNav() below
   (also called on every rebuild, same window.__n5RebuildBlogTree hook) is that replacement:
   three <select>s, populated from groupPosts(readPosts()) — the exact same call buildTree()
   itself makes, a few lines down — so the tree and the selects are two renderings of one
   read, never two reads that could disagree. Which of the two actually paints is a pure CSS
   decision (subpage.css `@media (max-width:767px)`), not a JS one — see that stylesheet's
   "Mobile Year/Month/Day archive selector" comment. */
(function(){
  var tree = document.querySelector('[data-blog-tree]');
  var listView = document.getElementById('blog-list-view');
  if (!tree || !listView) return;

  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function chevronSvg(){
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'acc-chevron');
    svg.setAttribute('width', '12'); svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var poly = document.createElementNS(SVG_NS, 'polyline');
    poly.setAttribute('points', '6 9 12 15 18 9');
    svg.appendChild(poly);
    return svg;
  }

  function glyphSpan(glyph){
    var s = el('span', 'tree-glyph');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = glyph;
    return s;
  }

  function triggerFace(cls, glyph, text, hidden){
    var face = el('span', cls);
    if (hidden) face.setAttribute('aria-hidden', 'true');
    var label = el('span', 'tree-label');
    label.appendChild(glyphSpan(glyph));
    label.appendChild(document.createTextNode(text));
    face.appendChild(label);
    face.appendChild(chevronSvg());
    return face;
  }

  function makeTrigger(id, panelId, group, glyph, text){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill acc-trigger tree-trigger';
    btn.id = id;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', panelId);
    btn.setAttribute('data-acc-trigger', '');
    btn.setAttribute('data-acc-group', group);
    btn.appendChild(triggerFace('pill-l', glyph, text, false));
    btn.appendChild(triggerFace('pill-c', glyph, text, true));
    return btn;
  }

  function makePanel(panelId, triggerId){
    var panel = el('div', 'acc-panel');
    panel.id = panelId;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', triggerId);
    panel.setAttribute('inert', '');
    return panel;
  }

  function makeLeaf(post, glyph){
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'tree-leaf';
    a.href = post.href;
    a.title = post.title;
    a.setAttribute('data-blog-leaf', '');
    a.setAttribute('data-post-id', post.id);
    a.appendChild(glyphSpan(glyph));
    var day = el('span', 'tree-day'); day.textContent = post.day; a.appendChild(day);
    var title = el('span', 'tree-title'); title.textContent = post.title; a.appendChild(title);
    li.appendChild(a);
    return li;
  }

  /* Read the real post list — never the rendered/formatted date text, which is
     display-formatted; the href is the one reliably-parseable field. Delegates to
     the shared reader (see __n5ReadPostRows above) so the tree, the listings, and
     prev/next can never drift apart. */
  function readPosts(){
    return __n5ReadPostRows();
  }

  /* Group by year -> month, sorted ascending at every level regardless of the order
     the list itself presents them in (today it's newest-first). */
  function groupPosts(posts){
    var byYear = {};
    posts.forEach(function(p){
      byYear[p.year] = byYear[p.year] || {};
      (byYear[p.year][p.month] = byYear[p.year][p.month] || []).push(p);
    });
    var years = Object.keys(byYear).sort();
    return years.map(function(year){
      var months = Object.keys(byYear[year]).sort();
      return {
        year: year,
        months: months.map(function(month){
          var leaves = byYear[year][month].slice().sort(function(a, b){ return a.day.localeCompare(b.day); });
          return { month: month, leaves: leaves };
        })
      };
    });
  }

  function buildTree(){
    var years = groupPosts(readPosts());

    var root = el('div', 'tree-root');
    var rootTrig = makeTrigger('trig-blog', 'panel-blog', 'tree-root', '└──', 'Blog');
    var rootPanel = makePanel('panel-blog', 'trig-blog');
    var rootInner = document.createElement('div');
    var yearsWrap = document.createDocumentFragment();

    years.forEach(function(y, yi){
      var yearGlyph = (yi === years.length - 1) ? '└──' : '├──';
      var yearDiv = el('div', 'tree-year');
      var yId = 'y' + y.year;
      var yTrig = makeTrigger('trig-' + yId, 'panel-' + yId, 'tree-years', yearGlyph, y.year);
      var yPanel = makePanel('panel-' + yId, 'trig-' + yId);
      var yInner = document.createElement('div');

      y.months.forEach(function(mo, mi){
        var monthGlyph = (mi === y.months.length - 1) ? '└──' : '├──';
        var monthDiv = el('div', 'tree-month');
        var mId = 'm' + y.year + '-' + mo.month;
        var monthLabel = MONTH_NAMES[parseInt(mo.month, 10) - 1] || mo.month;
        var mTrig = makeTrigger('trig-' + mId, 'panel-' + mId, 'tree-months-' + y.year, monthGlyph, monthLabel);
        var mPanel = makePanel('panel-' + mId, 'trig-' + mId);
        var mInner = document.createElement('div');
        var ul = el('ul', 'tree-leaves');

        mo.leaves.forEach(function(post, pi){
          var leafGlyph = (pi === mo.leaves.length - 1) ? '└──' : '├──';
          ul.appendChild(makeLeaf(post, leafGlyph));
        });

        mInner.appendChild(ul);
        mPanel.appendChild(mInner);
        monthDiv.appendChild(mTrig);
        monthDiv.appendChild(mPanel);
        yInner.appendChild(monthDiv);
      });

      yPanel.appendChild(yInner);
      yearDiv.appendChild(yTrig);
      yearDiv.appendChild(yPanel);
      yearsWrap.appendChild(yearDiv);
    });

    rootInner.appendChild(yearsWrap);
    rootPanel.appendChild(rootInner);
    root.appendChild(rootTrig);
    root.appendChild(rootPanel);

    tree.innerHTML = '';
    tree.appendChild(root);
  }

  /* Mobile cascading Year -> Month -> Day selector (Eric, 2026-09-09: "the tree does
     not work for a mobile page... The nav tree will have to be replaced by a drop
     down menu to select year, month and day"). A parallel, CSS-swapped sibling to the
     tree built above, not a rewrite of it — [data-blog-mobile-nav] and [data-blog-tree]
     coexist in the DOM at all times (see the "Mobile Year/Month/Day archive selector"
     comment in subpage.css); this function only fills the three <select>s, off the
     same groupPosts(readPosts()) call buildTree() itself just made, so the two can
     never end up listing a different set of years/months/days. No-op (silently, like
     every other guard in this file) if blog.html's markup for it isn't present —
     lets this run harmlessly on any future page that reuses this IIFE without the
     mobile markup.

     Navigation: reuses the site's ONE real post-navigation mechanism rather than
     inventing a second — see showPost()/the [data-post-nav] delegate in the swap IIFE
     below. A <select>'s 'change' event has no [data-post-nav] ancestor of its own to
     piggyback that delegate on, so the hidden, already-DOM-connected proxy anchor
     next to these selects (data-blog-mobile-proxy in blog.html) gets stamped with the
     resolved post id and .click()'d instead — a *connected* element, deliberately:
     dispatching .click() on a detached node never bubbles as far as `document`, so a
     freshly created-but-unattached <a> would silently do nothing here.

     Resolution rule for Year/Month changes (Eric's "avoid a dead/broken state" —
     this exact wording, and the worked example, are what's implemented): changing
     Year or Month is a coarser choice than whatever the visitor had selected before,
     so each one resolves to the LATEST post inside the newly chosen scope — the same
     "always show latest" principle the landing view itself uses (getLatestId(), in
     the swap IIFE below). Year change -> latest month in that year -> latest day in
     that month. Month change (year unchanged) -> latest day in that month. Day change
     is the final, most specific field — it navigates immediately, no further
     resolution needed, standard cascading-select UX (no separate "Go" button).

     window.__n5SyncMobileNav (set at the bottom of this function) is the other half
     of "the two must never fight over which post is current": renderPost(), the swap
     IIFE's single post-rendering choke point (used by every trigger — landing init,
     tree-leaf clicks, prev/next, listing rows, AND this selector's own proxy-click
     navigation), calls it after every render so these three <select>s always reflect
     whatever post is actually showing, however it got there — the requirement being
     that rotating a phone past 768px must show the tree pointing at the same post the
     selects last showed, never a second, independently-tracked notion of "current". */
  var MOBILE_NAV_ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function buildMobileNav(){
    var nav = document.querySelector('[data-blog-mobile-nav]');
    if (!nav) return;
    var yearSel = nav.querySelector('[data-blog-nav-year]');
    var monthSel = nav.querySelector('[data-blog-nav-month]');
    var daySel = nav.querySelector('[data-blog-nav-day]');
    var proxy = nav.querySelector('[data-blog-mobile-proxy]');
    if (!yearSel || !monthSel || !daySel || !proxy) return;

    var years = groupPosts(readPosts()); // ascending at every level, same as buildTree()

    function findYear(y){
      for (var i = 0; i < years.length; i++) if (years[i].year === y) return years[i];
      return null;
    }
    function findMonth(yearNode, m){
      if (!yearNode) return null;
      for (var i = 0; i < yearNode.months.length; i++) if (yearNode.months[i].month === m) return yearNode.months[i];
      return null;
    }

    /* Native <select>s only (no custom widget) — but a raw post title can run to
       80+ characters, and an unbounded <option> can force a phone's native picker
       overlay absurdly wide. There is no reliable way to measure that OS-drawn
       overlay's width from here (it is not part of the page's own layout box, even
       in Playwright), so 32 characters is a conservative, judgement-call cap: short
       enough to keep "DD — Title…" under ~40 characters total on the narrowest
       phones tested (390px), long enough that most of this blog's real titles
       (see #blog-list-view above) still read as distinct entries rather than
       identical truncated stubs. */
    var TITLE_TRUNCATE_AT = 32;
    function truncateTitle(title){
      if (title.length <= TITLE_TRUNCATE_AT) return title;
      return title.slice(0, TITLE_TRUNCATE_AT - 1) + '…';
    }

    function fillSelect(sel, items, valueFn, labelFn){
      sel.innerHTML = '';
      items.forEach(function(item){
        var opt = document.createElement('option');
        opt.value = valueFn(item);
        opt.textContent = labelFn(item);
        sel.appendChild(opt);
      });
    }
    function fillYearOptions(){
      fillSelect(yearSel, years, function(y){ return y.year; }, function(y){ return y.year; });
    }
    function fillMonthOptions(yearNode){
      var months = yearNode ? yearNode.months : [];
      fillSelect(monthSel, months, function(mo){ return mo.month; },
        function(mo){ return MONTH_NAMES[parseInt(mo.month, 10) - 1] || mo.month; });
    }
    function fillDayOptions(monthNode){
      var leaves = monthNode ? monthNode.leaves : [];
      fillSelect(daySel, leaves, function(p){ return p.id; },
        function(p){ return p.day + ' — ' + truncateTitle(p.title); });
    }

    /* Paints all three selects to reflect a known-good post id with no cascading
       side effects and no navigation — used for the initial paint below AND as
       window.__n5SyncMobileNav, the external resync hook renderPost() calls after
       every render (see the top-of-function comment). */
    function setSelectsTo(id){
      var m = MOBILE_NAV_ID_RE.exec(id || '');
      if (!m) return;
      var yearNode = findYear(m[1]);
      fillMonthOptions(yearNode);
      var monthNode = findMonth(yearNode, m[2]);
      fillDayOptions(monthNode);
      yearSel.value = m[1];
      monthSel.value = m[2];
      daySel.value = id;
    }

    function navigate(id){
      proxy.setAttribute('data-post-nav', id);
      proxy.click();
    }

    yearSel.addEventListener('change', function(){
      var yearNode = findYear(yearSel.value);
      fillMonthOptions(yearNode);
      var latestMonth = yearNode ? yearNode.months[yearNode.months.length - 1] : null;
      if (latestMonth) monthSel.value = latestMonth.month;
      fillDayOptions(latestMonth);
      var latestPost = latestMonth ? latestMonth.leaves[latestMonth.leaves.length - 1] : null;
      if (latestPost) { daySel.value = latestPost.id; navigate(latestPost.id); }
    });

    monthSel.addEventListener('change', function(){
      var yearNode = findYear(yearSel.value);
      var monthNode = findMonth(yearNode, monthSel.value);
      fillDayOptions(monthNode);
      var latestPost = monthNode ? monthNode.leaves[monthNode.leaves.length - 1] : null;
      if (latestPost) { daySel.value = latestPost.id; navigate(latestPost.id); }
    });

    daySel.addEventListener('change', function(){
      if (daySel.value) navigate(daySel.value);
    });

    fillYearOptions();
    window.__n5SyncMobileNav = setSelectsTo;

    /* Initial paint: if a post is already marked current on the tree (a rebuild
       happening after the page has already navigated somewhere), reflect that;
       otherwise default to the latest post in the newly built data, matching the
       tree/landing's own "always show latest" default on a fresh load. */
    var currentLeaf = document.querySelector('[data-blog-leaf][aria-current="page"]');
    var initialId = currentLeaf ? currentLeaf.getAttribute('data-post-id') : null;
    if (!initialId) {
      var lastYear = years[years.length - 1];
      var lastMonth = lastYear ? lastYear.months[lastYear.months.length - 1] : null;
      var lastPost = lastMonth ? lastMonth.leaves[lastMonth.leaves.length - 1] : null;
      initialId = lastPost ? lastPost.id : null;
    }
    if (initialId) setSelectsTo(initialId);
  }

  function rebuildBlogNav(){
    buildTree();
    buildMobileNav();
  }

  rebuildBlogNav();
  window.__n5RebuildBlogTree = rebuildBlogNav;
})();

/* Projects page accordion: Completed / In Progress / Upcoming, single-open.
   No-op on every other page (guarded on the absence of [data-acc-trigger]). */
(function(){
  if (!document.querySelector('[data-acc-trigger]')) return;
  /* Event delegation, not one listener per trigger: the blog tree above rebuilds its
     triggers at runtime (new posts, new months/years) via window.__n5RebuildBlogTree,
     and a per-node binding would silently stop working on anything built after this
     IIFE ran. Delegating on document means any current OR future [data-acc-trigger] —
     rebuilt, or added by a page nobody's written yet — just works with no re-init call. */
  function setState(btn, open){
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!panel) return;
    if (open) { panel.classList.add('is-open'); panel.removeAttribute('inert'); }
    else { panel.classList.remove('is-open'); panel.setAttribute('inert', ''); }
  }
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-acc-trigger]');
    if (!btn) return;
    var group = btn.getAttribute('data-acc-group') || '';
    var isOpen = btn.getAttribute('aria-expanded') === 'true';
    document.querySelectorAll('[data-acc-trigger]').forEach(function(other){
      if (other !== btn && (other.getAttribute('data-acc-group') || '') === group) setState(other, false);
    });
    setState(btn, !isOpen);
  });
})();

/* Blog page: flat archive tree (root -> years -> months -> leaves) in the top-left
   corner drives an in-place swap of main.page's content between a landing state, a
   single post view, and a LISTING view — no navigation, stays on /blog/. No-op on
   every other page (guarded on the absence of [data-blog-tree]). The accordion above
   this IIFE needs no changes: it delegates purely off data-acc-trigger/data-acc-group,
   so the tree builder's "tree-root" / "tree-years" / "tree-months-YYYY" groups just
   work alongside "projects", including on a rebuilt tree. Leaf clicks are ALSO
   delegated (not bound per-leaf) for the same reason — a rebuilt tree's new leaves
   need no re-binding call.

   Eric, 2026-09-08: "the default view to ALWAYS show the latest blog post... The navigation
   tree, will be expanded to the correct blog post. but also, on every post, instead of
   showing the link for 'ALL POSTS', it should have BLOG > YEAR > MONTH > DAY, above the
   blog title." Four pieces, one rendering path:
     - #blog-list-view stays hidden forever (JS never shows it again — see the <noscript>
       fallback in <head> for the only case it's shown).
     - #blog-landing-view (the page head + "Latest blog" label) is visible by
       default and hidden the moment any post OR listing is selected; there is no way
       back to it (no control removed a "back" affordance was ever built for — the
       tree/breadcrumb are the navigation from here on).
     - #blog-post-view (breadcrumb + body) is the one place a post's content ever
       renders, whether that's the landing's latest post, a tree-clicked leaf, a
       prev/next click, or a listing-row click.
     - #blog-listing-view (crumb + count + rows) is what a BLOG/YEAR/MONTH breadcrumb
       segment renders — a file-manager-style "what's inside this node" view.
       #blog-post-view and #blog-listing-view are mutually exclusive (setActiveView
       toggles between them); #blog-landing-view is independent of that toggle and only
       ever goes from visible to hidden, once, on the first navigation of any kind.
   "Latest" is never hardcoded: it's parsed off the first a.post-row in #blog-list-view,
   which the blog pipeline always emits newest-first — so a newly published post becomes
   the landing post with zero code changes here, same anti-drift principle as the tree.

   Eric, 2026-09-08 (second pass): "Under each blog title... < Previous and Next >...
   so it can cycle between posts" and "Clicking any tree node shows what's inside it
   in the main column, like a file manager." Both reuse the same __n5ReadPostRows
   source of truth and the same showPost() rendering path — no second mechanism.

   🔴 Eric, 2026-09-08 (fifth pass — partial reversal): "Clicking on the tree to access
   the full list of blogs was a mistake as it expands/collapses the tree at the same
   time, and that is not ideal. let's move those links to the breadcrumbs only." A tree
   trigger (BLOG/year/month) now does exactly ONE thing again — expand or collapse its
   own branch, straight accordion behaviour, nothing else observes its clicks. Listings
   are reached from the BREADCRUMB instead: every non-trailing segment (BLOG, and a
   year/month when present) is a real `[data-crumb-scope]` button carrying its scope as
   JSON; clicking one calls showListing() AND opens the tree to the matching branch
   (openScopePath(), the scope-keyed twin of openAncestorPath() below — same "click the
   real trigger buttons" mechanism, same single-open-per-group invariant, just walking a
   scope object instead of a post id). The old suppressListingOnTrigger flag is gone
   with it — nothing needs suppressing any more, since no click on a tree trigger ever
   touches the main column now, synthetic or real. */
(function(){
  var tree = document.querySelector('[data-blog-tree]');
  var listView = document.getElementById('blog-list-view');
  var landingView = document.getElementById('blog-landing-view');
  var postView = document.getElementById('blog-post-view');
  var listingView = document.getElementById('blog-listing-view');
  var crumbNav = postView && postView.querySelector('[data-post-crumb]');
  var body = postView && postView.querySelector('[data-post-body]');
  var listingCrumbEl = listingView && listingView.querySelector('[data-listing-crumb]');
  var listingCountEl = listingView && listingView.querySelector('[data-listing-count]');
  var listingRowsEl = listingView && listingView.querySelector('[data-listing-rows]');
  if (!tree || !listView || !landingView || !postView || !crumbNav || !body ||
      !listingView || !listingCrumbEl || !listingCountEl || !listingRowsEl) return;

  var POSTS = window.__N5_BLOG_POSTS || {};
  var ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HREF_RE = new RegExp(__n5EscapeRe(__n5Base()) + '\\/blog\\/posts\\/(\\d{4}-\\d{2}-\\d{2})\\.html');
  var MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var currentLeaf = null;

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /* Generic "SEG > SEG > SEG" renderer, aria-hidden separators so a screen reader
     hears "Blog, 2026, Aug, 22" (or "Blog, 2026" for a year listing, etc), never the
     chevrons. Used by both the post breadcrumb and the listing header.
     segs: [{ label, scope }] — scope is a listing scope object ({type:'root'} /
     {type:'year',year} / {type:'month',year,month}) or null. Change 1 (2026-09-08):
     every segment EXCEPT the last renders as a real `[data-crumb-scope]` button when it
     carries a scope — the breadcrumb's own path segment (BLOG on a BLOG listing, the
     day on a post) is always last and always plain text, since it's where the page
     already is. */
  function renderCrumbSegs(target, segs){
    target.innerHTML = '';
    segs.forEach(function(seg, i){
      if (i > 0) {
        var sep = document.createElement('span');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = ' > ';
        target.appendChild(sep);
      }
      var isLast = i === segs.length - 1;
      if (!isLast && seg.scope) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'crumb-seg crumb-link';
        btn.textContent = seg.label;
        btn.setAttribute('data-crumb-scope', JSON.stringify(seg.scope));
        target.appendChild(btn);
      } else {
        var span = document.createElement('span');
        span.className = 'crumb-seg crumb-current';
        span.textContent = seg.label;
        target.appendChild(span);
      }
    });
  }

  /* BLOG > YYYY > MON > DD, derived from the post id alone — nothing hardcoded. */
  function buildCrumb(id){
    var m = ID_RE.exec(id);
    if (!m) { crumbNav.innerHTML = ''; return; }
    var year = m[1], month = m[2], day = m[3];
    renderCrumbSegs(crumbNav, [
      { label: 'BLOG', scope: { type: 'root' } },
      { label: year, scope: { type: 'year', year: year } },
      { label: MONTH_ABBR[parseInt(month, 10) - 1] || month, scope: { type: 'month', year: year, month: month } },
      { label: day, scope: null }
    ]);
  }

  function renderExcerpt(id){
    var p = POSTS[id];
    if (!p) return false;
    body.innerHTML =
      '<h1>' + escapeHtml(p.title) + '</h1>' +
      '<p class="post-chips label">' + escapeHtml(p.category) + ' · ' + escapeHtml(p.date) + '</p>' +
      '<article class="prose"><p>' + escapeHtml(p.summary) + '</p></article>';
    return true;
  }

  function renderFull(id){
    var tpl = document.getElementById('post-tpl-' + id);
    if (!tpl) return false;
    body.innerHTML = '';
    body.appendChild(tpl.content.cloneNode(true));
    return true;
  }

  /* Headings follow context, so the page keeps one h1 and a correct outline:
     on the landing, the page head is the h1, so the post under it becomes an h2
     and its own section headings step down to h3; a post opened from the tree
     owns the page and keeps h1/h2. Type is styled off .post-title-h and a shared
     .prose h2,h3 rule, so the level moves without the type changing. */
  function retag(el, tag){
    var out = document.createElement(tag);
    out.className = el.className;
    while (el.firstChild) out.appendChild(el.firstChild);
    return out;
  }

  function setHeadingLevels(asSub){
    /* post bodies use h2 for their sections, so an h1 here is always the title */
    var h = body.querySelector('h1');
    if (h) {
      h.classList.add('post-title-h');
      if (asSub) h.parentNode.replaceChild(retag(h, 'h2'), h);
    }
    if (!asSub) return;
    [].forEach.call(body.querySelectorAll('.prose h2'), function(el){
      el.parentNode.replaceChild(retag(el, 'h3'), el);
    });
  }

  /* Previous (older) / Next (newer) — cycles through __n5ReadPostRows() order
     (newest-first), never hardcoded, so a newly published post threads straight
     into the chain. No wrap-around: the oldest post has no Previous, the newest
     has no Next; the remaining control keeps its side via two always-present flex
     slots (empty ones just carry zero width, so space-between never drifts the
     lone control to the wrong side). */
  function buildPrevNext(id){
    var rows = __n5ReadPostRows(); // newest-first
    var idx = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { idx = i; break; } }
    var older = idx >= 0 ? rows[idx + 1] : null;
    var newer = idx >= 0 && idx > 0 ? rows[idx - 1] : null;

    var nav = document.createElement('nav');
    nav.className = 'post-prevnext';
    nav.setAttribute('aria-label', 'Post navigation');
    var prevSlot = document.createElement('span'); prevSlot.className = 'pn-prev';
    var nextSlot = document.createElement('span'); nextSlot.className = 'pn-next';

    function makeLink(row, label){
      var a = document.createElement('a');
      a.className = 'pill';
      a.href = row.href;
      a.title = row.title;
      a.setAttribute('data-post-nav', row.id);
      a.innerHTML =
        '<span class="pill-l">' + label + '</span>' +
        '<span class="pill-c" aria-hidden="true">' + label + '</span>';
      return a;
    }

    if (older) prevSlot.appendChild(makeLink(older, '‹ Previous'));
    if (newer) nextSlot.appendChild(makeLink(newer, 'Next ›'));
    nav.appendChild(prevSlot);
    nav.appendChild(nextSlot);
    return nav;
  }

  function insertPrevNext(id){
    var old = body.querySelector('.post-prevnext');
    if (old) old.remove();
    var chips = body.querySelector('.post-chips');
    var nav = buildPrevNext(id);
    if (chips && chips.parentNode) chips.insertAdjacentElement('afterend', nav);
    else body.insertBefore(nav, body.firstChild);
  }

  /* The one rendering path: fills the breadcrumb + body + prev/next for a given
     post id. Used by the landing state (latest post), tree-leaf clicks, prev/next
     clicks, and listing-row clicks alike. asSub demotes the headings for the
     embedded-under-the-landing case.
     Eric, 2026-09-09 (mobile Year/Month/Day selector): every one of those triggers —
     PLUS the mobile selector's own proxy-click navigation, which also lands here via
     showPost() — funnels through this one function, so it's the single correct place
     to keep the mobile <select>s in sync with whatever post just got rendered.
     window.__n5SyncMobileNav (defined in the tree-builder IIFE above, only when
     blog.html's mobile-nav markup exists) repaints those three selects to match id;
     this is the other half of "the tree and the selects must never disagree about
     the current post" — see that IIFE's buildMobileNav() comment for the full
     reasoning. Guarded on the hook existing so this line is a silent no-op on any
     page without the mobile markup (post.html, or a future page reusing this IIFE). */
  function renderPost(id, asSub){
    var ok = renderFull(id) || renderExcerpt(id);
    if (ok) {
      buildCrumb(id);
      setHeadingLevels(asSub);
      insertPrevNext(id);
      if (window.__n5SyncMobileNav) window.__n5SyncMobileNav(id);
    }
    return ok;
  }

  function setCurrentLeaf(leaf){
    if (currentLeaf && currentLeaf !== leaf) currentLeaf.removeAttribute('aria-current');
    currentLeaf = leaf || null;
    if (leaf) leaf.setAttribute('aria-current', 'page');
  }

  /* #blog-post-view and #blog-listing-view are mutually exclusive; #blog-landing-view
     is handled separately (see showPost/showListing) since it only ever goes hidden. */
  function setActiveView(which){
    postView.hidden = (which !== 'post');
    listingView.hidden = (which !== 'listing');
  }

  /* Click the real trigger buttons (only the ones not already open) rather than
     poking aria-expanded/inert by hand, so a programmatic open goes through the exact
     same code path — and single-open-per-group invariant — as a real user click. No
     suppression needed any more (Change 1, 2026-09-08): a tree trigger click never
     touches the main column now, synthetic or real, so there's nothing left to guard
     against. */
  function openTriggers(buttons){
    buttons.forEach(function(btn){
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
  }

  /* Deliberate exception to "collapsed by default" (documented in design-system.md):
     a post's ancestors — root, its year, its month — open on selection, every other
     branch stays as it was. */
  function openAncestorPath(id){
    var m = ID_RE.exec(id);
    if (!m) return;
    openTriggers([
      document.getElementById('trig-blog'),
      document.getElementById('trig-y' + m[1]),
      document.getElementById('trig-m' + m[1] + '-' + m[2])
    ]);
  }

  /* Scope-keyed twin of openAncestorPath(), for a breadcrumb-segment click (Change 1,
     2026-09-08): opens the tree to the branch a listing scope names, so the tree keeps
     reflecting what the main column shows exactly like selecting a post already does. */
  function openScopePath(scope){
    var buttons = [document.getElementById('trig-blog')];
    if (scope.type === 'year' || scope.type === 'month') buttons.push(document.getElementById('trig-y' + scope.year));
    if (scope.type === 'month') buttons.push(document.getElementById('trig-m' + scope.year + '-' + scope.month));
    openTriggers(buttons);
  }

  function showPost(id, leaf){
    if (!renderPost(id)) return;
    openAncestorPath(id);
    setCurrentLeaf(leaf || tree.querySelector('[data-post-id="' + id + '"]'));
    setActiveView('post');
    landingView.hidden = true;
  }

  /* Breadcrumb-triggered listing (Change 1, 2026-09-08: moved off tree-node clicks —
     see the top-of-file note). scope is one of:
       { type:'root' } | { type:'year', year } | { type:'month', year, month }
     Rows/groups are sorted ascending (oldest first), matching the tree's own display
     order above it, not the newest-first order of the source "All posts" list. */
  function collectListing(scope){
    var rows = __n5ReadPostRows().filter(function(r){
      if (scope.type === 'year') return r.year === scope.year;
      if (scope.type === 'month') return r.year === scope.year && r.month === scope.month;
      return true;
    });
    rows.sort(function(a, b){
      var ka = a.year + a.month + a.day, kb = b.year + b.month + b.day;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    var crumbSegs = [{ label: 'BLOG', scope: { type: 'root' } }];
    if (scope.type === 'year' || scope.type === 'month') {
      crumbSegs.push({ label: scope.year, scope: { type: 'year', year: scope.year } });
    }
    if (scope.type === 'month') {
      crumbSegs.push({ label: MONTH_ABBR[parseInt(scope.month, 10) - 1] || scope.month, scope: { type: 'month', year: scope.year, month: scope.month } });
    }
    return { rows: rows, crumbSegs: crumbSegs };
  }

  function renderListing(scope){
    var data = collectListing(scope);
    renderCrumbSegs(listingCrumbEl, data.crumbSegs);
    var n = data.rows.length;
    listingCountEl.textContent = n + (n === 1 ? ' post' : ' posts');

    listingRowsEl.innerHTML = '';
    var monthKeys = {};
    data.rows.forEach(function(r){ monthKeys[r.year + '-' + r.month] = true; });
    var spansMonths = Object.keys(monthKeys).length > 1;
    var lastGroup = null;

    data.rows.forEach(function(r){
      var groupKey = r.year + '-' + r.month;
      if (spansMonths && groupKey !== lastGroup) {
        var h = document.createElement('p');
        h.className = 'label';
        h.textContent = (MONTH_FULL[parseInt(r.month, 10) - 1] || r.month) + ' ' + r.year;
        listingRowsEl.appendChild(h);
        lastGroup = groupKey;
      }
      var a = document.createElement('a');
      a.className = 'post-row';
      a.href = r.href;
      a.title = r.title;
      a.setAttribute('data-post-nav', r.id);
      var meta = document.createElement('span'); meta.className = 'post-meta'; meta.textContent = r.day;
      var title = document.createElement('span'); title.className = 'post-title'; title.textContent = r.title;
      a.appendChild(meta);
      a.appendChild(title);
      listingRowsEl.appendChild(a);
    });
  }

  function showListing(scope){
    renderListing(scope);
    setActiveView('listing');
    landingView.hidden = true;
  }

  /* Never hardcoded: the first a.post-row in the (newest-first) list. */
  function getLatestId(){
    var first = listView.querySelector('a.post-row');
    var href = first && first.getAttribute('href');
    var m = href && HREF_RE.exec(href);
    return m ? m[1] : null;
  }

  /* Landing init: resolve "latest", open the tree to it, render it into the shared
     post view, and keep #blog-landing-view visible (this is the only entry point that
     does NOT hide it). Exposed as a test hook so the auto-update proof can re-run it
     after injecting synthetic posts + rebuilding the tree, without a real page reload. */
  function initLanding(){
    var id = getLatestId();
    if (!id) return;
    setActiveView('post');
    openAncestorPath(id);
    setCurrentLeaf(tree.querySelector('[data-post-id="' + id + '"]'));
    renderPost(id, true);
    landingView.hidden = false;
  }

  /* Leaf clicks: open that post, exactly as before. */
  tree.addEventListener('click', function(e){
    var leaf = e.target.closest && e.target.closest('[data-blog-leaf]');
    if (!leaf || !tree.contains(leaf)) return;
    e.preventDefault();
    showPost(leaf.getAttribute('data-post-id'), leaf);
  });

  /* Previous/Next pills AND listing-row clicks share one delegate: both are plain
     <a data-post-nav="YYYY-MM-DD"> links to a real /blog/posts/*.html URL (so they
     work with no JS too), intercepted here to swap in place instead — the exact same
     showPost() path as a tree-leaf click. */
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('[data-post-nav]');
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-post-nav');
    showPost(id, tree.querySelector('[data-post-id="' + id + '"]'));
  });

  /* Breadcrumb-segment clicks (Change 1, 2026-09-08): the one way to reach a listing
     now that tree-node clicks no longer do it — see the top-of-file note. Delegated on
     document so one listener covers both crumbNav (the post view's breadcrumb) and
     listingCrumbEl (a listing's own header, whose ancestor segments stay clickable). */
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-crumb-scope]');
    if (!btn) return;
    e.preventDefault();
    var scope;
    try { scope = JSON.parse(btn.getAttribute('data-crumb-scope')); } catch (err) { return; }
    openScopePath(scope);
    showListing(scope);
  });

  initLanding();
  window.__n5InitBlogLanding = initLanding;
})();
