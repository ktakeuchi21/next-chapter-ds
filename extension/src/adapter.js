/* All Facebook interaction is through visible form fields and the normal file input.
   This adapter never presses Next, Publish, Send, Sold or Delete. */
(() => {
  if (globalThis.__nextChapterAdapterV1) return;
  globalThis.__nextChapterAdapterV1 = true;
  let session = null;
  const fail = reason => { throw Error(reason); };
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  function label(el) {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ');
    return text(el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(l => l.textContent).join(' ') || el.getAttribute('placeholder') || (el.matches('button,[role="button"]') ? el.textContent : '')).replace(/\s*\(?required\)?\s*\*?$/i, '').trim();
  }
  function inspect() {
    if (location.pathname.includes('/checkpoint') || document.querySelector('iframe[src*="captcha"], [name="captcha_response"]')) fail('challenge');
    if (location.pathname.includes('/login') || document.querySelector('input[type="password"]')) fail('login_required');
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="file"]),textarea')].filter(visible);
    const find = names => {const matches = inputs.filter(el => names.includes(label(el).toLowerCase())); if (matches.length !== 1) fail('form_changed'); return matches[0];};
    const fields = {title: find(['title']), price: find(['price', 'price ($)', 'price (usd)']), description: find(['description'])};
    const uploads = [...document.querySelectorAll('input[type="file"]')].filter(el => !el.disabled && /image|\.jpg|\.jpeg|\.png/i.test(el.accept));
    if (uploads.length !== 1 || !uploads[0].multiple) fail('form_changed');
    if (Object.values(fields).some(el => el.disabled || el.readOnly)) fail('form_changed');
    return {fields, upload: uploads[0]};
  }
  function checkFields(fields, expected, allowEmpty) {
    for (const [key, el] of Object.entries(fields)) {
      const actual = el.value.trim();
      const equal = key === 'price' && actual !== '' ? Number(actual.replace(/[$,]/g, '')) === Number(expected[key]) : actual === expected[key].trim();
      if (!(allowEmpty && actual === '') && !equal) fail('occupied');
    }
  }
  function emptyPhotos(upload) {
    if (upload.files?.length || [...document.querySelectorAll('button,[role="button"]')].some(el => visible(el) && /^(remove|delete) (photo|image)/i.test(label(el)))) fail('occupied');
  }
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id || m?.type !== 'NC_FORM_V1') return;
    (async () => {
      if (m.action === 'begin') {
        if (session?.touched) fail('interrupted');
        if (m.payload?.version !== 1 || !Array.isArray(m.payload.photos) || m.payload.photos.length < 1 || m.payload.photos.length > 20) fail('form_changed');
        const {fields, upload} = inspect(); checkFields(fields, m.payload.fields, true); emptyPhotos(upload);
        session = {id: m.attemptId, payload: m.payload, parts: new Map(), touched: true};
        for (const [key, el] of Object.entries(fields)) setValue(el, m.payload.fields[key]);
        await new Promise(resolve => setTimeout(resolve, 350));
        try {checkFields(inspect().fields, m.payload.fields, false);} catch {fail('readback_mismatch');}
        return {textVerified: true};
      }
      if (!session || session.id !== m.attemptId) fail('interrupted');
      if (m.action === 'chunk') {
        const photo = session.payload.photos.find(p => p.id === m.photoId); if (!photo || typeof m.data !== 'string' || m.data.length > 699060) fail('adapter_error');
        const value = session.parts.get(photo.id) || {size: 0, chunks: []};
        if (value.size !== m.offset) fail('upload_uncertain');
        const bytes = Uint8Array.from(atob(m.data), c => c.charCodeAt(0));
        if (bytes.length > 524288 || value.size + bytes.length > photo.size || photo.size > 20 * 1024 * 1024) fail('photo_limit');
        value.chunks.push(bytes); value.size += bytes.length; session.parts.set(photo.id, value); return {received: value.size};
      }
      if (m.action === 'photos') {
        const {fields, upload} = inspect(); checkFields(fields, session.payload.fields, false); emptyPhotos(upload);
        const data = new DataTransfer();
        for (const photo of session.payload.photos) {
          const part = session.parts.get(photo.id); if (!part || part.size !== photo.size) fail('upload_uncertain');
          data.items.add(new File(part.chunks, photo.name, {type: photo.mime}));
        }
        // One ordered batch. A lost response must never cause another dispatch.
        upload.files = data.files; session.parts.clear();
        upload.dispatchEvent(new Event('change', {bubbles: true}));
        return {dispatched: data.files.length};
      }
      fail('adapter_error');
    })().then(data => reply({ok: true, data}), error => reply({ok: false, reason: error.message}));
    return true;
  });
})();
