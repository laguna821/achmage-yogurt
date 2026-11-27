import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
const root = resolve(import.meta.dirname),
  out = resolve(root, "../mobile-lab-dist");
export default defineConfig({
  root,
  base: "./",
  plugins: [
    react(),
    {
      name: "local-runtime-and-offline-shell",
      closeBundle() {
        const runtime = resolve(
          root,
          "../../node_modules/onnxruntime-web/dist",
        );
        mkdirSync(resolve(out, "ort"), { recursive: true });
        for (const name of [
          "ort-wasm-simd-threaded.jsep.mjs",
          "ort-wasm-simd-threaded.jsep.wasm",
        ])
          copyFileSync(resolve(runtime, name), resolve(out, "ort", name));
        const files = [
          "./",
          "./index.html",
          "./manifest.webmanifest",
          "./icon.svg",
          "./icon-512.png",
          "./apple-touch-icon.png",
          ...readdirSync(resolve(out, "assets"))
            .filter((x) => !x.endsWith(".map") && !x.endsWith(".wasm"))
            .map((x) => "./assets/" + x),
          "./ort/ort-wasm-simd-threaded.jsep.mjs",
          "./ort/ort-wasm-simd-threaded.jsep.wasm",
        ];
        const version = "achmage-yogurt-shell-" + Date.now();
        const template = readFileSync(resolve(root, "sw.template.js"), "utf8");
        writeFileSync(
          resolve(out, "sw.js"),
          template
            .replace("__VERSION__", JSON.stringify(version))
            .replace("__ASSETS__", JSON.stringify(files)),
        );
      },
    },
  ],
  worker: { format: "es" },
  build: {
    outDir: out,
    emptyOutDir: true,
    license: { fileName: "LICENSES.txt" },
  },
});
