// Anonymous acquisition events for the metrics sheet (Google Apps Script, see
// structconsultpro-ops/intake-upload/Code.gs). No cookies, names or emails: a random code per
// browser session, the page, phone or computer, first-touch source, and at the end the request
// reference with the county and file count. Everything else stays in Formspree and Drive.
// Load it before thank-you.html's own script, which clears the reference it reads.
(function(){
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbz5m-hdNsjg4d-GPKtytJfXojGzjZ75sKXTWbR3OnmORzgl581Pu_duH2d2TECbvcDf/exec';

  function get(key){ try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function put(key, value){ try { sessionStorage.setItem(key, value); } catch (e) {} }

  var session = get('scp_track_session');
  if (!session){
    session = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 16);
    put('scp_track_session', session);
  }
  var sent = {};
  try { sent = JSON.parse(get('scp_track_sent') || '{}'); } catch (e) {}

  // Same first-touch record site.js keeps, so either script can create it.
  var touch = null;
  try { touch = JSON.parse(get('scp_first_touch') || 'null'); } catch (e) {}
  if (!touch){
    var q = new URLSearchParams(location.search);
    touch = {utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      landing_page: location.pathname, referrer: document.referrer || ''};
    put('scp_first_touch', JSON.stringify(touch));
  }

  // Decided once per session, so one visit is not split between phone and computer.
  var device = get('scp_track_device');
  if (!device){
    device = window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 1024px)').matches ? 'mobile' : 'desktop';
    put('scp_track_device', device);
  }

  // once: the key that stops the same event from being counted twice in a session.
  function send(name, extra, once){
    if (once){
      if (sent[once]){ return; }
      sent[once] = 1;
      put('scp_track_sent', JSON.stringify(sent));
    }
    var body = {action:'event', name:name, session:session, page:location.pathname, device:device,
      landing:touch.landing_page, referrer:touch.referrer, utm_source:touch.utm_source, utm_medium:touch.utm_medium, utm_campaign:touch.utm_campaign};
    for (var k in extra){ body[k] = extra[k]; }
    try {
      fetch(ENDPOINT, {method:'POST', body:JSON.stringify(body), keepalive:true, mode:'no-cors'}).catch(function(){});
    } catch (e) {}
  }

  send('visit', {}, 'visit');

  // Thank-you page: one "submit" per reference, with what the form step saved just before.
  var ref = get('scp_reference');
  if (ref && /\/thank-you(\.html)?$/.test(location.pathname)){
    var files = [], form = {};
    try { files = JSON.parse(get('scp_received') || '[]') || []; } catch (e) {}
    try { form = JSON.parse(get('scp_track_submit') || '{}') || {}; } catch (e) {}
    send('submit', {reference:ref, files:files.length, county:form.county || '', link:!!form.link}, 'submit:' + ref);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var formEl = document.getElementById('project-form');
    if (!formEl){ return; }

    if ('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(entries){
        if (entries.some(function(e){ return e.isIntersecting; })){ send('form_view', {}, 'form_view'); io.disconnect(); }
      }, {threshold:0});
      io.observe(formEl);
    }
    formEl.addEventListener('focusin', function(){ send('form_start', {}, 'form_start'); });
    // Runs before the page's own submit handler (capture), which may leave for thank-you.
    formEl.addEventListener('submit', function(){
      var county = formEl.querySelector('[name="county"]');
      var link = formEl.querySelector('[name="plans_link"]');
      put('scp_track_submit', JSON.stringify({county: county ? county.value : '', link: !!(link && link.value.trim())}));
    }, true);

    // Upload funnel, read from the file list that assets/uploader.js draws.
    var list = document.getElementById('upload-list');
    if (!list || !('MutationObserver' in window)){ return; }
    new MutationObserver(function(){
      var rows = Array.prototype.slice.call(list.children);
      if (!rows.length){ return; }
      send('upload_start', {}, 'upload_start');
      if (rows.some(function(r){ return r.classList.contains('uf-error') && !r.querySelector('.uf-retry[hidden]'); })){
        send('upload_fail', {}, 'upload_fail');
      }
      var live = rows.filter(function(r){ return !r.classList.contains('uf-error'); });
      if (live.length && live.every(function(r){ return r.classList.contains('uf-done'); })){
        send('upload_done', {}, 'upload_done');
      }
    }).observe(list, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
  });
})();
