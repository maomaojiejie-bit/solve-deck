// 本地启动器：零依赖，把 dist/ 以静态站点方式跑起来并打开浏览器。
// 用法：node scripts/serve-local.mjs [端口] [入口]
//   入口可取 solve / about / wizard / lab / t/M3 / t/A3，空则打开首页。
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('× 找不到 dist/index.html。先跑一次 `npm run build`。');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const startedPort = Number(process.argv[2]) || 5180;
const entry = (process.argv[3] || '').replace(/^#?\/?/, '');

function freePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(freePort(port + 1)));
    probe.once('listening', () => probe.close(() => resolve(port)));
    probe.listen(port, '127.0.0.1');
  });
}

const server = http.createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, raw);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(root, 'index.html'); // hash 路由，路径都回落到首页
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const port = await freePort(startedPort);
const url = `http://127.0.0.1:${port}/${entry ? `#/${entry}` : ''}`;

server.listen(port, '127.0.0.1', () => {
  console.log('');
  console.log('  拆解台 · SolveDeck  ── 本地预览已启动');
  console.log(`  ${url}`);
  console.log('');
  console.log('  首页 /  #/solve 手填题  /  #/about  /  #/wizard 选型向导');
  console.log('  关掉这个窗口即停止。');
  console.log('');
  if (process.env.SD_NO_OPEN !== '1') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  }
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
