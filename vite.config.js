import { defineConfig } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';

const TYPES = { '.drc': 'application/octet-stream', '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg; codecs=opus', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.json': 'application/json', '.svg': 'image/svg+xml' };

function devAssets(dir) {
  const root = resolve(dir);
  const cacheTiles = resolve('.cache');
  const serve = (req, res, next) => {
    if (!req.url.startsWith('/a/')) return next();
    const rel = decodeURIComponent(req.url.slice(3).split('?')[0]);
    const generated = rel.startsWith('tiles/') || (rel.startsWith('audio/') && rel.endsWith('.opus'));
    const base = generated ? cacheTiles : root;
    const file = normalize(join(base, rel));
    if (!file.startsWith(base + '/')) {
      res.statusCode = 403;
      return res.end();
    }
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error('nf');
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(file).pipe(res);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  };
  return {
    name: 'unf-dev-assets',
    configureServer(s) {
      s.middlewares.use(serve);
    },
    configurePreviewServer(s) {
      s.middlewares.use(serve);
    },
  };
}

export default defineConfig({
  plugins: [devAssets(process.env.UNF_ASSETS || '../007/assets')],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
