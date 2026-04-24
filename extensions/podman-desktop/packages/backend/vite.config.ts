import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: () => 'extension.cjs',
    },
    outDir: 'dist',
    rollupOptions: {
      external: (id) => id.startsWith('node:') || id === '@podman-desktop/api',
      output: {
        entryFileNames: 'extension.cjs',
      },
    },
    sourcemap: true,
    minify: false,
  },
});
