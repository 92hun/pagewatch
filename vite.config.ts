import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

// Chrome Extension에서 crossorigin 속성 제거
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && typeof file.source === 'string' && file.fileName.endsWith('.html')) {
          file.source = file.source.replace(/ crossorigin/g, '');
        }
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  base: '',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/selector': resolve(__dirname, 'src/content/selector.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        format: 'es',
      },
    },
  },
  plugins: [stripCrossorigin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  publicDir: resolve(__dirname, 'public'),
});
