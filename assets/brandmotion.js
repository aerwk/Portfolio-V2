/* Nav lockup: entry animation on load, hover animation, and a nav bar that
   condenses to hug its contents once you scroll past the first section
   (#about on the homepage). The lockup itself never leaves. */
(function () {
  var navIn = document.querySelector('.nav-in');
  var brand = navIn && navIn.querySelector('.brand');
  if (!navIn) return;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- brand motion ---------- */
  if (brand && !reduced) {
    var clips = {};
    brand.querySelectorAll('.lk-clip').forEach(function (v) { clips[v.dataset.role] = v; });
    var busy = false;
    var hideAll = function () { for (var k in clips) clips[k].classList.remove('on'); };

    var play = function (name) {
      var v = clips[name];
      if (!v) return;
      busy = true;
      hideAll();
      try { v.currentTime = 0; } catch (e) {}
      v.classList.add('on');
      var done = function () { v.removeEventListener('ended', done); hideAll(); busy = false; };
      v.addEventListener('ended', done);
      var p = v.play();
      if (p && p.catch) p.catch(done);
    };

    brand.addEventListener('mouseenter', function () {
      if (!busy) play('hoverin');
    });
    play('enter');
  }

  /* ---------- condense the bar past the first section ---------- */
  var condensedWidth = 0;
  function measure() {
    var had = navIn.classList.contains('condensed');
    navIn.classList.add('measuring', 'condensed');
    condensedWidth = Math.ceil(navIn.getBoundingClientRect().width);
    navIn.classList.remove('measuring');
    if (!had) navIn.classList.remove('condensed');
    navIn.style.setProperty('--nav-cond', condensedWidth + 'px');
  }

  var threshold = 0;
  function computeThreshold() {
    var el = document.querySelector('#about') || document.querySelector('main section');
    if (el) {
      var r = el.getBoundingClientRect();
      threshold = r.bottom + (window.scrollY || window.pageYOffset);
    } else {
      threshold = window.innerHeight * 0.8;
    }
  }

  var condensed = false, ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      if (!condensed && y > threshold) { condensed = true; navIn.classList.add('condensed'); }
      else if (condensed && y < threshold - 90) { condensed = false; navIn.classList.remove('condensed'); }
    });
  }

  function init() { measure(); computeThreshold(); onScroll(); }
  init();
  window.addEventListener('load', init);
  window.addEventListener('resize', function () { measure(); computeThreshold(); onScroll(); }, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
})();
