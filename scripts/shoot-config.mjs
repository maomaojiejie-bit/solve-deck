/**
 * 组态常驻快照截图：node scripts/shoot-config.mjs A3 CB
 *
 * 快照必须先由 build-example 生成并提交：
 *   node scripts/build-example.mjs A3 --config=CB --id=A3-CB
 * 本脚本只做三件事：断言快照（config / 主图与等效图 / 晶体管朝向）→ vite build →
 * 本地静态服务 + Edge headless 截图到 docs/shots/<变体 id>.png。
 * 不再「备份 → 还原」默认快照。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const id = process.argv[2];
const config = process.argv[3];
const LEGAL = { A3: ['CE', 'CB', 'CC'], A5: ['CS', 'CG', 'CD'] };
if (!id || !config || !LEGAL[id]?.includes(config)) {
  console.error(`用法：node scripts/shoot-config.mjs <${Object.keys(LEGAL).join('|')}> <${LEGAL.A3.join('|')}>`);
  process.exit(1);
}

const variantId = `${id}-${config}`;
const examplePath = join(root, 'src', 'examples', `${variantId}.json`);
if (!existsSync(examplePath)) {
  console.error(
    `缺少常驻快照 ${variantId}.json；先运行：node scripts/build-example.mjs ${id} --config=${config} --id=${variantId}`,
  );
  process.exit(1);
}

/** 主图里晶体管的期望朝向；nmos-r90 是专用横置画法，不再用 rot=90。 */
const EXPECTED = {
  'A3-CB': { kind: 'npn', rot: 90 },
  'A3-CC': { kind: 'npn', rot: 0 },
  'A5-CG': { kind: 'nmos-r90', rot: 0 },
  'A5-CD': { kind: 'nmos', rot: 0 },
};

const shotsDir = join(root, 'docs', 'shots');
mkdirSync(shotsDir, { recursive: true });
const shotPath = join(shotsDir, `${variantId}.png`);
const profile = mkdtempSync(join(tmpdir(), `solve-deck-edge-${variantId}-`));
let server = null;

const run = (command, args, opts = {}) =>
  spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: true, ...opts });

try {
  const solution = JSON.parse(readFileSync(examplePath, 'utf8'));
  if (solution.result.config !== config) {
    throw new Error(`快照 config=${solution.result.config}，期望 ${config}`);
  }
  const main = solution.render_specs.find((spec) => spec.id === 'main');
  const pi = solution.render_specs.find((spec) => spec.id === 'pi');
  if (!main) throw new Error(`${variantId} 缺少主图 main`);
  if (!pi) throw new Error(`${variantId} 缺少等效图 pi`);
  const expected = EXPECTED[variantId];
  if (!expected) throw new Error(`没有为 ${variantId} 定义晶体管朝向断言`);
  const transistor = main.nodes.find((node) =>
    ['npn', 'pnp', 'nmos', 'nmos-r90', 'pmos'].includes(node.kind),
  );
  if (!transistor) throw new Error(`${variantId} 主图缺少晶体管节点`);
  if (transistor.kind !== expected.kind) {
    throw new Error(`${variantId} 晶体管 kind=${transistor.kind}，期望 ${expected.kind}`);
  }
  const actualRot = transistor.rot ?? 0;
  if (actualRot !== expected.rot) {
    throw new Error(`${variantId} 晶体管 rot=${actualRot}，期望 ${expected.rot}`);
  }
  console.log(
    `assert ok: ${variantId} config=${config} main+pi kind=${transistor.kind} rot=${actualRot}`,
  );

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
  await new Promise((ready) => server.listen(5181, '127.0.0.1', ready));

  const edgeCandidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const browser = edgeCandidates.find((candidate) => existsSync(candidate));
  if (!browser) throw new Error('找不到 Edge/Chrome 可执行文件');

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
      `http://127.0.0.1:5181/#/t/${variantId}`,
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 80 && !existsSync(shotPath); attempt += 1) {
    await new Promise((ready) => setTimeout(ready, 250));
  }
  if (!existsSync(shotPath)) {
    child.kill();
    throw new Error('截图未生成（浏览器未写出文件）');
  }
  await new Promise((ready) => setTimeout(ready, 600));
  child.kill();
  console.log(`screenshot: ${shotPath}`);
} finally {
  if (server) server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    // Edge 后台进程可能还握着 profile；截图已落盘，清理失败不影响交付。
  }
}