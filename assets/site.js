// Shared behaviour for the subpages: menu, FAQ disclosures, sticky action bar, first-touch tracking fields.
(function(){
  var navToggle = document.querySelector('.nav-toggle');
  if (navToggle){
    navToggle.querySelectorAll('a').forEach(function(link){
      link.addEventListener('click', function(){ navToggle.removeAttribute('open'); });
    });
    document.addEventListener('click', function(e){
      if (navToggle.hasAttribute('open') && !navToggle.contains(e.target)){ navToggle.removeAttribute('open'); }
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && navToggle.hasAttribute('open')){
        navToggle.removeAttribute('open');
        navToggle.querySelector('summary').focus();
      }
    });
  }

  document.querySelectorAll('.faq-q').forEach(function(btn){
    btn.addEventListener('click', function(){
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      btn.closest('.faq-item').classList.toggle('open', !expanded);
    });
  });

  // Sticky bar and header button step back while a section with its own primary button is on screen.
  var stickyCta = document.getElementById('sticky-cta');
  var headerEl = document.querySelector('header');
  var ctaZones = document.querySelectorAll('[data-cta]');
  if (stickyCta && ctaZones.length && 'IntersectionObserver' in window){
    var onScreen = new Set();
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){ onScreen.add(entry.target); } else { onScreen.delete(entry.target); }
      });
      stickyCta.classList.toggle('is-hidden', onScreen.size > 0);
      headerEl.classList.toggle('cta-on-screen', onScreen.size > 0);
    }, {threshold:0});
    ctaZones.forEach(function(el){ io.observe(el); });
  }

  // WCAG 2.4.11: the browser does not scroll to a focused element that is already "on screen", so
  // Tab can land on something hidden behind the sticky header or the bottom bar. Nudge it into view.
  document.addEventListener('focusin', function(e){
    // Next frame: after the browser's own focus scrolling has run.
    requestAnimationFrame(function(){ keepVisible(e.target); });
  });
  function keepVisible(el){
    var r = el.getBoundingClientRect();
    // Off-screen targets are scrolled by the browser itself (scroll-padding clears header and bar).
    if (!r.height || r.bottom <= 0 || r.top >= window.innerHeight){ return; }
    if ((headerEl && headerEl.contains(el)) || (stickyCta && stickyCta.contains(el))){ return; }
    var top = headerEl ? headerEl.getBoundingClientRect().bottom : 0;
    var barShown = stickyCta && getComputedStyle(stickyCta).display !== 'none' && !stickyCta.classList.contains('is-hidden');
    var bottom = barShown ? stickyCta.getBoundingClientRect().top : window.innerHeight;
    if (r.bottom > bottom){ window.scrollBy({top: r.bottom - bottom + 16, behavior: 'instant'}); }
    else if (r.top < top){ window.scrollBy({top: r.top - top - 16, behavior: 'instant'}); }
  }

  // First touch of the visit: UTM tags, landing page and referrer, kept for the session and
  // copied into any hidden tracking field on a form (see growth/lead-generation-system.md §4).
  var KEY = 'scp_first_touch', touch = null;
  try { touch = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!touch){
    var q = new URLSearchParams(location.search);
    touch = {
      utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      landing_page: location.pathname, referrer: document.referrer || ''
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(touch)); } catch (e) {}
  }
  Object.keys(touch).forEach(function(name){
    document.querySelectorAll('input[type="hidden"][name="' + name + '"]').forEach(function(input){ input.value = touch[name]; });
  });
})();
