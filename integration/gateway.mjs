import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

// Loopback-only native equivalent of the container gateway, for local acceptance.
const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.RIMS_GATEWAY_PORT || 4180);
const api = new URL(process.env.RIMS_API_URL || 'http://127.0.0.1:5188');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw Error('Native gateway requires a loopback API');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (/^\/(api|integrations)(\/|$)/.test(pathname)) {
    const upstream = http.request(new URL(req.url, api), { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'LIVE_API_UNAVAILABLE', message: 'Live API недоступен', details: {} }, meta: { serverTime: new Date().toISOString(), requestId: crypto.randomUUID() } })); });
    req.pipe(upstream); return;
  }
  if (/^\/(metrics|health)(\/|$)/.test(pathname)) { res.writeHead(404); res.end(); return; }
  const app = pathname.startsWith('/client/') ? 'customer_frontend' : pathname.startsWith('/supplier/') ? 'supplier_frontend' : 'frontend';
  const base = app === 'frontend' ? '/' : app === 'customer_frontend' ? '/client/' : '/supplier/';
  const dist = resolve(root, app, process.env.RIMS_DIST_DIR || 'dist');
  let file;
  try {
    file = resolve(dist, '.' + sep + decodeURIComponent(pathname.slice(base.length)));
    if (file !== dist && !file.startsWith(dist + sep)) throw Error('outside root');
    if (!(await stat(file)).isFile()) throw Error('not file');
  } catch {
    if (extname(pathname)) { res.writeHead(404); res.end(); return; }
    file = resolve(dist, 'index.html');
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(503); res.end('Build all three interfaces before starting the native gateway'); }
});
server.on('upgrade', (req, socket, head) => {
  if (!/^\/api\/v2\/(customer\/)?warehouses\/[0-9a-f-]+\/availability\/ws(?:\?|$)/i.test(req.url)) { socket.destroy(); return; }
  const upstream = http.request(new URL(req.url, api), { headers: req.headers });
  upstream.on('upgrade', (response, peer, upstreamHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
    if (upstreamHead.length) socket.write(upstreamHead); if(head.length) peer.write(head);
    peer.pipe(socket); socket.pipe(peer); peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());socket.on('close',()=>peer.destroy());
  });
  upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); response.resume(); });
  upstream.on('error',()=>socket.destroy()); upstream.end();
});
server.listen(port, '127.0.0.1', () => console.log(`Native gateway http://127.0.0.1:${port}`));
