import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, "../src/mcp-server/tools/mcpSetupGuide/templates");

const targetDirs = [
  path.resolve(__dirname, "../dist/mcp-server/tools/mcpSetupGuide/templates"),
  path.resolve(__dirname, "../dist-test/src/mcp-server/tools/mcpSetupGuide/templates"),
];

function copyRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main(): void {
  try {
    if (!fs.existsSync(srcDir)) {
      process.stderr.write(
        `[copy-assets] Source directory not found: ${srcDir}\n` +
          "[copy-assets] Ensure templates exist before running this script.\n",
      );
      process.exitCode = 1;
      return;
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    if (entries.length === 0) {
      process.stderr.write(
        `[copy-assets] Source directory is empty: ${srcDir}\n` +
          "[copy-assets] No templates to copy.\n",
      );
      // Non-fatal: continue to sync (idempotent behaviour).
    }

    for (const targetDir of targetDirs) {
      try {
        copyRecursive(srcDir, targetDir);
      } catch (err) {
        process.stderr.write(
          `[copy-assets] Failed to copy templates to target: ${targetDir}\n` +
            `[copy-assets] Error: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
        );
        process.exit(1);
      }
    }
  } catch (err) {
    process.stderr.write(
      "[copy-assets] Unexpected error while copying templates.\n" +
        `[copy-assets] Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

main();