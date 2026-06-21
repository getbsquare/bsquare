import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM + CJS module builds (React bundled in; self-contained)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    noExternal: [/.*/],
  },
  // Standalone IIFE for <script> tag usage: window.BSquare + window.BSquareAssistant
  {
    entry: { 'bsquare-widget': 'src/index.ts' },
    format: ['iife'],
    globalName: 'BSquare',
    platform: 'browser',
    sourcemap: true,
    minify: true,
    noExternal: [/.*/],
    outExtension: () => ({ js: '.global.js' }),
  },
]);
