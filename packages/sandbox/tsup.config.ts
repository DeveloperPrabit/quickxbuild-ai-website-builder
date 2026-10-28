import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    '@quickxbuild/common',
    'e2b'
  ],
  splitting: false,
  treeshake: true,
});
