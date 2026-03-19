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
});
