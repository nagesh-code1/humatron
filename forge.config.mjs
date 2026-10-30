// Packaging: `npm run make` builds dist/ (build.mjs) then packages it. Only dist/, src/assets/ and production
// node_modules ship; native modules (better-sqlite3, onnxruntime) are unpacked from the asar so they can load.
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

export default {
  packagerConfig: {
    name: 'Humatron',
    executableName: 'Humatron',
    asar: { unpack: '**/node_modules/{sharp,onnxruntime-node,@img}/**' },   // their DLLs (libvips, onnxruntime) must sit next to the .node files
    icon: 'src/assets/icon',
    ignore: (p) => p !== '' && !/^\/(dist|src\/assets|node_modules|package\.json)(\/|$)/.test(p) && !/^\/src$/.test(p),
  },
  rebuildConfig: { onlyModules: [] },   // better-sqlite3 ships Node-API prebuilds that already load in Electron; no VS toolchain needed
  hooks: { generateAssets: async () => { const { execSync } = await import('child_process'); execSync('node build.mjs', { stdio: 'inherit' }); } },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'Humatron', setupExe: 'HumatronSetup.exe' } },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
