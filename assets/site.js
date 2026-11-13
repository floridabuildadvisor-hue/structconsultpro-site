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
