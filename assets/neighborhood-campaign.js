(function () {
  'use strict';
  var select = document.getElementById('community');
  var params = new URLSearchParams(location.search);
  var valid = Array.from(select.options).map(function(o) { return o.value; });
  var initial = params.get('utm_content');
  if (valid.includes(initial)) select.value = initial;
  function update() {
    var attr = {};
    try { attr = JSON.parse(sessionStorage.getItem('dca-marketing-attribution') || '{}'); } catch(e) {}
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) { if(params.get(k)) attr[k] = params.get(k).slice(0,200); });
    if(select.value) attr.utm_content = select.value;
    try { sessionStorage.setItem('dca-marketing-attribution', JSON.stringify(attr)); } catch(e) {}
    document.querySelectorAll('[data-neighborhood-book]').forEach(function(link) {
      var url = new URL('/book', location.origin);
      Object.keys(attr).forEach(function(k) { if(/^utm_/.test(k)) url.searchParams.set(k, attr[k]); });
      link.href = url.pathname + url.search;
    });
    document.getElementById('community-note').textContent = select.value ? 'Selected: ' + select.selectedOptions[0].textContent + '. Continue to choose your cleaning services.' : 'Select your community, then start your estimate.';
  }
  update();
  select.addEventListener('change', update);
})();
