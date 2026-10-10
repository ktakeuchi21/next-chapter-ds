import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const port = Number(process.env.PREFILL_SPIKE_PORT || 8799);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const routes = new Map([
  ['/', ['fixture.html', 'text/html; charset=utf-8']],
  ['/fixture-client.mjs', ['fixture-client.mjs', 'text/javascript']],
  ['/assisted-prefill.mjs', ['assisted-prefill.mjs', 'text/javascript']],
  ['/dom-adapter.mjs', ['dom-adapter.mjs', 'text/javascript']],
]);
createServer(async (req, res) => {
  const resource = routes.get(new URL(req.url || '/', `http://127.0.0.1:${port}`).pathname);
  if (req.method !== 'GET' || !resource) { res.writeHead(404); res.end(); return; }
  try {
    const content = await readFile(new URL(resource[0], import.meta.url));
    res.writeHead(200, {
      'Content-Type': resource[1], 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(content);
  } catch { res.writeHead(500); res.end('Local fixture unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Local-only prefill experiment: http://127.0.0.1:${port}`));
