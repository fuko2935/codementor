/**
 * @fileoverview Tree-sitter language grammar loader and cache manager.
 * Handles WASM initialization and lazy loading of language grammars.
 * @module src/mcp-server/utils/treeSitterLoader
 */

import * as TreeSitter from "web-tree-sitter";
import type { Language, Parser } from "web-tree-sitter";
import path from "path";
import { createRequire } from "module";
import { existsSync } from "fs";
import { logger, type RequestContext } from "../../utils/index.js";
import type { SupportedLanguage } from "./codeParser.js";

const require = createRequire(import.meta.url);

/**
 * Tree-sitter language module with parser language and name.
 */
export interface TreeSitterLanguage {
  language: Language;
  name: string;
}

/**
 * Interface for language loader operations.
 */
export interface LanguageLoader {
  /**
   * Loads a language grammar (with caching).
   * @param lang - The supported language to load
   * @returns Promise resolving to TreeSitterLanguage or null if loading fails
   */
  loadLanguage(lang: SupportedLanguage): Promise<TreeSitterLanguage | null>;

  /**
   * Gets cached language if available.
   * @param lang - The supported language to retrieve
   * @returns Cached TreeSitterLanguage or null if not cached
   */
  getCachedLanguage(lang: SupportedLanguage): TreeSitterLanguage | null;

  /**
   * Clears the language cache.
   */
  clearCache(): void;
}

/**
 * Maps supported languages to their tree-sitter package names.
 */
const LANGUAGE_PACKAGE_MAP: Record<string, string> = {
  java: "tree-sitter-java",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
  csharp: "tree-sitter-c-sharp",
  ruby: "tree-sitter-ruby",
  php: "tree-sitter-php",
  python: "tree-sitter-python",
  javascript: "tree-sitter-javascript",
  typescript: "tree-sitter-typescript",
};

/**
 * Maps supported languages to their WASM file names.
 */
const LANGUAGE_WASM_MAP: Record<string, string> = {
  java: "tree-sitter-java.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  csharp: "tree-sitter-c-sharp.wasm",
  ruby: "tree-sitter-ruby.wasm",
  php: "tree-sitter-php.wasm",
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
};

/**
 * Finds the WASM file path for a given package name.
 * Checks multiple possible locations where WASM files might be stored.
 *
 * @param packageName - The npm package name (e.g., "tree-sitter-java")
 * @returns The absolute path to the WASM file, or null if not found
 */
function findWasmPath(packageName: string): string | null {
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packagePath);

    // Try root directory first: node_modules/tree-sitter-*/tree-sitter-*.wasm
    const languageKey = Object.keys(LANGUAGE_PACKAGE_MAP).find(
      (key) => LANGUAGE_PACKAGE_MAP[key] === packageName,
    );
    const wasmFileName =
      (languageKey && LANGUAGE_WASM_MAP[languageKey]) ||
      `${packageName}.wasm`;
    const rootWasmPath = path.join(packageDir, wasmFileName);
    if (existsSync(rootWasmPath)) {
      return rootWasmPath;
    }

    // Try bindings/node directory: node_modules/tree-sitter-*/bindings/node/tree-sitter-*.wasm
    const bindingsPath = path.join(
      packageDir,
      "bindings",
      "node",
      wasmFileName,
    );
    if (existsSync(bindingsPath)) {
      return bindingsPath;
    }

    // Try src directory: node_modules/tree-sitter-*/src/tree-sitter-*.wasm
    const srcPath = path.join(packageDir, "src", wasmFileName);
    if (existsSync(srcPath)) {
      return srcPath;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Loads Tree-sitter WASM module and language grammars.
 * Uses lazy loading and caching for performance.
 */
export class TreeSitterLoader implements LanguageLoader {
  private parser: Parser | null = null;
  private languageCache: Map<SupportedLanguage, TreeSitterLanguage> = new Map();
  private loadingPromises: Map<
    SupportedLanguage,
    Promise<TreeSitterLanguage | null>
  > = new Map();
  private initialized: boolean = false;

  /**
   * Initializes Tree-sitter WASM parser.
   * Must be called before loading any languages.
   *
   * @throws Error if WASM initialization fails
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.parser) {
      return;
    }

    try {
      // In STDIO mode, suppress console output during WASM initialization
      const isStdioMode = process.env.MCP_TRANSPORT_TYPE === "stdio";
      let consoleOverride = false;
      let originalLog: typeof console.log;
      let originalInfo: typeof console.info;
      let originalWarn: typeof console.warn;
      let originalError: typeof console.error;

      if (isStdioMode) {
        consoleOverride = true;
        originalLog = console.log;
        originalInfo = console.info;
        originalWarn = console.warn;
        originalError = console.error;
        
        console.log = () => {};
        console.info = () => {};
        console.warn = () => {};
        console.error = () => {};
      }

      try {
        await TreeSitter.Parser.init();
        this.parser = new TreeSitter.Parser();
        this.initialized = true;
      } finally {
        // Restore console methods if they were overridden
        if (consoleOverride) {
          console.log = originalLog!;
          console.info = originalInfo!;
          console.warn = originalWarn!;
          console.error = originalError!;
        }
      }
    } catch (error) {
      const logContext: RequestContext = {
        requestId: "tree-sitter-loader",
        timestamp: new Date().toISOString(),
      };
      logger.warning("Failed to initialize Tree-sitter WASM parser", {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Loads a language grammar (with caching).
   * If the language is already cached, returns the cached version.
   * If a load is already in progress, returns the existing promise.
   *
   * @param lang - The supported language to load
   * @returns Promise resolving to TreeSitterLanguage or null if loading fails
   */
  async loadLanguage(
    lang: SupportedLanguage,
  ): Promise<TreeSitterLanguage | null> {
    // Check cache first
    const cached = this.getCachedLanguage(lang);
    if (cached) {
      return cached;
    }

    // Check if loading is already in progress
    const existingPromise = this.loadingPromises.get(lang);
    if (existingPromise) {
      return existingPromise;
    }

    // Create new loading promise
    const loadPromise = this._loadLanguageInternal(lang);
    this.loadingPromises.set(lang, loadPromise);

    try {
      const result = await loadPromise;
      // Remove from loading promises once complete
      this.loadingPromises.delete(lang);
      return result;
    } catch (error) {
      // Remove from loading promises on error
      this.loadingPromises.delete(lang);
      throw error;
    }
  }

  /**
   * Internal method to load a language grammar.
   *
   * @param lang - The supported language to load
   * @returns Promise resolving to TreeSitterLanguage or null if loading fails
   */
  private async _loadLanguageInternal(
    lang: SupportedLanguage,
  ): Promise<TreeSitterLanguage | null> {
    if (!this.initialized || !this.parser) {
      await this.initialize();
    }

    if (!this.parser) {
      return null;
    }

    const packageName = LANGUAGE_PACKAGE_MAP[lang];
    if (!packageName) {
      const logContext: RequestContext = {
        requestId: "tree-sitter-loader",
        timestamp: new Date().toISOString(),
      };
      logger.debug("Language not supported by Tree-sitter", {
        ...logContext,
        language: lang,
      });
      return null;
    }

    // Find WASM file path
    const wasmPath = findWasmPath(packageName);
    if (!wasmPath) {
      const logContext: RequestContext = {
        requestId: "tree-sitter-loader",
        timestamp: new Date().toISOString(),
      };
      logger.debug("WASM file not found for language", {
        ...logContext,
        language: lang,
        packageName,
      });
      return null;
    }

    try {
      // In STDIO mode, suppress console output during WASM loading
      const isStdioMode = process.env.MCP_TRANSPORT_TYPE === "stdio";
      let consoleOverride = false;
      let originalLog: typeof console.log;
      let originalInfo: typeof console.info;
      let originalWarn: typeof console.warn;
      let originalError: typeof console.error;

      if (isStdioMode) {
        consoleOverride = true;
        originalLog = console.log;
        originalInfo = console.info;
        originalWarn = console.warn;
        originalError = console.error;
        
        console.log = () => {};
        console.info = () => {};
        console.warn = () => {};
        console.error = () => {};
      }

      try {
        // Load language from WASM file
        const Language = (await import("web-tree-sitter")).Language;
        const language = await Language.load(wasmPath);

        // Set language on parser
        this.parser.setLanguage(language);

        // Cache the language
        const treeSitterLang: TreeSitterLanguage = {
          language,
          name: lang,
        };
        this.languageCache.set(lang, treeSitterLang);

        return treeSitterLang;
      } finally {
        // Restore console methods if they were overridden
        if (consoleOverride) {
          console.log = originalLog!;
          console.info = originalInfo!;
          console.warn = originalWarn!;
          console.error = originalError!;
        }
      }
    } catch (error) {
      const logContext: RequestContext = {
        requestId: "tree-sitter-loader",
        timestamp: new Date().toISOString(),
      };
      logger.warning("Failed to load Tree-sitter language grammar", {
        ...logContext,
        language: lang,
        packageName,
        wasmPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Gets cached language if available.
   *
   * @param lang - The supported language to retrieve
   * @returns Cached TreeSitterLanguage or null if not cached
   */
  getCachedLanguage(lang: SupportedLanguage): TreeSitterLanguage | null {
    return this.languageCache.get(lang) || null;
  }

  /**
   * Clears the language cache.
   */
  clearCache(): void {
    this.languageCache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Gets the underlying parser instance.
   * @returns Parser instance or null if not initialized
   */
  getParser(): Parser | null {
    return this.parser;
  }
}

