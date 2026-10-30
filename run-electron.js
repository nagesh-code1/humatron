const { spawn } = require('child_process');
const path = require('path');

// First, build main and preload with esbuild
const esbuild = require('esbuild');

async function buildMain() {
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist/main/main.cjs',
    external: ['electron', 'better-sqlite3', 'electron-store', 'auto-launch', '@xenova/transformers'],
    sourcemap: true,
  });
  console.log('Main process built');
}

async function buildPreload() {
  await esbuild.build({
    entryPoints: ['src/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist/preload/preload.cjs',
    external: ['electron'],
    sourcemap: true,
  });
  console.log('Preload script built');
}

async function start() {
  try {
    await buildMain();
    await buildPreload();
    
    // Start Electron
    const electronPath = require('electron');
    const mainPath = path.join(__dirname, 'dist/main/main.cjs');
    
    const child = spawn(electronPath, [mainPath], {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' }
    });
    
    child.on('close', (code) => {
      process.exit(code || 0);
    });
    
    child.on('error', (err) => {
      console.error('Failed to start Electron:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

start();