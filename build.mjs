// Builds renderer (Vite) + main/preload (esbuild) into dist/. Used by npm start / package.
import { build } from 'esbuild';
import { execSync } from 'child_process';
execSync('npx vite build', { stdio: 'inherit' });
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main/main.cjs',
  external: ['electron', 'better-sqlite3', 'electron-store', 'auto-launch', '@xenova/transformers'] });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload/preload.cjs', external: ['electron'] });
console.log('build ok');
