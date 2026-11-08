import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  minify: true,
  clean: true,
  splitting: false,
  // Bundle seek-bzip into the dist output instead of leaving it as an
  // external require(). This is critical for Electron Forge packaging,
  // where node_modules are not available at runtime inside the asar.
  noExternal: ["seek-bzip"],
  // `src/protocols/map.ts` finds protocols/ via `__dirname`, which ESM doesn't have: the shim derives it from
  // `import.meta.url`. Without it the ESM build only searched relative to `process.cwd()` and failed wherever the
  // package isn't below the working directory (serverless functions, e.g. Vercel). `node scripts/check-dist.mjs`.
  shims: true,
});
