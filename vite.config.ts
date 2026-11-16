import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** 把 docs/shots 暴露成 /shots/*：about 页只引用 r32-product.png，构建时只拷这一张。 */
function shotsPlugin(): Plugin {
  const source = resolve(process.cwd(), 'docs', 'shots');
  const SITE_SHOTS = new Set(['r32-product.png']);
  return {
    name: 'solve-deck-shots',
    configureServer(server) {
      server.middlewares.use('/shots', (request, response, next) => {
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
        const file = resolve(source, `.${pathname}`);
        if (!file.startsWith(source) || !existsSync(file)) {
          next();
          return;
        }
        response.setHeader(
          'content-type',
          extname(file) === '.pdf' ? 'application/pdf' : 'image/png',
        );
        response.end(readFileSync(file));
      });
    },
    closeBundle() {
      const target = resolve(process.cwd(), 'dist', 'shots');
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(source)) {
        // 站点只带 About 实际引用的那一张；巡检/修复过程截图和其余样例图留在本地证据目录。
        if (!SITE_SHOTS.has(name)) continue;
        copyFileSync(join(source, name), join(target, name));
      }
    },
  };
}

export default defineConfig({
  // 相对资源路径：dist 可以挂在 https://xxx/solve-deck/ 这样的子路径下。
  base: './',
  plugins: [react(), tailwindcss(), shotsPlugin()],
  build: {
    // 运行时零外部请求：public/symbols 原样落盘进 dist。
    assetsInlineLimit: 0,
  },
});