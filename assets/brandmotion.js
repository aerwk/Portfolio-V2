/* Nav lockup motion: entry on load / scroll-to-top, exit on scroll-away, pop on hover.
   ericli uses rendered clips; the lab site uses a CSS approximation of the same timing. */
(function () {
  var brand = document.querySelector('.nav-in .brand');
  if (!brand) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var TOP = 60, AWAY = 140;
  var visible = true, busy = false;

  var clips = {};
  brand.querySelectorAll('.lk-clip').forEach(function (v) { clips[v.dataset.role] = v; });
  var ENDS_BLANK = { enter: false, exit: true, hoverin: false };
  var isCss = brand.classList.contains('brand-css');

  function hideAll() {
    for (var k in clips) clips[k].classList.remove('on');
  }

  function play(name) {
    if (isCss) {
      var cls = name === 'hoverin' ? 'anim-pop' : name === 'exit' ? 'anim-out' : 'anim-in';
      busy = true;
      brand.classList.remove('anim-in', 'anim-out', 'anim-pop');
      void brand.offsetWidth;
      brand.style.opacity = '1';
      brand.classList.add(cls);
      window.setTimeout(function () {
        if (name === 'exit') { brand.style.opacity = '0'; visible = false; } else { visible = true; }
        busy = false;
      }, name === 'hoverin' ? 570 : name === 'exit' ? 1000 : 930);
      return;
    }
    var v = clips[name];
    if (!v) return;
    busy = true;
    brand.style.opacity = '1';
    hideAll();
    try { v.currentTime = 0; } catch (e) {}
    v.classList.add('on');
    var done = function () {
      v.removeEventListener('ended', done);
      if (ENDS_BLANK[name]) { brand.style.opacity = '0'; visible = false; } else { visible = true; }
      hideAll();
      busy = false;
    };
    v.addEventListener('ended', done);
    var p = v.play();
    if (p && p.catch) p.catch(done);
  }

  brand.addEventListener('mouseenter', function () {
    if (!busy && visible) play('hoverin');
  });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      if (y > AWAY && visible && !busy) play('exit');
      else if (y <= TOP && !visible && !busy) play('enter');
    });
  }, { passive: true });

  play('enter');
})();
