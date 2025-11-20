import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");

// Kaynak: src/mcp-server/tools altındaki tüm **/templates dizinleri
const srcToolsDir = path.join(rootDir, "src", "mcp-server", "tools");

// Hedefler:
// - dist/mcp-server/tools
// - dist-test/src/mcp-server/tools
const targetDirs = [
  path.join(rootDir, "dist", "mcp-server", "tools"),
  path.join(rootDir, "dist-test", "src", "mcp-server", "tools"),
] as const;

async function copyDirectory(
  srcDir: string,
  destDir: string,
): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });

  const entries = await fs.promises.readdir(srcDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function main(): Promise<void> {
  try {
    // src/mcp-server/tools altındaki tüm templates klasörlerini bul
    const pattern = path.join(
      srcToolsDir.replace(/\\/g, "/"),
      "**",
      "templates",
      "/",
    );

    const templateDirs = await glob(pattern, {
      onlyDirectories: true,
      absolute: true,
    });

    if (templateDirs.length === 0) {
      process.stderr.write(
        `[copy-assets] No templates directories found under: ${srcToolsDir}\n`,
      );
      process.exit(1);
      return;
    }

    for (const srcTemplatesDir of templateDirs) {
      // src/mcp-server/tools altına göre rölatif yol
      const relativePath = path.relative(srcToolsDir, srcTemplatesDir);

      for (const baseTargetDir of targetDirs) {
        const targetTemplatesDir = path.join(baseTargetDir, relativePath);

        try {
          await copyDirectory(srcTemplatesDir, targetTemplatesDir);
          process.stdout.write(
            `[copy-assets] Synced templates: ${srcTemplatesDir} -> ${targetTemplatesDir}\n`,
          );
        } catch (error) {
          process.stderr.write(
            `[copy-assets] Failed to copy templates directory\n` +
              `[copy-assets] Source: ${srcTemplatesDir}\n` +
              `[copy-assets] Target: ${targetTemplatesDir}\n` +
              `[copy-assets] Error: ${
                error instanceof Error ? error.message : String(error)
              }\n`,
          );
          process.exit(1);
        }
      }
    }

    // analysis_modes klasörünü dist ve dist-test altına kopyala
    const analysisModesSrc = path.join(rootDir, "analysis_modes");
    const analysisModesTargets = [
      path.join(rootDir, "dist", "analysis_modes"),
      path.join(rootDir, "dist-test", "analysis_modes"),
    ];

    for (const target of analysisModesTargets) {
      try {
        await copyDirectory(analysisModesSrc, target);
        process.stdout.write(
          `[copy-assets] Synced analysis_modes: ${analysisModesSrc} -> ${target}\n`,
        );
      } catch (error) {
        process.stderr.write(
          `[copy-assets] Failed to copy analysis_modes directory\n` +
            `[copy-assets] Source: ${analysisModesSrc}\n` +
            `[copy-assets] Target: ${target}\n` +
            `[copy-assets] Error: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
        );
        process.exit(1);
      }
    }
  } catch (error) {
    process.stderr.write(
      "[copy-assets] Unexpected error while copying templates directories.\n" +
        `[copy-assets] Error: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(
    "[copy-assets] Unhandled rejection.\n" +
      `[copy-assets] Error: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
  );
  process.exit(1);
});
