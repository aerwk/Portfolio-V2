/* N5HQ design loop — piece 2 "Instruments"
 * Vanilla ES5, no dependencies. window.N5Instruments = { mount, setClusterState }
 *
 * Mount points (elements already in the caller's markup, found inside the
 * root passed to mount()):
 *   [data-n5i="clock"]      -> replaces static "00:00 AM" fallback with an
 *                              odometer clock, Australia/Perth, H:MM + AM/PM.
 *   [data-n5i="telemetry"]  -> enhances the existing [data-stat] numbers in
 *                              place (keeps the data-stat attributes) with
 *                              odometer columns, and wires up the state dot
 *                              found at [data-n5i-dot] inside it.
 *   [data-n5i="dim"]        -> becomes the WWWW x HHHH viewport dimension
 *                              readout, an inline footnote at the end of
 *                              the dimmed sentence it sits in, rolling on
 *                              resize.
 *
 * Nothing here paints anything but bone/carbon/the one glow dot, and nothing
 * moves under prefers-reduced-motion: reduce.
 */
(function (global) {
  'use strict';

  var REDUCED = false;
  try {
    REDUCED = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { REDUCED = false; }

  var dots = []; /* registered state dots, for setClusterState */

  /* Run `cb` only after glyphs exist (document.fonts.ready) and after the
     browser has committed at least one paint of the "at rest" (pos 0)
     odometer state — otherwise the browser coalesces the 0 -> target style
     change into the very first frame and no transition ever plays. Two
     rAFs guarantee a paint has happened between "built" and "rolled". */
  function whenReady(cb) {
    function afterPaint() {
      global.requestAnimationFrame(function () {
        global.requestAnimationFrame(cb);
      });
    }
    if (global.document && document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(afterPaint, afterPaint);
    } else {
      afterPaint();
    }
  }

  /* ---------- odometer primitive ---------- */

  var allCols = []; /* every odometer column ever built, for row-height snapping */

  /* measure the column's real rendered row height and pin --n5i-row to an
     integer pixel value, so translateY always lands on a whole device
     pixel (no fractional-pixel subpixel antialiasing / colour fringing). */
  function snapRow(col) {
    /* col.getBoundingClientRect() is self-referential — .n5i-odo is CSS-
       height-locked to var(--n5i-row) already, so measuring the column
       itself just confirms whatever --n5i-row happens to be, never the
       font's real line-box. Measure the first row's natural size instead,
       with its own height/line-height override lifted, so a font whose
       glyphs sit taller or shorter in their em-box than the previous one
       (e.g. Bigger Display vs Doto on the clock) gets its own correct
       peephole instead of inheriting the old font's number. */
    var strip = col.querySelector('.n5i-odo-strip');
    var probe = strip && strip.firstChild;
    if (!probe) return;
    /* Display (clock) columns: fit the row to the digits' INK — cap top flush
       with the row top, baseline flush with the row bottom — so the AM/PM
       stack and the prose baseline can align to the visible glyph edges,
       not to the font's line-box slack above and below them. */
    if (col.className.indexOf('n5i-odo--display') !== -1) {
      var m = inkMetrics(probe, '0123456789');
      if (m) {
        var inkA = Math.ceil(m.inkA), inkD = Math.ceil(m.inkD);
        col.style.setProperty('--n5i-row', (inkA + inkD) + 'px');
        col.style.setProperty('--n5i-lh', (2 * inkA - m.fA + m.fD) + 'px');
        return;
      }
    }
    var prevH = probe.style.height;
    var prevLH = probe.style.lineHeight;
    probe.style.height = 'auto';
    probe.style.lineHeight = 'normal';
    var h = probe.getBoundingClientRect().height;
    probe.style.height = prevH;
    probe.style.lineHeight = prevLH;
    if (h > 0) col.style.setProperty('--n5i-row', Math.round(h) + 'px');
  }

  /* Ink bounds of `text` in `el`'s computed font, via canvas measureText.
     Returns null where the browser lacks fontBoundingBox metrics, and the
     caller falls back to the natural line-box. inkA/inkD = ink above/below
     the baseline; fA/fD = the font's ascent/descent (what CSS uses to
     centre a glyph in a line box). To put the ink top exactly at the top
     of a line box of height L: L = 2*inkA - fA + fD. */
  function inkMetrics(el, text) {
    try {
      var cs = getComputedStyle(el);
      var c = inkMetrics._c || (inkMetrics._c = document.createElement('canvas'));
      var ctx = c.getContext('2d');
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var m = ctx.measureText(text);
      if (m.actualBoundingBoxAscent == null || m.fontBoundingBoxAscent == null) return null;
      return { inkA: m.actualBoundingBoxAscent, inkD: m.actualBoundingBoxDescent,
               fA: m.fontBoundingBoxAscent, fD: m.fontBoundingBoxDescent };
    } catch (e) { return null; }
  }

  /* size a text span to its own ink: box height = ink height, line-height
     chosen so the ink sits flush top and bottom. Used for the AM/PM stack. */
  function fitInk(el) {
    var m = inkMetrics(el, el.textContent);
    if (!m) return;
    var inkA = Math.ceil(m.inkA), inkD = Math.ceil(m.inkD);
    el.style.display = 'block';
    el.style.height = (inkA + inkD) + 'px';
    el.style.lineHeight = (2 * inkA - m.fA + m.fD) + 'px';
  }

  function snapAllRows() {
    var i;
    for (i = 0; i < allCols.length; i++) snapRow(allCols[i]);
  }

  function buildOdometerColumn(displayClass) {
    var col = document.createElement('span');
    col.className = 'n5i-odo' + (displayClass ? ' ' + displayClass : '');
    col.setAttribute('data-pos', '0');
    var strip = document.createElement('span');
    strip.className = 'n5i-odo-strip';
    /* two passes of 0-9 so a 9->0 rollover keeps translating in the same
       direction instead of snapping backward ("never bounces"). */
    var i;
    for (i = 0; i < 20; i++) {
      var row = document.createElement('span');
      row.textContent = String(i % 10);
      strip.appendChild(row);
    }
    col.appendChild(strip);
    /* commit the "at rest" position explicitly and force a synchronous
       layout so this is a real, painted frame — not a state the browser
       can optimise away before the later roll to target. */
    strip.style.setProperty('--n5i-dur', '0ms');
    strip.style.setProperty('--n5i-pos', '0');
    void strip.offsetHeight;
    allCols.push(col);
    return col;
  }

  /* set a column to show `digit` (0-9). opts: {duration:ms, instant:bool} */
  function setOdometerDigit(col, digit, opts) {
    opts = opts || {};
    var strip = col.querySelector('.n5i-odo-strip');
    var cur = parseInt(col.getAttribute('data-pos'), 10) || 0;
    var curDigit = cur % 10;
    var delta = (digit - curDigit + 10) % 10;
    var next = cur + delta;

    if (delta === 0 && !opts.force) return;

    var duration = REDUCED ? 0 : (opts.duration != null ? opts.duration : 500);
    strip.style.setProperty('--n5i-dur', duration + 'ms');
    col.setAttribute('data-pos', String(next));
    strip.style.setProperty('--n5i-pos', String(next));

    if (next >= 10) {
      /* fold back to the equivalent low position once the roll finishes —
         the strip repeats every 10 rows so this is visually identical. */
      var settle = function () {
        strip.style.setProperty('--n5i-dur', '0ms');
        var folded = next - 10;
        col.setAttribute('data-pos', String(folded));
        strip.style.setProperty('--n5i-pos', String(folded));
        strip.removeEventListener('transitionend', settle);
      };
      if (duration === 0) {
        settle();
      } else {
        strip.addEventListener('transitionend', settle);
      }
    }
  }

  /* replace the text content of `container` with one odometer column per
     digit of `numStr`, wrapped so it can sit inline. returns the columns
     in left-to-right order. */
  function buildOdometerNumber(numStr, displayClass) {
    var frag = document.createDocumentFragment();
    var cols = [];
    var i;
    for (i = 0; i < numStr.length; i++) {
      var col = buildOdometerColumn(displayClass);
      frag.appendChild(col);
      cols.push(col);
    }
    return { frag: frag, cols: cols };
  }

  function rollOdometerNumber(cols, numStr, opts) {
    var i;
    for (i = 0; i < cols.length; i++) {
      setOdometerDigit(cols[i], parseInt(numStr.charAt(i), 10), opts);
    }
  }

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = '0' + s;
    return s;
  }

  /* ---------- A. clock ---------- */

  function mountClock(root) {
    root.innerHTML = '';
    root.setAttribute('aria-label', 'local time');

    var disp = document.createElement('span');
    disp.className = 'n5i-clock-disp';

    var hourWrap = document.createElement('span');
    hourWrap.className = 'n5i-clock-hour';

    var colon = document.createElement('span');
    colon.className = 'n5i-clock-colon';
    colon.textContent = ':';

    var minWrap = document.createElement('span');
    minWrap.className = 'n5i-clock-min';
    var minTens = buildOdometerColumn('n5i-odo--display');
    var minOnes = buildOdometerColumn('n5i-odo--display');
    minWrap.appendChild(minTens);
    minWrap.appendChild(minOnes);

    /* AM and PM both always in the DOM, stacked top/bottom across the full
       height of the digit row (.n5i-clock-disp is align-items:stretch for
       exactly this) — the inactive one dims instead of being removed, so
       the stack never reflows as the period changes. */
    var apStack = document.createElement('span');
    apStack.className = 'n5i-ap-stack';
    apStack.setAttribute('aria-hidden', 'true');
    var apAM = document.createElement('span');
    apAM.textContent = 'AM';
    var apPM = document.createElement('span');
    apPM.textContent = 'PM';
    apStack.appendChild(apAM);
    apStack.appendChild(apPM);

    disp.appendChild(hourWrap);
    disp.appendChild(colon);
    disp.appendChild(minWrap);
    disp.appendChild(apStack);
    root.appendChild(disp);

    var fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-AU', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Perth'
      });
    } catch (e) {
      fmt = null;
    }

    var hourOnes = null;   /* always present */
    var hourTens = null;   /* present only when hour is two digits */
    var first = true;

    function ensureHourColumns(hourStr) {
      var needTens = hourStr.length > 1;
      if (needTens && !hourTens) {
        hourTens = buildOdometerColumn('n5i-odo--display');
        hourWrap.insertBefore(hourTens, hourWrap.firstChild);
        snapRow(hourTens);
      } else if (!needTens && hourTens) {
        hourWrap.removeChild(hourTens);
        hourTens = null;
      }
      if (!hourOnes) {
        hourOnes = buildOdometerColumn('n5i-odo--display');
        hourWrap.appendChild(hourOnes);
        snapRow(hourOnes);
      }
    }

    function tick() {
      var hourStr, minStr, dayPeriod;
      if (fmt) {
        var parts = fmt.formatToParts(new Date());
        var o = {};
        var i;
        for (i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
        hourStr = o.hour;
        minStr = o.minute;
        dayPeriod = (o.dayPeriod || '').replace(/\./g, '').toUpperCase();
      } else {
        var d = new Date();
        var h = d.getHours() % 12; if (h === 0) h = 12;
        hourStr = String(h);
        minStr = pad(d.getMinutes(), 2);
        dayPeriod = d.getHours() >= 12 ? 'PM' : 'AM';
      }

      ensureHourColumns(hourStr);

      var isPM = dayPeriod === 'PM';
      apAM.className = isPM ? 'n5i-ap-inactive' : '';
      apPM.className = isPM ? '' : 'n5i-ap-inactive';

      var duration = first ? 900 : 500;
      if (hourTens) {
        setOdometerDigit(hourTens, parseInt(hourStr.charAt(0), 10), { duration: duration, force: first });
        setOdometerDigit(hourOnes, parseInt(hourStr.charAt(1), 10), { duration: duration, force: first });
      } else {
        setOdometerDigit(hourOnes, parseInt(hourStr.charAt(0), 10), { duration: duration, force: first });
      }
      setOdometerDigit(minTens, parseInt(minStr.charAt(0), 10), { duration: duration, force: first });
      setOdometerDigit(minOnes, parseInt(minStr.charAt(1), 10), { duration: duration, force: first });

      first = false;
    }

    return function start() {
      fitInk(apAM);
      fitInk(apPM);
      tick();
      setInterval(tick, 1000);
    };
  }

  /* ---------- B. telemetry cluster ---------- */

  function mountTelemetry(root) {
    var stats = root.querySelectorAll('[data-stat]');
    var jobs = [];
    var i;
    for (i = 0; i < stats.length; i++) {
      (function (b, index) {
        var value = parseInt(b.textContent, 10);
        if (isNaN(value)) return;
        var numStr = String(value);
        var built = buildOdometerNumber(numStr, 'n5i-odo--label');
        b.textContent = '';
        b.appendChild(built.frag);
        jobs.push({ cols: built.cols, numStr: numStr, delay: index * 60 });
      })(stats[i], i);
    }

    var dot = root.querySelector('[data-n5i-dot]');
    if (dot) dots.push(dot);

    return function start() {
      var j;
      for (j = 0; j < jobs.length; j++) {
        (function (job) {
          if (REDUCED) {
            rollOdometerNumber(job.cols, job.numStr, { duration: 0, force: true });
          } else {
            setTimeout(function () {
              rollOdometerNumber(job.cols, job.numStr, { duration: 800, force: true });
            }, job.delay);
          }
        })(jobs[j]);
      }
    };
  }

  /* ---------- C. dimension readout ---------- */

  function mountDimensionReadout(root) {
    if (root.className.indexOf('n5i-dim-readout') === -1) {
      root.className = (root.className ? root.className + ' ' : '') + 'n5i-dim-readout';
    }
    root.textContent = '';

    var w = buildOdometerNumber('0000', 'n5i-odo--label');
    var sep = document.createElement('span');
    sep.textContent = ' × ';
    var h = buildOdometerNumber('0000', 'n5i-odo--label');

    root.appendChild(w.frag);
    root.appendChild(sep);
    root.appendChild(h.frag);

    var first = true;

    function update() {
      var wStr = pad(global.innerWidth, 4);
      var hStr = pad(global.innerHeight, 4);
      var duration = first ? 900 : 500;
      rollOdometerNumber(w.cols, wStr, { duration: duration, force: first });
      rollOdometerNumber(h.cols, hStr, { duration: duration, force: first });
      first = false;
    }

    var t;
    global.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(update, 120);
    });

    return update;
  }

  /* an rAF frame counter, averaged and re-rolled once a second — the same
     odometer digits as the resolution readout above it, so both instrument
     lines read the same way. The leading arrow marks it as a sub-line of
     that resolution readout (also indented 12px in CSS). */

  function mountFpsReadout(root) {
    if (root.className.indexOf('n5i-dim-readout') === -1) {
      root.className = (root.className ? root.className + ' ' : '') + 'n5i-dim-readout';
    }
    root.textContent = '';

    var arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↳ ';

    var n = buildOdometerNumber('000', 'n5i-odo--label');
    var suffix = document.createElement('span');
    suffix.textContent = ' FPS';

    root.appendChild(arrow);
    root.appendChild(n.frag);
    root.appendChild(suffix);

    var raf = global.requestAnimationFrame ? function (cb) { return global.requestAnimationFrame(cb); } : function (cb) { return setTimeout(function () { cb(Date.now()); }, 1000 / 60); };
    var first = true;
    var frames = 0;
    var windowStart = null;

    function loop(ts) {
      if (windowStart === null) windowStart = ts;
      frames++;
      var elapsed = ts - windowStart;
      if (elapsed >= 1000) {
        var fps = Math.round((frames * 1000) / elapsed);
        var duration = first ? 900 : 500;
        rollOdometerNumber(n.cols, pad(fps, 3), { duration: duration, force: first });
        first = false;
        frames = 0;
        windowStart = ts;
      }
      raf(loop);
    }

    return function start() {
      raf(loop);
    };
  }

  /* ---------- setClusterState ---------- */

  function setClusterState(nodesUp) {
    var i;
    for (i = 0; i < dots.length; i++) {
      var dot = dots[i];
      dot.classList.remove('n5i-dot--pulse');
      if (nodesUp >= 3) {
        dot.style.opacity = '1';
      } else if (nodesUp === 2) {
        if (REDUCED) {
          dot.style.opacity = '0.7';
        } else {
          dot.style.opacity = '';
          dot.classList.add('n5i-dot--pulse');
        }
      } else {
        dot.style.opacity = '0.2';
      }
    }
  }

  /* ---------- mount ---------- */


  /* ---------- C2. readout column: end under the last row of the sentence ---------- */
  /* The readouts are right-aligned (Eric, 2026-09-08), but their right edge
     must sit under the END of the sentence's last row, not the block's edge
     (Eric, same day: "keep the right side edge of those two lines of text
     to stay under the last row of text"). A wrapped line has no box CSS can
     align to, so measure it: the union of the paragraph's client rects on
     its lowest line gives the last row's right edge; pad the column so its
     own right edge lands there. Re-measured after fonts, on resize, and on
     any DOM change inside the sentence (the clock digits sit in its first
     row, and a digit change can re-wrap the rows below). */
  function alignReadouts(root) {
    root = root || document;
    var cols = root.querySelectorAll('.n5i-readouts');
    var i;
    for (i = 0; i < cols.length; i++) (function (col) {
      var p = col.previousElementSibling;
      while (p && !(p.classList && p.classList.contains('n5i-clocksentence'))) p = p.previousElementSibling;
      if (!p || !document.createRange) return;
      var scheduled = false;
      function measure() {
        scheduled = false;
        /* text nodes only, and none from inside the clock: its odometer
           columns are tall hidden digit stacks whose rects reach far below
           the sentence and would be mistaken for the last row */
        var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
        var rects = [], node, k;
        while ((node = walker.nextNode())) {
          if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.n5i-clock-inline')) continue;
          if (!/\S/.test(node.nodeValue)) continue;
          var range = document.createRange();
          range.selectNodeContents(node);
          var rs = range.getClientRects();
          for (k = 0; k < rs.length; k++) if (rs[k].width > 0) rects.push(rs[k]);
        }
        var bottom = -Infinity, right = -Infinity;
        for (k = 0; k < rects.length; k++) if (rects[k].bottom > bottom) bottom = rects[k].bottom;
        for (k = 0; k < rects.length; k++) if (rects[k].bottom > bottom - 2 && rects[k].right > right) right = rects[k].right;
        col.style.paddingRight = '0px';
        if (right === -Infinity) return;
        var box = col.getBoundingClientRect();
        var pad = Math.round(box.right - right);
        if (pad > 0 && pad < box.width) col.style.paddingRight = pad + 'px';
      }
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        (global.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(measure);
      }
      whenReady(measure);
      global.addEventListener('resize', schedule);
      if (global.ResizeObserver) { var ro = new ResizeObserver(schedule); ro.observe(p); ro.observe(col); }
      if (global.MutationObserver) new MutationObserver(schedule).observe(p, { subtree: true, childList: true, characterData: true, attributes: true });
    })(cols[i]);
  }

  function mount(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-n5i]');
    var starts = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var kind = el.getAttribute('data-n5i');
      var start = null;
      if (kind === 'clock') start = mountClock(el);
      else if (kind === 'telemetry') start = mountTelemetry(el);
      else if (kind === 'dim') start = mountDimensionReadout(el);
      else if (kind === 'fps') start = mountFpsReadout(el);
      if (start) starts.push(start);
    }
    /* one shared gate: wait for glyphs + a painted "at rest" frame, snap
       every column's row height to a real integer pixel value, then let
       every instrument run its first (orchestrated) roll. */
    whenReady(function () {
      snapAllRows();
      var j;
      for (j = 0; j < starts.length; j++) starts[j]();
    });
    alignReadouts(root);
  }

  global.N5Instruments = {
    mount: mount,
    setClusterState: setClusterState
  };
})(typeof window !== 'undefined' ? window : this);
