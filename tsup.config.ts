import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  splitting: false,
  skipNodeModulesBundle: false,
  noExternal: [/.*/],
  outExtension() {
    return {
      js: ".cjs"
    };
  }
});
