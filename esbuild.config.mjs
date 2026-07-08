import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
 * Obsidian Confluence Git Sync
 * Copyright (c) 2026 DIAL Studio
 * License: MIT
 */
`;

const isProd = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["./src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: isProd ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (isProd) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
