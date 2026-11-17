import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 运行时零外部请求：public/ 下的东西（symbols / kb / shots）原样落盘进 dist。
 * About 页的产品图走 `public/shots/r32-product.png`，通过 `import.meta.env.BASE_URL` 拼路径，
 * 所以子路径部署（https://xxx/solve-deck/）也能取到，不再需要额外的中间件。
 */
export default defineConfig({
  // 相对资源路径：dist 可以挂在 https://xxx/solve-deck/ 这样的子路径下。
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    assetsInlineLimit: 0,
  },
});
