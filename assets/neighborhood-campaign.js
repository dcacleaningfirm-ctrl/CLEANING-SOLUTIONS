(function () {
  'use strict';
  var select = document.getElementById('community');
  if (!select) return;
  var region = document.querySelector('[data-community-region]').dataset.communityRegion;
  var params = new URLSearchParams(location.search);
  var valid = Array.from(select.options).map(function(o) { return o.value; });
  var initial = params.get('utm_content');
  var other = document.getElementById('other-community');
  var wrap = document.getElementById('other-community-wrap');
  if (valid.includes(initial)) select.value = initial;
  if (params.get('community') && other) { select.value = 'other'; other.value = params.get('community').slice(0,80); }
  function communityValue() {
    return select.value === 'other' && other.value.trim() ? other.value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : select.value;
  }
  function update() {
    wrap.hidden = select.value !== 'other';
    var attr = {
      utm_source: (params.get('utm_source') || 'website').slice(0,200),
      utm_medium: (params.get('utm_medium') || 'community').slice(0,200),
      utm_campaign: (params.get('utm_campaign') || region).slice(0,200)
    };
    if (communityValue()) attr.utm_content = communityValue();
    if (params.get('utm_term')) attr.utm_term = params.get('utm_term').slice(0,200);
    try { sessionStorage.setItem('dca-marketing-attribution', JSON.stringify(attr)); } catch(e) {}
    document.querySelectorAll('[data-neighborhood-book]').forEach(function(link) {
      var url = new URL('/book', location.origin);
      Object.keys(attr).forEach(function(k) { url.searchParams.set(k, attr[k]); });
      link.href = url.pathname + url.search;
    });
    var selected = select.value === 'other' ? other.value.trim() : select.selectedOptions[0].textContent;
    document.getElementById('community-note').textContent = select.value && selected ? 'Selected: ' + selected + '. Continue to choose your cleaning services. Please also mention your community in the booking notes.' : 'Select your community, then start your estimate.';
    document.getElementById('share-status').textContent = '';
  }
  update();
  select.addEventListener('change', update);
  other.addEventListener('input', update);
  document.getElementById('share-community').addEventListener('click',async function() {
    var url = new URL(location.pathname, location.origin);
    url.searchParams.set('utm_source','community');url.searchParams.set('utm_medium','referral');url.searchParams.set('utm_campaign',region);
    if (communityValue()) url.searchParams.set('utm_content',select.value);
    if (select.value === 'other' && other.value.trim()) url.searchParams.set('community',other.value.trim().slice(0,80));
    url.hash = 'choose-community';
    var status = document.getElementById('share-status');
    try { await navigator.clipboard.writeText(url.href); status.textContent = 'Link copied. Share it with your neighbors to request nearby appointments.'; }
    catch(e) { status.textContent = 'Copy this link for your neighbors: '+url.href; }
  });
})();
