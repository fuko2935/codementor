#!/usr/bin/env node

// Thin wrapper kept for compatibility.
// Delegates to the compiled TypeScript implementation in dist/scripts/copy-assets.cjs (ESM build target).
// If the compiled script is missing, exits with a clear error.

const path = require("path");

async function main() {
  try {
    const compiledPath = path.resolve(__dirname, "../dist/scripts/copy-assets.cjs");
    // eslint-disable-next-line import/no-dynamic-require, global-require
    require(compiledPath);
  } catch (err) {
    process.stderr.write(
      "[copy-assets] Failed to load compiled script from dist/scripts/copy-assets.cjs\n" +
        "[copy-assets] Make sure you have run `npm run build` before invoking this script.\n" +
        `[copy-assets] Error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}

main();