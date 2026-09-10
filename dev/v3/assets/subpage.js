/* N5HQ edge draft — piece 4 "Subpage chrome" load-reveal + pane-swap navigation
   Extends the home.html corner-reveal script (same WAAPI mechanics, same
   __n5RevealAt(ms)/__n5RevealPlay() scrub hooks) to the subpage's two
   corners (no .bl on subpages) plus the content column, which joins the
   choreography at 180ms — half-way between the corners' 0ms and 360ms.

   Pane-swap contract (01 Design/design-loop/pane-swap-plan.md, "REVISION
   2026-09-10 (Opus review)" — that section is authoritative over the rest of
   the plan document where they disagree):

     window.__n5Subpage = {
       init(root)     // root = the live <main id="main">. Callers guarantee
                       // destroy() ran first. Swallows its own errors so one
                       // failing module can never strand the pane invisible.
       destroy()      // Tears down everything init attached. Safe to call
                       // with nothing initialised. MUST NOT cancel a reveal
                       // animation on an element staying in the DOM (see the
                       // reveal() comment below for why).
       reveal(root)    // Targets [root, .blog-tree]. INSTANT (2026-09-11):
                       // forces opacity:1/transform:none inline immediately,
                       // no animation — a router swap must not look like a
                       // page load. The 500ms .15->1 load fade is now
                       // exclusive to the initial page load
                       // (runInitialReveal(), not part of this contract).
                       // Guarantees a readable end state even on error.
     }

   All three return void. The router (bottom of this file) calls them in
   sequence: destroy() -> replaceWith(newMain) -> init(newMain) -> reveal(newMain).
*/

/* Base-path helpers (added for the /dev/v3 deploy build, scripts/build_dev_preview.py):
   a deployed copy sets window.__N5_BASE (e.g. '/dev/v3') in an inline <script> before
   this file loads, so every post-URL regex below can match/build paths under that
   prefix instead of the bare "/blog/posts/..." this file used to hardcode. Unset
   (the design source served at "/") resolves to '', which reproduces the exact prior
   behaviour — a single source of truth instead of sprinkling the prefix through the
   file. Declared at top level (not inside an IIFE) because multiple pieces below
   need it, including the router. */
function __n5Base(){
  return (typeof window !== 'undefined' && window.__N5_BASE) || '';
}
function __n5EscapeRe(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Shared post-list reader (Eric, 2026-09-08, tree-listing pass): the archive tree
   builder, the tree-node listing view, AND the prev/next controls all need the same
   ordered, parsed view of the real post list (#blog-list-view .post-row) — the single
   source of truth, per Eric's "everything must stay derived from the rendered post
   list" instruction. One function, used by all three, so they can never disagree.
   DOM order is newest-first, matching the blog pipeline's own "All posts" output.
   Reads whatever #blog-list-view is currently live in the document — after a pane
   swap that is the freshly-arrived one, so this needs no root parameter. */
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

/* ============================================================================
   window.__n5Subpage — reveal + blog module (tree, landing/post/listing swap),
   wrapped so it can be torn down and re-run against a fresh <main> on every
   pane swap without double-attaching any listener or leaking DOM state.
   ============================================================================ */
window.__n5Subpage = (function(){
  'use strict';

  function isReducedMotion(){
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function forceReadable(elToForce){
    try { elToForce.style.opacity = '1'; elToForce.style.transform = 'none'; }
    catch (e) { /* nothing more can be done for this element */ }
  }

  /* ---------------------------------------------------------------------
     Shared WAAPI reveal animations. revealAnims accumulates animation
     handles across the whole session (initial load + every swap) so the
     existing __n5RevealAt/__n5RevealPlay scrub hooks keep working against
     whatever most recently ran. destroy() (below) clears this array by
     dropping references, NEVER by calling .cancel() on its contents:
     fill:'both' means a finished reveal is still *holding* opacity:1 purely
     in the animation's own output, not committed to inline style — cancelling
     it would snap a still-visible element (the persistent .blog-tree, or
     #main before it's replaced) straight back to CSS rest (.15). Only
     elements that are about to leave the DOM via replaceWith() are safe to
     let their animations go stale; nothing here ever cancels anything.
     --------------------------------------------------------------------- */
  var revealAnims = [];

  /* Pane-swap reveal: contract's reveal(root). Targets root itself plus the
     persistent archive tree (outside <main>, in .corner.tl) — a swap that
     changed the tree (arriving/leaving /blog/) must reveal it too, or it
     pops in at full opacity while the pane still fades under it.

     INSTANT, not animated (2026-09-11, perceived-latency fix). This function
     is only ever called from the router's swap path (doSwap(), bottom of
     this file) — never from the initial page load, which runs
     runInitialReveal() below instead. A router swap is not a page load: the
     `window` sentinel survives the click, the fetch resolves in ~70ms, and
     staying on the page must not be dressed up to look like leaving it. The
     old 500ms .15->1 fade reused the load choreography here and made every
     nav click read as a page load — exactly the symptom this fixes. So on a
     swap there is nothing to animate: force both targets straight to their
     readable end state, same as the reduced-motion branch always did. This
     keeps the same "finally"-style guarantee (forceReadable itself is
     try/catch-wrapped) without ever parking the pane at CSS rest (.15) for
     any measurable time. */
  function reveal(root){
    var targets = [root, document.querySelector('.blog-tree')].filter(function(t){ return !!t; });
    targets.forEach(forceReadable);
  }

  /* Initial page-load reveal: corners at 0ms, content column at 180ms, header
     nav corner at 360ms — the one orchestrated load moment, unchanged from
     before this refactor. Runs exactly once, via whenReady() below; pane
     swaps use reveal() above instead, which has no corner stagger left to
     join (see pane-swap-plan.md's "Design decision" section). */
  var initialTargets = [
    { el: document.getElementById('c-tl'), delay: 0 },
    { el: document.getElementById('main'), delay: 180 },
    { el: document.getElementById('c-tr'), delay: 360 }
  ].filter(function (t) { return !!t.el; });

  function runInitialReveal(){
    if (isReducedMotion()) {
      initialTargets.forEach(function(t){ forceReadable(t.el); });
      return;
    }
    initialTargets.forEach(function (t) {
      var anim = t.el.animate(
        [
          { opacity: .15, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 500, delay: t.delay, easing: 'ease-out', fill: 'both' }
      );
      revealAnims.push(anim);
    });
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
    runInitialReveal();
    window.__n5ReadyAt = performance.now();
    window.__n5PageReady = true;
  });

  /* =========================================================================
     Blog module: archive tree builder + mobile Year/Month/Day selector +
     landing/post/listing swap. Blog-only — every function below no-ops
     cleanly (via the `blogEls` guard) on About/Projects, where init() finds
     none of the required elements inside <main> and leaves blogEls null.

     `treeNav` (.blog-tree, in .corner.tl) and `document`-delegated listeners
     are queried/bound EXACTLY ONCE, below, at module-eval time — never inside
     init() — because they live outside <main> and survive every swap
     untouched. Re-binding them per init() would double-attach on the second
     swap and misfire by the third; this is the exact bug the phase-1
     checkpoint (see the router section) exists to catch.
     ========================================================================= */

  var treeNav = document.querySelector('[data-blog-tree]');

  /* Reset on every init()/destroy() cycle — see the plan's state table. */
  var POSTS = {};
  var currentLeaf = null;
  var blogEls = null; // non-null only when the current <main> is a blog page

  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MOBILE_NAV_ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /* ---- tree DOM builders (former IIFE 3) ---- */

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

  function readPosts(){
    return __n5ReadPostRows();
  }

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
    /* Decoupled from blogEls (PHASE 5, B2, 2026-09-11): the archive tree is
       chrome that lives OUTSIDE #main and needs only treeNav + a live
       #blog-list-view to render — it must populate on a lone generated post
       page just as it does on the blog index. blogEls (the landing/post/
       listing views) is blog-INDEX-only and irrelevant here. */
    if (!treeNav) return;
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

    treeNav.innerHTML = '';
    treeNav.appendChild(root);
  }

  function buildMobileNav(root){
    /* Decoupled from blogEls for the same reason as buildTree() above — the
       mobile date-picker is chrome, not blog-index view state. On a page
       with no [data-blog-mobile-nav] (every generated post page) the guard
       just below this one already no-ops. */
    if (!root) return;
    var nav = root.querySelector('[data-blog-mobile-nav]');
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
      /* The router owns post navigation now (PHASE 5, B2): give the hidden
         proxy anchor a REAL href so the router's own delegated document
         click listener (matchRoute() on a[href]) picks up this synthetic
         click, fetches the real generated post page, and swaps the pane —
         the same path a genuine <a href> click takes. Previously this set
         data-post-nav and relied on a bespoke [data-post-nav] handler that
         called showPost() directly; that handler is gone. */
      var rows = __n5ReadPostRows();
      var row = null;
      for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { row = rows[i]; break; } }
      if (!row) return;
      proxy.href = row.href;
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

    var curLeaf = document.querySelector('[data-blog-leaf][aria-current="page"]');
    var initialId = curLeaf ? curLeaf.getAttribute('data-post-id') : null;
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
    buildMobileNav(document.getElementById('main'));
  }
  window.__n5RebuildBlogTree = rebuildBlogNav;

  /* ---- landing / post / listing render (former IIFE 5) ---- */

  function hrefRe(){
    return new RegExp(__n5EscapeRe(__n5Base()) + '\\/blog\\/posts\\/(\\d{4}-\\d{2}-\\d{2})\\.html');
  }

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

  function buildCrumb(id){
    if (!blogEls) return;
    var m = ID_RE.exec(id);
    if (!m) { blogEls.crumbNav.innerHTML = ''; return; }
    var year = m[1], month = m[2], day = m[3];
    renderCrumbSegs(blogEls.crumbNav, [
      { label: 'BLOG', scope: { type: 'root' } },
      { label: year, scope: { type: 'year', year: year } },
      { label: MONTH_ABBR[parseInt(month, 10) - 1] || month, scope: { type: 'month', year: year, month: month } },
      { label: day, scope: null }
    ]);
  }

  function renderExcerpt(id){
    if (!blogEls) return false;
    var p = POSTS[id];
    if (!p) return false;
    blogEls.body.innerHTML =
      '<h1>' + escapeHtml(p.title) + '</h1>' +
      '<p class="post-chips label">' + escapeHtml(p.category) + ' · ' + escapeHtml(p.date) + '</p>' +
      '<article class="prose"><p>' + escapeHtml(p.summary) + '</p></article>';
    return true;
  }

  function renderFull(id){
    if (!blogEls) return false;
    var tpl = document.getElementById('post-tpl-' + id);
    if (!tpl) return false;
    blogEls.body.innerHTML = '';
    blogEls.body.appendChild(tpl.content.cloneNode(true));
    return true;
  }

  function retag(node, tag){
    var out = document.createElement(tag);
    out.className = node.className;
    while (node.firstChild) out.appendChild(node.firstChild);
    return out;
  }

  function setHeadingLevels(asSub){
    if (!blogEls) return;
    var h = blogEls.body.querySelector('h1');
    if (h) {
      h.classList.add('post-title-h');
      if (asSub) h.parentNode.replaceChild(retag(h, 'h2'), h);
    }
    if (!asSub) return;
    [].forEach.call(blogEls.body.querySelectorAll('.prose h2'), function(n){
      n.parentNode.replaceChild(retag(n, 'h3'), n);
    });
  }

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
    if (!blogEls) return;
    var old = blogEls.body.querySelector('.post-prevnext');
    if (old) old.remove();
    var chips = blogEls.body.querySelector('.post-chips');
    var nav = buildPrevNext(id);
    if (chips && chips.parentNode) chips.insertAdjacentElement('afterend', nav);
    else blogEls.body.insertBefore(nav, blogEls.body.firstChild);
  }

  function renderPost(id, asSub){
    if (!blogEls) return false;
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

  function setActiveView(which){
    if (!blogEls) return;
    blogEls.postView.hidden = (which !== 'post');
    blogEls.listingView.hidden = (which !== 'listing');
  }

  function setLandingHidden(hidden){
    if (!blogEls) return;
    blogEls.landingView.hidden = hidden;
    blogEls.landingTail.hidden = hidden;
  }

  function openTriggers(buttons){
    buttons.forEach(function(btn){
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
  }

  function openAncestorPath(id){
    var m = ID_RE.exec(id);
    if (!m) return;
    openTriggers([
      document.getElementById('trig-blog'),
      document.getElementById('trig-y' + m[1]),
      document.getElementById('trig-m' + m[1] + '-' + m[2])
    ]);
  }

  function openScopePath(scope){
    var buttons = [document.getElementById('trig-blog')];
    if (scope.type === 'year' || scope.type === 'month') buttons.push(document.getElementById('trig-y' + scope.year));
    if (scope.type === 'month') buttons.push(document.getElementById('trig-m' + scope.year + '-' + scope.month));
    openTriggers(buttons);
  }

  /* PHASE 5, B2 (2026-09-11): a lone generated post page has no blogEls (no
     landing/post/listing views — see initBlogModule() below), so there is
     no POSTS-derived "current id" to read. Derive it straight from the
     URL instead — the one thing every post page reliably has. */
  function getCurrentPostIdFromLocation(){
    var m = hrefRe().exec(location.pathname);
    return m ? m[1] : null;
  }

  function highlightCurrentPost(){
    var id = getCurrentPostIdFromLocation();
    if (!id) return;
    openAncestorPath(id);
    setCurrentLeaf(treeNav && treeNav.querySelector('[data-post-id="' + id + '"]'));
  }

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
    if (!blogEls) return;
    var data = collectListing(scope);
    renderCrumbSegs(blogEls.listingCrumbEl, data.crumbSegs);
    var n = data.rows.length;
    blogEls.listingCountEl.textContent = n + (n === 1 ? ' post' : ' posts');

    blogEls.listingRowsEl.innerHTML = '';
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
        blogEls.listingRowsEl.appendChild(h);
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
      blogEls.listingRowsEl.appendChild(a);
    });
  }

  function showListing(scope){
    if (!blogEls) return;
    renderListing(scope);
    setActiveView('listing');
    setLandingHidden(true);
  }

  function getLatestId(){
    if (!blogEls) return null;
    var first = blogEls.listView.querySelector('a.post-row');
    var href = first && first.getAttribute('href');
    var m = href && hrefRe().exec(href);
    return m ? m[1] : null;
  }

  function initLanding(){
    if (!blogEls) return;
    var id = getLatestId();
    if (!id) return;
    setActiveView('post');
    openAncestorPath(id);
    setCurrentLeaf(treeNav && treeNav.querySelector('[data-post-id="' + id + '"]'));
    renderPost(id, true);
    setLandingHidden(false);
  }
  window.__n5InitBlogLanding = initLanding;

  /* ---- ONE-TIME delegated listeners — bound here, at module-eval time,
     never inside init(). treeNav and document both survive every swap, so
     re-binding on each init() would double- (then triple-) attach. Every
     handler consults the CURRENT module state (blogEls/treeNav) at fire
     time, so it stays correct across any number of destroy()/init() cycles
     with no rebinding needed. ----

     PHASE 5, B2 (2026-09-11): the tree-leaf handler and the [data-post-nav]
     handler used to live here, each calling e.preventDefault() then
     showPost() to render a post IN PLACE inside blog.html's #blog-post-view.
     Both are gone. Every post is now a real page at blog/posts/<date>.html
     and every leaf/[data-post-nav] anchor already carries that real href
     (tree leaves: makeLeaf() above; listing rows: renderListing() below;
     prev/next pills: buildPrevNext() below; the mobile-nav proxy: navigate()
     above). leaf -> treeNav -> document is ONE bubble path, so preventDefault
     here was exactly what stopped the router's own delegated click listener
     (subpage.js, router IIFE, e.defaultPrevented guard) from ever seeing
     these clicks. Removing both handlers lets the click reach the router
     unmolested, which matchRoute()s it to 'post' and does the real pane
     swap/fetch — nothing else needs to run for a click on these anchors. */

  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-crumb-scope]');
    if (!btn || !blogEls) return;
    e.preventDefault();
    var scope;
    try { scope = JSON.parse(btn.getAttribute('data-crumb-scope')); } catch (err) { return; }
    openScopePath(scope);
    showListing(scope);
  });

  /* =========================================================================
     Public contract
     ========================================================================= */

  function initBlogModule(root){
    if (!treeNav) return;
    var listView = root.querySelector('#blog-list-view');
    if (!listView) return; // not a blog-family page (About/Projects) — tree stays untouched

    /* PHASE 5, B2 (2026-09-11): tree-building needs only treeNav + this
       #blog-list-view — nothing below this point is required for it. Run it
       unconditionally for ANY page that has a list view, including a lone
       generated post page, so the archive tree no longer goes dark there. */
    buildTree();
    buildMobileNav(root);

    var landingView = root.querySelector('#blog-landing-view');
    var landingTail = root.querySelector('#blog-landing-tail');
    var postView = root.querySelector('#blog-post-view');
    var listingView = root.querySelector('#blog-listing-view');
    var crumbNav = postView && postView.querySelector('[data-post-crumb]');
    var body = postView && postView.querySelector('[data-post-body]');
    var listingCrumbEl = listingView && listingView.querySelector('[data-listing-crumb]');
    var listingCountEl = listingView && listingView.querySelector('[data-listing-count]');
    var listingRowsEl = listingView && listingView.querySelector('[data-listing-rows]');
    var isBlogIndex = !!(landingView && landingTail && postView && crumbNav && body &&
      listingView && listingCrumbEl && listingCountEl && listingRowsEl);

    if (!isBlogIndex) {
      /* A lone generated post page (or any future page shipping only a
         #blog-list-view): no landing/post/listing views to drive, and none
         should be synthesized — the page's own static article.prose is the
         content, untouched. Just reflect where we are in the tree. */
      blogEls = null;
      POSTS = {};
      window.__N5_BLOG_POSTS = POSTS;
      currentLeaf = null;
      highlightCurrentPost();
      return;
    }

    var postsEl = root.querySelector('#n5-blog-posts');
    var posts = {};
    if (postsEl) {
      try { posts = JSON.parse(postsEl.textContent) || {}; }
      catch (e) { posts = {}; }
    } else {
      posts = window.__N5_BLOG_POSTS || {};
    }
    POSTS = posts;
    /* Keep window.__N5_BLOG_POSTS pointing at the same object POSTS closes over —
       anything outside this module that reaches in and mutates it (e.g. a
       verification harness's synthetic-post injection) needs that mutation to
       reach the render above. */
    window.__N5_BLOG_POSTS = POSTS;

    blogEls = {
      listView: listView, landingView: landingView, landingTail: landingTail,
      postView: postView, listingView: listingView, crumbNav: crumbNav, body: body,
      listingCrumbEl: listingCrumbEl, listingCountEl: listingCountEl, listingRowsEl: listingRowsEl
    };
    currentLeaf = null;

    initLanding();
  }

  function init(root){
    if (!root) return;
    /* Each module's init wrapped in its own try/catch — one failure must not
       strand the pane at opacity .15 (reveal() still runs unconditionally
       afterwards from the router). */
    try { initBlogModule(root); }
    catch (e) { if (window.console) console.error('[n5subpage] init failed', e); }
  }

  function destroy(){
    /* Drop references only — never .cancel(): a completed reveal is still
       *holding* opacity:1 via fill:'both', and .blog-tree/#main are staying
       in the DOM (or #main is about to leave via replaceWith, which makes
       cancelling it moot but never required). See the revealAnims comment
       above for the full reasoning. */
    revealAnims.length = 0;

    if (treeNav) treeNav.innerHTML = '';
    window.__n5SyncMobileNav = null;

    POSTS = {};
    window.__N5_BLOG_POSTS = POSTS;
    currentLeaf = null;
    blogEls = null;
  }

  return { init: init, destroy: destroy, reveal: reveal };
})();

/* Initial call moved to the very bottom of this file (see the closing
   comment there) — it must run AFTER every other IIFE, including the
   Projects-page accordion below, has registered its listeners. */

/* Wordmark lockup: still image at rest; the entry clip autoplays once on
   load, the hover clip plays once per pointer-enter. Ported verbatim from
   home.html — the corner is "unchanged" per the subpage spec. Lives in the
   header, outside <main>, so it needs no init/destroy work: a pane swap
   never touches it. */
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

/* Projects page accordion: Completed / In Progress / Upcoming, single-open.
   No-op on every other page: the delegated click handler below tests
   e.target.closest('[data-acc-trigger]') and returns early when there is no
   match, so the listener attaches everywhere but only ever fires on a page
   that actually has a trigger. Delegated on document, bound once at load —
   survives every pane swap and every tree rebuild with no changes needed. */
(function(){
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

/* =============================================================================
   Router: pane-swap navigation for /about/, /portfolio/, /blog/ and
   /blog/posts/*.html. Everything else (home "/", external hosts, mailto:,
   modifier/middle/target=_blank clicks) falls through to a normal navigation.
   Any failure along the swap path falls back to a full `location.href` load
   rather than ever leaving the user on a broken or invisible pane.
   ============================================================================= */
(function(){
  'use strict';

  try { history.scrollRestoration = 'manual'; } catch (e) {}

  function matchRoute(pathname){
    var base = __n5EscapeRe(__n5Base());
    if (new RegExp('^' + base + '\\/about\\/?$').test(pathname)) return 'about';
    if (new RegExp('^' + base + '\\/portfolio\\/?$').test(pathname)) return 'projects';
    if (new RegExp('^' + base + '\\/blog\\/?$').test(pathname)) return 'blog';
    if (new RegExp('^' + base + '\\/blog\\/posts\\/[^\\/]+\\.html$').test(pathname)) return 'post';
    return null;
  }

  function pillSuffixForRoute(route){
    if (route === 'about') return '/about/';
    if (route === 'projects') return '/portfolio/';
    if (route === 'blog' || route === 'post') return '/blog/';
    return null;
  }

  function setActivePill(route){
    var suffix = pillSuffixForRoute(route);
    if (!suffix) return;
    var nav = document.querySelector('.corner.tr nav[aria-label="Links"]');
    if (!nav) return;
    nav.querySelectorAll(':scope > a.pill').forEach(function(p){
      var href = p.getAttribute('href') || '';
      if (href.length >= suffix.length && href.slice(-suffix.length) === suffix) {
        p.setAttribute('aria-current', 'page');
      } else {
        p.removeAttribute('aria-current');
      }
    });
  }

  function isEffectivelyHidden(node){
    var n = node;
    while (n && n.nodeType === 1) {
      if (n.hidden) return true;
      n = n.parentElement;
    }
    return false;
  }

  /* Focus target after a swap: the page's own real, visible <h1> — never the
     blog listing's h1[data-listing-crumb] (renders empty) and never a
     no-JS-only h1 sitting inside a [hidden] ancestor (e.g. blog.html's
     #blog-list-view fallback copy). Falls back to #main itself with
     tabindex="-1" when nothing qualifies. */
  function focusAfterSwap(root){
    var h1s = root.querySelectorAll('h1');
    var target = null;
    for (var i = 0; i < h1s.length; i++) {
      var h = h1s[i];
      if (!isEffectivelyHidden(h) && h.textContent && h.textContent.trim()) { target = h; break; }
    }
    if (!target) {
      root.setAttribute('tabindex', '-1');
      target = root;
    }
    try { target.focus({ preventScroll: true }); }
    catch (e) { try { target.focus(); } catch (e2) {} }
  }

  function doSwap(url, route, isForward, scrollTarget){
    var api = window.__n5Subpage;
    fetch(url, { credentials: 'same-origin' })
      .then(function(res){
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
        return res.text();
      })
      .then(function(html){
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newMain = doc.getElementById('main');
        if (!newMain) throw new Error('fetched document has no #main: ' + url);
        var title = doc.title || document.title;
        var imported = document.adoptNode(newMain);

        var oldMain = document.getElementById('main');
        if (!oldMain) throw new Error('no live #main to replace');

        api.destroy();
        oldMain.replaceWith(imported); // never innerHTML — see contract note 4

        /* PHASE 5, B2 (2026-09-11): pushState moved BEFORE api.init() (it used to run
           after). A generated post page's init path (highlightCurrentPost(), see
           __n5Subpage above) derives "which post is this" from location.pathname —
           on a forward navigation that must already be the NEW url by the time init()
           runs, or the tree can't tell which leaf/branch to mark current. A popstate
           (back/forward) needs no such call here: the browser has already updated
           location by the time its handler fires. */
        if (isForward) {
          history.pushState({ n5subpage: true, url: url, scrollY: 0 }, '', url);
        }

        api.init(imported);
        api.reveal(imported);

        document.title = title;
        setActivePill(route);
        focusAfterSwap(imported);

        if (isForward) {
          window.scrollTo(0, 0);
        } else {
          window.scrollTo(0, scrollTarget || 0);
        }
      })
      .catch(function(err){
        if (window.console) console.error('[n5subpage] route swap failed, falling back to full navigation', err);
        window.location.href = url;
      });
  }

  function navigate(url, route){
    try {
      var curState = (history.state && history.state.n5subpage) ? history.state : { n5subpage: true, url: window.location.href };
      history.replaceState(
        { n5subpage: true, url: curState.url || window.location.href, scrollY: window.scrollY || window.pageYOffset || 0 },
        '', window.location.href
      );
    } catch (e) {}
    doSwap(url, route, true, 0);
  }

  try {
    if (!history.state || !history.state.n5subpage) {
      history.replaceState({ n5subpage: true, url: window.location.href, scrollY: 0 }, '', window.location.href);
    }
  } catch (e) {}

  document.addEventListener('click', function(e){
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '' && a.target !== '_self') return; // target=_blank etc.
    if (a.hasAttribute('download')) return;
    var dest;
    try { dest = new URL(a.href, document.baseURI); } catch (err) { return; }
    if (dest.origin !== window.location.origin) return; // external host
    if (dest.protocol !== 'http:' && dest.protocol !== 'https:') return; // mailto:, tel:, etc.
    var route = matchRoute(dest.pathname);
    if (!route) return; // not in the intercept set (includes "/" home) — normal navigation

    e.preventDefault();
    navigate(a.href, route); // fetch a.href verbatim: works under /dev/v3 and unprefixed alike
  });

  window.addEventListener('popstate', function(e){
    var state = e.state;
    if (!state || !state.n5subpage) { window.location.reload(); return; }
    var route = matchRoute(window.location.pathname);
    if (!route) { window.location.reload(); return; }
    doSwap(window.location.href, route, false, state.scrollY || 0);
  });
})();

/* Initial call — mirrors the pre-refactor behaviour: build the tree, load
   POSTS, and render the landing/post view for whatever <main> shipped in the
   raw HTML. The router above calls destroy()/init()/reveal() again on every
   subsequent pane swap.

   WHY THIS SITS AT THE BOTTOM OF THE FILE, NOT right after __n5Subpage is
   defined: initLanding() -> openAncestorPath() -> openTriggers() dispatches
   SYNTHETIC btn.click() calls to open the ancestor tree branch (e.g. BLOG /
   2026 / AUG) for whatever deep link the page loaded on. Those clicks are
   only caught by the delegated `document.addEventListener('click', ...)`
   listener in the "Projects page accordion" IIFE further up this file. If
   init() ran before that listener was attached, the synthetic clicks fire
   into a void: aria-expanded stays "false", the panel stays `inert`, and
   every trigger/leaf under it is unfocusable and unclickable. Keeping this
   call last guarantees every listener in the file is already bound before
   any synthetic click can fire — do NOT move this back up, and do NOT
   "tidy" it next to the __n5Subpage definition. */
window.__n5Subpage.init(document.getElementById('main'));
