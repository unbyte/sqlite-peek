import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: true,
  dts: true,
  clean: true,
  minify: false,
  treeshake: true,
  sourcemap: false,
})
