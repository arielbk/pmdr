import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
