import { defineConfig } from "wxt";
import { manifest } from "./src/manifest";

export default defineConfig({
  srcDir: "src",
  imports: false,
  outDir: ".output",
  manifest,
});
