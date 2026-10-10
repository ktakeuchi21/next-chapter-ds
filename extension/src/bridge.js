/* Runs only on the approved Next Chapter origin, in Chrome's isolated world. */
(() => {
if (!config.appOrigins.includes(location.origin)) return;
if (globalThis.__nextChapterBridgeV1) return;
globalThis.__nextChapterBridgeV1 = true;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'NC_BRIDGE_V1') return;
  (async () => {
    const uuid = '[0-9a-f-]{36}';
    const taskPath = new RegExp(`^/api/browser-helper/tasks/${uuid}$`);
    const writePath = new RegExp(`^/api/browser-helper/tasks/${uuid}/(claim|report)$`);
    const photoPath = new RegExp(`^/api/browser-helper/tasks/${uuid}/photos/${uuid}\\?device=${uuid}&attempt=${uuid}$`);
    const {path, method = 'GET', body, offset} = message;
    const photo = method === 'GET' && photoPath.test(path);
    if (!(method === 'GET' && (path === '/api/browser-helper/devices' || taskPath.test(path) || photo)) && !(method === 'POST' && writePath.test(path))) throw Error('This browser request is not supported.');
    if (photo && (!Number.isSafeInteger(offset) || offset < 0 || offset > 100 * 1024 * 1024)) throw Error('Invalid photo segment.');
    const response = await fetch(path, {method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: photo ? {Range: `bytes=${offset}-${offset + 524287}`} : {'Content-Type': 'application/json'}, ...(method === 'POST' ? {body: JSON.stringify(body)} : {})});
    if (!response.ok) {
      const detail = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      throw Error(detail?.error || 'Sign into Next Chapter again, then return to the helper.');
    }
    if (photo) {
      if (response.status !== 206) throw Error('The photo service did not return a bounded segment.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 524288) throw Error('Photo segment is too large.');
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {data: btoa(binary), length: bytes.length};
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Open Next Chapter and sign in before continuing.');
    return await response.json();
  })().then(data => reply({ok: true, data}), error => reply({ok: false, error: ['TypeError','TimeoutError','AbortError'].includes(error.name) ? 'Next Chapter could not be reached. Open its tab, check your connection and sign in again.' : error.message || 'Next Chapter could not be reached. Open its tab and sign in again.'}));
  return true;
});
})();
