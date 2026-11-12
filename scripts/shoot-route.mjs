/**
 * 路由截图：node scripts/shoot-route.mjs M3 M3-cantilever S1
 *
 * 与 shoot-config.mjs 的区别：那个是「变体断言 + 截图」（A3/A5 有朝向断言），
 * 这个只管「把某个路由的结果页拍下来」，一次构建、一个静态服务、多张图。
 * 图落到 docs/shots/<路由 id>.png；路由 id 就是 #/t/<id>。
 *
 * 前置：快照必须已由 build-example 生成并提交（本脚本只读快照、不改数据）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('用法：node scripts/shoot-route.mjs <路由 id> [更多 id…]（如 M3 M3-cantilever S1）');
  process.exit(1);
}
for (const id of ids) {
  if (!existsSync(join(root, 'src', 'examples', `${id}.json`))) {
    console.error(`缺少快照 src/examples/${id}.json；先运行 node scripts/build-example.mjs …`);
    process.exit(1);
  }
}

const shotsDir = join(root, 'docs', 'shots');
mkdirSync(shotsDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-edge-route-'));
let server = null;

const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: true });

try {
  const vite = run('npx', ['vite', 'build']);
  if (vite.status !== 0) throw new Error(vite.stderr || vite.stdout);

  const dist = join(root, 'dist');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  server = createServer((request, response) => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0]);
    const candidate = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise((ready) => server.listen(5182, '127.0.0.1', ready));

  const edgeCandidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const browser = edgeCandidates.find((candidate) => existsSync(candidate));
  if (!browser) throw new Error('找不到 Edge/Chrome 可执行文件');

  for (const id of ids) {
    const shotPath = join(shotsDir, `${id}.png`);
    if (existsSync(shotPath)) rmSync(shotPath, { force: true });
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--no-proxy-server',
        '--proxy-bypass-list=*',
        `--user-data-dir=${profile}`,
        '--hide-scrollbars',
        '--window-size=1500,1100',
        '--virtual-time-budget=6000',
        `--screenshot=${shotPath}`,
        `http://127.0.0.1:5182/#/t/${id}`,
      ],
      { stdio: 'ignore' },
    );
    for (let attempt = 0; attempt < 80 && !existsSync(shotPath); attempt += 1) {
      await new Promise((ready) => setTimeout(ready, 250));
    }
    if (!existsSync(shotPath)) {
      child.kill();
      throw new Error(`${id} 截图未生成（浏览器未写出文件）`);
    }
    await new Promise((ready) => setTimeout(ready, 400));
    child.kill();
    console.log(`screenshot: docs/shots/${id}.png`);
  }
} finally {
  if (server) server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    // Edge 后台进程可能还握着 profile；截图已落盘，清理失败不影响交付。
  }
}
