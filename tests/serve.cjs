const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const prefix = '/hanshoku-kanri-okayama/';
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  // Worker fetches can bypass page route mocks. No test ever receives a production URL.
  if (pathname === prefix + 'pwa-config.js') {
    res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
    res.end("(function(g){g.OKAYAMA_APP_CONFIG={backendUrl:'http://127.0.0.1:8765/mock-backend',storageNamespace:'hanshoku-kanri-okayama-v1',pingTimeoutMs:3500,requestTimeoutMs:15000};})(typeof window!=='undefined'?window:self);");
    return;
  }
  if (pathname === '/mock-backend') { res.writeHead(503); res.end('Test backend requires a local mock'); return; }
  if (!pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
  const file = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}).listen(8765, '127.0.0.1');
