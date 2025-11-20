/**
 * @fileoverview Multi-language code metadata extractor.
 * Extracts structural metadata (classes, functions, imports, exports) from various
 * programming languages to enable AI-powered logical file grouping.
 * @module src/mcp-server/utils/codeParser
 */

import parser from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import path from "path";
import { logger, type RequestContext } from "../../utils/index.js";
import { countTokensLocally } from "./tokenizer.js";
import { TreeSitterLoader } from "./treeSitterLoader.js";
import { TreeSitterParserImpl } from "./treeSitterParser.js";

/**
 * Supported programming languages and file types.
 */
export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "go"
  | "rust"
  | "csharp"
  | "ruby"
  | "php"
  | "json"
  | "yaml"
  | "markdown"
  | "unknown";

/**
 * Metadata extracted from a source file.
 */
export interface FileMetadata {
  filePath: string;
  language: SupportedLanguage;
  classes: string[];
  functions: string[];
  imports: string[];
  exports: string[];
  estimatedTokens: number;
  previewLines?: string[]; // For JSON/Markdown/YAML files
}

/**
 * Detects the programming language from file extension.
 */
function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  const extMap: Record<string, SupportedLanguage> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".markdown": "markdown",
  };
  return extMap[ext] || "unknown";
}

/**
 * Estimates token count for a given content string.
 * Uses the tokenizer utility if available, otherwise falls back to heuristic.
 */
function estimateTokens(content: string): number {
  try {
    return countTokensLocally(content);
  } catch {
    // Fallback heuristic if tokenizer fails
    const basic = Math.ceil(content.length / 4);
    const newlines = (content.match(/\n/g) || []).length;
    const specials = (
      content.match(/[{}[\]();,.<>/\\=+\-*&|!@#$%^`~]/g) || []
    ).length;
    return basic + Math.ceil(newlines * 0.5) + Math.ceil(specials * 0.2);
  }
}

/**
 * Extracts metadata from JavaScript/TypeScript files using Babel.
 */
function parseJavaScriptTypeScript(
  content: string,
  filePath: string,
  language: SupportedLanguage,
): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const ast = parser.parse(content, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "objectRestSpread",
        "asyncGenerators",
        "functionBind",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "dynamicImport",
        "nullishCoalescingOperator",
        "optionalChaining",
        "topLevelAwait",
      ],
      tokens: false,
    });

    traverse(ast, {
      // Class declarations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ClassDeclaration(path: NodePath<any>) {
        if (path.node.id?.name) {
          metadata.classes.push(path.node.id.name);
        }
      },

      // Function declarations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      FunctionDeclaration(path: NodePath<any>) {
        if (path.node.id?.name) {
          metadata.functions.push(path.node.id.name);
        }
      },

      // Arrow functions assigned to variables
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      VariableDeclarator(path: NodePath<any>) {
        if (
          path.node.init?.type === "ArrowFunctionExpression" ||
          path.node.init?.type === "FunctionExpression"
        ) {
          if (path.node.id.type === "Identifier" && path.node.id.name) {
            metadata.functions.push(path.node.id.name);
          }
        }
      },

      // Import declarations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ImportDeclaration(path: NodePath<any>) {
        const source = path.node.source.value;
        if (typeof source === "string") {
          metadata.imports.push(source);
        }
      },

      // Named exports
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ExportNamedDeclaration(path: NodePath<any>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        path.node.specifiers?.forEach((spec: any) => {
          if (spec.type === "ExportSpecifier") {
            if (spec.exported.type === "Identifier") {
              metadata.exports.push(spec.exported.name);
            }
          }
        });
      },

      // Default export
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ExportDefaultDeclaration(path: NodePath<any>) {
        if (path.node.declaration.type === "Identifier") {
          metadata.exports.push(path.node.declaration.name);
        } else if (path.node.declaration.type === "FunctionDeclaration") {
          if (path.node.declaration.id?.name) {
            metadata.exports.push(path.node.declaration.id.name);
          } else {
            metadata.exports.push("default");
          }
        } else if (path.node.declaration.type === "ClassDeclaration") {
          if (path.node.declaration.id?.name) {
            metadata.exports.push(path.node.declaration.id.name);
          } else {
            metadata.exports.push("default");
          }
        } else {
          metadata.exports.push("default");
        }
      },
    });
  } catch (error) {
    // Parse error - log and return minimal metadata
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse JavaScript/TypeScript file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from Python files using regex patterns.
 */
function parsePython(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "python",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Class definitions: class ClassName or class ClassName(Base):
      const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (classMatch) {
        metadata.classes.push(classMatch[1]);
      }

      // Function definitions: def function_name( or async def function_name(
      const funcMatch = trimmed.match(/^(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (funcMatch) {
        metadata.functions.push(funcMatch[2]);
      }

      // Import statements: import module or from module import item
      const importMatch = trimmed.match(/^(import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/);
      if (importMatch) {
        // Extract module name (handle "from X import Y" -> "X")
        const modulePart = importMatch[2].split(".")[0];
        if (!metadata.imports.includes(modulePart)) {
          metadata.imports.push(modulePart);
        }
      }
    }

    // Python doesn't have explicit exports like JS, but __all__ can indicate exports
    const allMatch = content.match(/__all__\s*=\s*\[(.*?)\]/s);
    if (allMatch) {
      const exports = allMatch[1]
        .split(",")
        .map((e) => e.trim().replace(/["']/g, ""))
        .filter(Boolean);
      metadata.exports.push(...exports);
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse Python file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from Java files using regex patterns.
 */
function parseJava(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "java",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Class declarations: public class ClassName, class ClassName, etc.
      const classMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+)?(abstract\s+|final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (classMatch) {
        metadata.classes.push(classMatch[3]);
      }

      // Interface declarations
      const interfaceMatch = trimmed.match(
        /^(public\s+|private\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (interfaceMatch) {
        metadata.classes.push(interfaceMatch[2]); // Treat interfaces as classes
      }

      // Method declarations: public void methodName(, private String methodName(, etc.
      const methodMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?[A-Za-z_][A-Za-z0-9_.<>[\]\s]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      );
      if (methodMatch && methodMatch[5]) {
        metadata.functions.push(methodMatch[5]);
      }

      // Import statements: import java.util.List; or import static java.lang.Math.*;
      const importMatch = trimmed.match(/^import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.]*)/);
      if (importMatch) {
        const importPath = importMatch[1].split(".")[0];
        if (!metadata.imports.includes(importPath)) {
          metadata.imports.push(importPath);
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse Java file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from Go files using regex patterns.
 */
function parseGo(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "go",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Type declarations: type StructName struct, type InterfaceName interface
      const typeMatch = trimmed.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)/);
      if (typeMatch) {
        metadata.classes.push(typeMatch[1]);
      }

      // Function declarations: func FunctionName( or func (r *Receiver) MethodName(
      const funcMatch = trimmed.match(
        /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      );
      if (funcMatch) {
        metadata.functions.push(funcMatch[1]);
      }

      // Import statements: import "package" or import ( "pkg1" "pkg2" )
      const importMatch = trimmed.match(/^import\s+(?:"([^"]+)"|\(|([A-Za-z_][A-Za-z0-9_/]*))/);
      if (importMatch) {
        const importPath = importMatch[1] || importMatch[2];
        if (importPath) {
          const pkg = importPath.split("/")[0];
          if (!metadata.imports.includes(pkg)) {
            metadata.imports.push(pkg);
          }
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse Go file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from Rust files using regex patterns.
 */
function parseRust(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "rust",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Struct declarations: pub struct StructName, struct StructName
      const structMatch = trimmed.match(/^(pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (structMatch) {
        metadata.classes.push(structMatch[2]);
      }

      // Enum declarations: pub enum EnumName, enum EnumName
      const enumMatch = trimmed.match(/^(pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (enumMatch) {
        metadata.classes.push(enumMatch[2]);
      }

      // Trait declarations: pub trait TraitName, trait TraitName
      const traitMatch = trimmed.match(/^(pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (traitMatch) {
        metadata.classes.push(traitMatch[2]);
      }

      // Function declarations: pub fn function_name(, fn function_name(
      const fnMatch = trimmed.match(/^(pub\s+)?(async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (fnMatch) {
        metadata.functions.push(fnMatch[3]);
      }

      // Method implementations: impl StructName { fn method_name(
      const implMatch = trimmed.match(/^impl\s+(?:[^{]*)\s*{/);
      if (implMatch) {
        // Note: Methods are captured in fnMatch above
      }

      // Use statements: use std::collections::HashMap; or use crate::module;
      const useMatch = trimmed.match(/^use\s+([A-Za-z_][A-Za-z0-9_:]*)/);
      if (useMatch) {
        const usePath = useMatch[1].split("::")[0];
        if (!metadata.imports.includes(usePath)) {
          metadata.imports.push(usePath);
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse Rust file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from C# files using regex patterns.
 */
function parseCSharp(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "csharp",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Class declarations: public class ClassName, class ClassName
      const classMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+|internal\s+)?(abstract\s+|sealed\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (classMatch) {
        metadata.classes.push(classMatch[3]);
      }

      // Interface declarations
      const interfaceMatch = trimmed.match(
        /^(public\s+|private\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (interfaceMatch) {
        metadata.classes.push(interfaceMatch[2]);
      }

      // Method declarations: public void MethodName(, private string MethodName(
      const methodMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(async\s+)?[A-Za-z_][A-Za-z0-9_.<>[\]\s]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      );
      if (methodMatch && methodMatch[4]) {
        metadata.functions.push(methodMatch[4]);
      }

      // Using statements: using System; or using System.Collections.Generic;
      const usingMatch = trimmed.match(/^using\s+([A-Za-z_][A-Za-z0-9_.]*)/);
      if (usingMatch) {
        const usingPath = usingMatch[1].split(".")[0];
        if (!metadata.imports.includes(usingPath)) {
          metadata.imports.push(usingPath);
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse C# file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from Ruby files using regex patterns.
 */
function parseRuby(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "ruby",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Class declarations: class ClassName or class ClassName < SuperClass
      const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (classMatch) {
        metadata.classes.push(classMatch[1]);
      }

      // Module declarations: module ModuleName
      const moduleMatch = trimmed.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (moduleMatch) {
        metadata.classes.push(moduleMatch[1]); // Treat modules as classes
      }

      // Method definitions: def method_name( or def self.method_name(
      const defMatch = trimmed.match(/^def\s+(?:self\.)?([A-Za-z_][A-Za-z0-9_?!]*)\s*\(?/);
      if (defMatch) {
        metadata.functions.push(defMatch[1]);
      }

      // Require statements: require 'library' or require_relative 'file'
      const requireMatch = trimmed.match(/^require(?:_relative)?\s+['"]([^'"]+)['"]/);
      if (requireMatch) {
        const requirePath = requireMatch[1].split("/")[0];
        if (!metadata.imports.includes(requirePath)) {
          metadata.imports.push(requirePath);
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse Ruby file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts metadata from PHP files using regex patterns.
 */
function parsePHP(content: string, filePath: string): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language: "php",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };

  try {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Class declarations: class ClassName or abstract class ClassName
      const classMatch = trimmed.match(/^(abstract\s+|final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (classMatch) {
        metadata.classes.push(classMatch[2]);
      }

      // Interface declarations: interface InterfaceName
      const interfaceMatch = trimmed.match(/^interface\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (interfaceMatch) {
        metadata.classes.push(interfaceMatch[1]);
      }

      // Trait declarations: trait TraitName
      const traitMatch = trimmed.match(/^trait\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (traitMatch) {
        metadata.classes.push(traitMatch[1]);
      }

      // Function declarations: function functionName( or public function methodName(
      const funcMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+)?(static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      );
      if (funcMatch) {
        metadata.functions.push(funcMatch[3]);
      }

      // Use/import statements: use Namespace\Class; or require 'file.php';
      const useMatch = trimmed.match(/^use\s+([A-Za-z_\\][A-Za-z0-9_\\]*)/);
      if (useMatch) {
        const usePath = useMatch[1].split("\\")[0];
        if (!metadata.imports.includes(usePath)) {
          metadata.imports.push(usePath);
        }
      }

      const requireMatch = trimmed.match(/^(require|include)(?:_once)?\s+['"]([^'"]+)['"]/);
      if (requireMatch) {
        const requirePath = requireMatch[2].split("/")[0];
        if (!metadata.imports.includes(requirePath)) {
          metadata.imports.push(requirePath);
        }
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse PHP file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Extracts minimal metadata from JSON/YAML/Markdown files.
 * Includes preview lines for context.
 */
function parseTextFile(
  content: string,
  filePath: string,
  language: SupportedLanguage,
): FileMetadata {
  const metadata: FileMetadata = {
    filePath,
    language,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
    previewLines: [],
  };

  try {
    const lines = content.split("\n");
    // Take first 10 lines as preview
    metadata.previewLines = lines.slice(0, 10).filter((line) => line.trim().length > 0);

    // For Markdown, try to extract headers (h1, h2, etc.)
    if (language === "markdown") {
      for (const line of lines.slice(0, 50)) {
        // Extract # Header or ## Header
        const headerMatch = line.match(/^#{1,6}\s+(.+)/);
        if (headerMatch) {
          metadata.exports.push(headerMatch[1].trim());
        }
      }
    }

    // For JSON, try to parse and extract top-level keys
    if (language === "json") {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null) {
          Object.keys(parsed).slice(0, 10).forEach((key) => {
            metadata.exports.push(key);
          });
        }
      } catch {
        // Invalid JSON, skip key extraction
      }
    }
  } catch (error) {
    const logContext: RequestContext = {
      requestId: "code-parser",
      timestamp: new Date().toISOString(),
      filePath,
    };
    logger.warning("Failed to parse text file", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return metadata;
}

/**
 * Creates minimal metadata for files that couldn't be parsed.
 */
function createMinimalMetadata(
  filePath: string,
  content: string,
  language: SupportedLanguage,
): FileMetadata {
  return {
    filePath,
    language,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    estimatedTokens: estimateTokens(content),
  };
}

// Global singleton loader and parser (lazy initialized)
let treeSitterLoader: TreeSitterLoader | null = null;
let treeSitterParser: TreeSitterParserImpl | null = null;

/**
 * Gets or initializes the Tree-sitter loader singleton.
 * Returns null if initialization fails (graceful fallback).
 *
 * @returns TreeSitterLoader instance or null if initialization failed
 */
async function getTreeSitterLoader(): Promise<TreeSitterLoader | null> {
  if (!treeSitterLoader) {
    try {
      treeSitterLoader = new TreeSitterLoader();
      await treeSitterLoader.initialize();

      // Initialize parser instance
      const parser = treeSitterLoader.getParser();
      if (parser) {
        treeSitterParser = new TreeSitterParserImpl();
        treeSitterParser.setParser(parser);
      }
    } catch (error) {
      // Reset loader to null so we can retry on next call
      treeSitterLoader = null;
      treeSitterParser = null;

      const logContext: RequestContext = {
        requestId: "code-parser",
        timestamp: new Date().toISOString(),
      };
      logger.warning("Tree-sitter initialization failed, will use regex fallback", {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return treeSitterLoader;
}

/**
 * Pre-initializes Tree-sitter WASM and optionally pre-loads common languages.
 * Useful for STDIO transport to prevent WASM loading messages from polluting stdout.
 * This is safe to call multiple times (uses singleton pattern).
 *
 * @param languagesToPreload - Optional list of languages to pre-load (default: ["javascript"])
 * @returns Promise resolving when initialization is complete
 */
export async function warmupTreeSitter(
  languagesToPreload: SupportedLanguage[] = ["javascript"],
): Promise<void> {
  const loader = await getTreeSitterLoader();
  if (!loader) {
    return; // Initialization failed, will retry on first use
  }

  // Pre-load specified languages to warm up cache
  for (const lang of languagesToPreload) {
    try {
      await loader.loadLanguage(lang);
    } catch {
      // Ignore errors - language will be loaded on first use
    }
  }
}

/**
 * Extracts metadata from a source file based on its language.
 *
 * @param filePath - Relative or absolute path to the file
 * @param content - File content as string
 * @param context - Request context for logging
 * @returns Promise resolving to FileMetadata
 */
export async function extractMetadata(
  filePath: string,
  content: string,
  context?: RequestContext,
): Promise<FileMetadata> {
  const language = detectLanguage(filePath);

  // Skip binary or unreadable files
  if (content.length === 0) {
    return createMinimalMetadata(filePath, content, language);
  }

  // Try Tree-sitter first (for supported languages)
  const treeSitterEnabled = [
    "java",
    "go",
    "rust",
    "csharp",
    "ruby",
    "php",
    "python",
  ].includes(language);

  if (treeSitterEnabled) {
    try {
      const loader = await getTreeSitterLoader();
      if (loader && treeSitterParser) {
        const langModule = await loader.loadLanguage(language);
        if (langModule) {
          return treeSitterParser.parse(
            content,
            langModule,
            language,
            filePath,
          );
        }
      }
    } catch (error) {
      // Fall through to regex
      const logContext: RequestContext = context
        ? (context as RequestContext)
        : {
            requestId: "code-parser",
            timestamp: new Date().toISOString(),
          };
      
      // Log as warning on first failure to make it more visible
      // Use a static flag to avoid spamming logs
      if (!(global as any).__treeSitterWarningShown) {
        logger.warning("Tree-sitter parsing failed, falling back to regex parsing. This may reduce parsing accuracy.", {
          ...logContext,
          filePath,
          language,
          error: error instanceof Error ? error.message : String(error),
          hint: "Check if tree-sitter WASM files are properly installed"
        });
        (global as any).__treeSitterWarningShown = true;
      } else {
        logger.debug("Tree-sitter parsing failed, using regex fallback", {
          ...logContext,
          filePath,
          language,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Fallback to existing regex/Babel parsers
  try {
    switch (language) {
      case "typescript":
      case "javascript":
        return parseJavaScriptTypeScript(content, filePath, language);

      case "python":
        return parsePython(content, filePath);

      case "java":
        return parseJava(content, filePath);

      case "go":
        return parseGo(content, filePath);

      case "rust":
        return parseRust(content, filePath);

      case "csharp":
        return parseCSharp(content, filePath);

      case "ruby":
        return parseRuby(content, filePath);

      case "php":
        return parsePHP(content, filePath);

      case "json":
      case "yaml":
      case "markdown":
        return parseTextFile(content, filePath, language);

      default:
        // Unknown language - try Babel as fallback, then minimal
        try {
          return parseJavaScriptTypeScript(content, filePath, "javascript");
        } catch {
          const debugContext: RequestContext = context
            ? (context as RequestContext)
            : {
                requestId: "code-parser",
                timestamp: new Date().toISOString(),
              };
          logger.debug("Unsupported file type, using minimal metadata", {
            ...debugContext,
            filePath,
            language,
          });
          return createMinimalMetadata(filePath, content, language);
        }
    }
  } catch (error) {
    // Final fallback: minimal metadata
    const logContext: RequestContext = context
      ? (context as RequestContext)
      : {
          requestId: "metadata-extraction",
          timestamp: new Date().toISOString(),
        };
    logger.warning("Metadata extraction failed, using minimal metadata", {
      ...logContext,
      filePath,
      language,
      error: error instanceof Error ? error.message : String(error),
    });
    return createMinimalMetadata(filePath, content, language);
  }
}

