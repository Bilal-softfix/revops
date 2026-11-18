/**
 * The embeddable form snippet (M2-T2), served at `GET /v1/public/embed.js`. Customers add:
 *
 *   <script src="https://API/v1/public/embed.js" data-revops-key="PUBLIC_KEY" async></script>
 *   <form data-revops-form> <input name="name"> <input name="phone"> … <button>Send</button> </form>
 *
 * It stores first-touch attribution (utm_*, gclid, fbclid, landing URL, referrer) in a 90-day
 * first-party cookie, adds a hidden honeypot field, and on submit posts the form's fields as JSON
 * (`text/plain`, so no CORS preflight) to `forms/:key` next to the script (`…/v1/public/`).
 * Optional attributes on the form: data-revops-success / data-revops-error (messages).
 * A Cloudflare Turnstile widget inside the form is picked up automatically (`_captcha`).
 *
 * Plain ES2017 in a string (the API compiles TS only); no template literals, no dependencies.
 */
export const EMBED_SCRIPT = String.raw`(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-revops-key');
  if (!key) return;
  // Relative to the script's own path, so it works direct (API/v1/public/embed.js) and through
  // the web app's same-origin proxy (APP/api/v1/public/embed.js).
  var endpoint = new URL('forms/' + encodeURIComponent(key), script.src).href;
  var COOKIE = 'revops_attr';
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

  function readCookie() {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (parts[i].slice(0, eq) === COOKIE) {
        try { return JSON.parse(decodeURIComponent(parts[i].slice(eq + 1))); } catch (e) { return null; }
      }
    }
    return null;
  }

  // First touch wins: the cookie is written once, on the first page view that carries data.
  var attribution = readCookie();
  if (!attribution) {
    attribution = {};
    var params = new URLSearchParams(window.location.search);
    KEYS.forEach(function (k) { var v = params.get(k); if (v) attribution[k] = v.slice(0, 300); });
    attribution.landing_url = window.location.href.slice(0, 2000);
    if (document.referrer) attribution.referrer = document.referrer.slice(0, 2000);
    var secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(attribution)) +
      '; Max-Age=7776000; Path=/; SameSite=Lax' + secure;
  }

  var loadedAt = Date.now();

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () {
      return (Math.random() * 16 | 0).toString(16);
    });
  }

  function message(form, text, ok) {
    var box = form.querySelector('[data-revops-message]');
    if (!box) {
      box = document.createElement('p');
      box.setAttribute('data-revops-message', '');
      box.setAttribute('role', 'status');
      form.appendChild(box);
    }
    box.textContent = text;
    box.setAttribute('data-revops-ok', ok ? 'true' : 'false');
  }

  function wire(form) {
    if (form.getAttribute('data-revops-wired')) return;
    form.setAttribute('data-revops-wired', 'true');
    var submissionId = uuid();
    // Honeypot: invisible to people, tempting to bots. Must stay empty.
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = '_hp';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0';
    form.appendChild(hp);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var fields = {};
      var captcha;
      var data = new FormData(form);
      data.forEach(function (value, name) {
        if (typeof value !== 'string') return; // files are never sent
        if (name === '_hp') return;
        if (name === 'cf-turnstile-response') { captcha = value; return; }
        fields[name] = value;
      });
      var payload = {
        fields: fields,
        attribution: attribution,
        submissionId: submissionId,
        _hp: hp.value,
        _ts: Date.now() - loadedAt
      };
      if (captcha) payload._captcha = captcha;
      var button = form.querySelector('[type="submit"], button:not([type])');
      if (button) button.disabled = true;
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        mode: 'cors'
      }).then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        message(form, form.getAttribute('data-revops-success') || 'Thank you! We will get back to you shortly.', true);
        form.reset();
        submissionId = uuid();
        form.dispatchEvent(new CustomEvent('revops:submitted', { bubbles: true }));
      }).catch(function () {
        message(form, form.getAttribute('data-revops-error') || 'Sorry, something went wrong. Please try again.', false);
      }).then(function () {
        if (button) button.disabled = false;
      });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-revops-form]');
    for (var i = 0; i < forms.length; i++) wire(forms[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;
