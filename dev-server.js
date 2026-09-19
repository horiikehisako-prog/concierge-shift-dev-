const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const narration = require('./api/generate-narration');

const port = Number(process.env.COMPASS_DEV_PORT || 8788);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/generate-narration') {
    const origin = req.headers.origin;
    if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      await narration(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Development API failed' }));
    }
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && ['/', '/index.html'].includes(pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Compass development: http://localhost:${port}/index.html`);
  console.log(`AI connection configured: ${Boolean(process.env.OPENAI_API_KEY)}`);
});
