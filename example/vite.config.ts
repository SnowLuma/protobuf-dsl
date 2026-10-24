import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import protobufVite from '../dist/index.js';
import metadata from '../package.json' with { type: 'json' };

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [protobufVite()],
  resolve: { alias: { [metadata.name]: fileURLToPath(new URL('../dist/runtime.js', import.meta.url)) } },
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: 'main',
    },
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
    target: 'node18',
    minify: false,
  },
});
