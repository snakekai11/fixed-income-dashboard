// 极简静态服务器：托管 web/ 与 data/，并提供 /api/refresh 手动触发取数
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8021;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

let refreshing = false;
let lastRefreshAt = 0;
const REFRESH_COOLDOWN_MS = 60_000;
const AUTO_REFRESH_MS = 4 * 60 * 60 * 1000;

function refreshData() {
  if (refreshing) return Promise.resolve({ ok: false, status: 202, message: '正在更新中，请稍候…' });
  const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - lastRefreshAt);
  if (waitMs > 0) return Promise.resolve({ ok: false, status: 429, retryAfter: Math.ceil(waitMs / 1000), message: `数据刚刚更新过，请 ${Math.ceil(waitMs / 1000)} 秒后再试。` });
  refreshing = true;
  lastRefreshAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'public_fetch.mjs')], { cwd: ROOT, windowsHide: true });
    let out = '';
    child.stdout.on('data', (data) => { out += data; });
    child.stderr.on('data', (data) => { out += data; });
    child.on('close', (code) => {
      refreshing = false;
      resolve({ ok: code === 0, status: 200, exit: code, log: out.slice(-2000) });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    const result = await refreshData();
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (result.retryAfter) headers['Retry-After'] = String(result.retryAfter);
    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result));
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, refreshing }));
    return;
  }
  let filePath;
  if (url.pathname.startsWith('/data/')) {
    filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  } else {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    filePath = path.join(WEB, rel);
  }
  const norm = path.normalize(filePath);
  if (!norm.startsWith(WEB) && !norm.startsWith(DATA)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(norm) || !statSync(norm).isFile()) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(norm).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(norm));
});

server.listen(PORT, () => {
  console.log(`固收综合看板已启动: http://localhost:${PORT}`);
  refreshData().catch(error => console.error('启动更新失败:', error.message));
});

setInterval(() => refreshData().catch(error => console.error('定时更新失败:', error.message)), AUTO_REFRESH_MS).unref();
