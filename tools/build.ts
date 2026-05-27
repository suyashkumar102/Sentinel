#!/usr/bin/env -S node --experimental-strip-types
/**
 * Sentinel build pipeline.
 *
 *   --watch    rebuild on source changes
 *   --minify   minify outputs (used for release builds)
 *
 * Two parallel esbuild graphs:
 *   client → public/<entry>.js   (esm, browser, ES2023)
 *   server → dist/server/index.js (cjs, node, ES2023)
 */
import fs from "node:fs";
import path from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";
import esbuild from "esbuild";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const minify = args.has("--minify");

const base: BuildOptions = {
  bundle: true,
  logLevel: "info",
  metafile: true,
  sourcemap: "linked",
  target: "es2023",
  minify,
  legalComments: "none",
};

const clientOpts: BuildOptions = {
  ...base,
  entryPoints: ["src/client/splash.ts", "src/client/dashboard.ts"],
  format: "esm",
  outdir: "public",
  platform: "browser",
};

const serverOpts: BuildOptions = {
  ...base,
  entryPoints: ["src/server/index.ts"],
  format: "cjs",
  outdir: "dist/server",
  platform: "node",
};

async function writeMeta(name: string, result: BuildResult): Promise<void> {
  if (!result.metafile) return;
  const out = path.join("dist", `${name}.meta.json`);
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await fs.promises.writeFile(out, JSON.stringify(result.metafile));
}

async function main(): Promise<void> {
  if (watch) {
    const [clientCtx, serverCtx] = await Promise.all([
      esbuild.context(clientOpts),
      esbuild.context(serverOpts),
    ]);
    await Promise.all([clientCtx.watch(), serverCtx.watch()]);
    console.log("[sentinel] watch mode active");
    return;
  }

  const [clientResult, serverResult] = await Promise.all([
    esbuild.build(clientOpts),
    esbuild.build(serverOpts),
  ]);
  await Promise.all([
    writeMeta("client", clientResult),
    writeMeta("server", serverResult),
  ]);
  console.log("[sentinel] build complete");
}

main().catch((err: unknown) => {
  console.error("[sentinel] build failed", err);
  process.exit(1);
});
