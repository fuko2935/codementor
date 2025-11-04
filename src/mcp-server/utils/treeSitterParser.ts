/**
 * @fileoverview Tree-sitter AST parser for extracting code metadata.
 * Defines language-specific queries and extracts structural information.
 * @module src/mcp-server/utils/treeSitterParser
 */

import * as TreeSitter from "web-tree-sitter";
import type { Query, Tree } from "web-tree-sitter";
import type { FileMetadata, SupportedLanguage } from "./codeParser.js";
import type { TreeSitterLanguage } from "./treeSitterLoader.js";
import { countTokensLocally } from "./tokenizer.js";

/**
 * Query patterns for each supported language.
 * Each query captures specific AST nodes for metadata extraction.
 */
const LANGUAGE_QUERIES: Record<
  SupportedLanguage,
  Record<string, string> | null
> = {
  java: {
    classes: "(class_declaration name: (identifier) @class_name)",
    interfaces: "(interface_declaration name: (identifier) @interface_name)",
    methods: "(method_declaration name: (identifier) @method_name)",
    imports: "(import_declaration (scoped_identifier) @import_path)",
  },
  go: {
    types: "(type_declaration (type_spec name: (type_identifier) @type_name))",
    functions: "(function_declaration name: (identifier) @func_name)",
    imports: "(import_spec path: (interpreted_string_literal) @import_path)",
  },
  rust: {
    structs: "(struct_item name: (type_identifier) @struct_name)",
    enums: "(enum_item name: (type_identifier) @enum_name)",
    traits: "(trait_item name: (type_identifier) @trait_name)",
    functions: "(function_item name: (identifier) @func_name)",
    uses: "(use_declaration (scoped_identifier) @use_path)",
  },
  csharp: {
    classes: "(class_declaration name: (identifier) @class_name)",
    interfaces: "(interface_declaration name: (identifier) @interface_name)",
    methods: "(method_declaration name: (identifier) @method_name)",
    usings: "(using_directive (qualified_name) @using_path)",
  },
  ruby: {
    classes: "(class name: (constant) @class_name)",
    modules: "(module name: (constant) @module_name)",
    methods: "(method name: (identifier) @method_name)",
    requires:
      "(call method: (identifier) @require_method (#eq? @require_method \"require\") arguments: (argument_list (string) @require_path))",
  },
  php: {
    classes: "(class_declaration name: (name) @class_name)",
    interfaces: "(interface_declaration name: (name) @interface_name)",
    traits: "(trait_declaration name: (name) @trait_name)",
    functions: "(function_definition name: (name) @func_name)",
    uses: "(use_declaration (qualified_name) @use_path)",
  },
  python: {
    classes: "(class_definition name: (identifier) @class_name)",
    functions: "(function_definition name: (identifier) @func_name)",
    imports:
      "(import_statement (dotted_as_names (dotted_as_name (dotted_name) @import_path)))",
  },
  javascript: null,
  typescript: null,
  json: null,
  yaml: null,
  markdown: null,
  unknown: null,
};

/**
 * Interface for Tree-sitter parser operations.
 */
export interface TreeSitterParser {
  /**
   * Parses content and extracts metadata.
   * @param content - Source code content
   * @param language - Tree-sitter language module
   * @param langType - Supported language type
   * @param filePath - File path for metadata
   * @returns Extracted file metadata
   */
  parse(
    content: string,
    language: TreeSitterLanguage,
    langType: SupportedLanguage,
    filePath: string,
  ): FileMetadata;
}

/**
 * Parses code using Tree-sitter AST and extracts metadata.
 */
export class TreeSitterParserImpl implements TreeSitterParser {
  private queries: Map<SupportedLanguage, Map<string, Query>> = new Map();
  private parser: TreeSitter.Parser | null = null;

  /**
   * Sets the parser instance to use for parsing.
   * @param parser - Tree-sitter parser instance
   */
  setParser(parser: TreeSitter.Parser): void {
    this.parser = parser;
  }

  /**
   * Initializes queries for a language and caches compiled queries.
   *
   * @param lang - The supported language
   * @param language - Tree-sitter language module
   */
  private initializeQueries(
    lang: SupportedLanguage,
    language: TreeSitterLanguage,
  ): void {
    // Check if queries already initialized
    if (this.queries.has(lang)) {
      return;
    }

    const queryMap = new Map<string, Query>();
    const queryDefs = LANGUAGE_QUERIES[lang];

    if (!queryDefs) {
      // Language not supported or queries not defined
      this.queries.set(lang, queryMap);
      return;
    }

    // Compile and cache queries
    for (const [queryName, queryString] of Object.entries(queryDefs)) {
      try {
        const query = new TreeSitter.Query(language.language, queryString);
        queryMap.set(queryName, query);
      } catch {
        // Query compilation failed - log and skip (using debug level to avoid stdout pollution in STDIO mode)
        // Note: console.warn would pollute stdout in STDIO transport and cause JSON parsing errors
      }
    }

    this.queries.set(lang, queryMap);
  }

  /**
   * Parses content and extracts metadata.
   *
   * @param content - Source code content
   * @param language - Tree-sitter language module
   * @param langType - Supported language type
   * @param filePath - File path for metadata
   * @returns Extracted file metadata
   */
  parse(
    content: string,
    language: TreeSitterLanguage,
    langType: SupportedLanguage,
    filePath: string,
  ): FileMetadata {
    let tree: Tree | null = null;
    try {
      if (!this.parser) {
        // Parser not initialized, return minimal metadata
        return {
          filePath,
          language: langType,
          classes: [],
          functions: [],
          imports: [],
          exports: [],
          estimatedTokens: countTokensLocally(content),
        };
      }

      // Initialize queries for this language
      this.initializeQueries(langType, language);

      // Set language on parser
      this.parser.setLanguage(language.language);

      // Parse content
      tree = this.parser.parse(content);
      if (!tree) {
        // Parsing failed, return minimal metadata
        return {
          filePath,
          language: langType,
          classes: [],
          functions: [],
          imports: [],
          exports: [],
          estimatedTokens: countTokensLocally(content),
        };
      }

      // Initialize metadata
      const metadata: FileMetadata = {
        filePath,
        language: langType,
        classes: [],
        functions: [],
        imports: [],
        exports: [],
        estimatedTokens: countTokensLocally(content),
      };

      // Get queries for this language
      const queryMap = this.queries.get(langType);
      if (!queryMap) {
        return metadata;
      }

      // Extract classes/types/structs
      const classQueries = [
        queryMap.get("classes"),
        queryMap.get("interfaces"),
        queryMap.get("types"),
        queryMap.get("structs"),
        queryMap.get("enums"),
        queryMap.get("traits"),
        queryMap.get("modules"),
      ].filter((q): q is Query => q !== undefined);

      for (const query of classQueries) {
        try {
          const captures = this.executeQuery(tree, query, [
            "class_name",
            "interface_name",
            "type_name",
            "struct_name",
            "enum_name",
            "trait_name",
            "module_name",
          ]);
          metadata.classes.push(...captures);
        } catch {
          // Query execution failed, skip this query
        }
      }

      // Extract functions/methods
      const functionQueries = [
        queryMap.get("functions"),
        queryMap.get("methods"),
      ].filter((q): q is Query => q !== undefined);

      for (const query of functionQueries) {
        try {
          const captures = this.executeQuery(tree, query, [
            "func_name",
            "method_name",
          ]);
          metadata.functions.push(...captures);
        } catch {
          // Query execution failed, skip this query
        }
      }

      // Extract imports/uses/requires
      const importQueries = [
        queryMap.get("imports"),
        queryMap.get("usings"),
        queryMap.get("uses"),
        queryMap.get("requires"),
      ].filter((q): q is Query => q !== undefined);

      for (const query of importQueries) {
        try {
          const captures = this.executeQuery(tree, query, [
            "import_path",
            "using_path",
            "use_path",
            "require_path",
          ]);
          // Extract base package/module name (first segment)
          const baseImports = captures.map((imp) => {
            // Handle different import formats
            if (imp.includes(".")) {
              return imp.split(".")[0];
            }
            if (imp.includes("::")) {
              return imp.split("::")[0];
            }
            if (imp.includes("/")) {
              return imp.split("/")[0];
            }
            if (imp.includes("\\")) {
              return imp.split("\\")[0];
            }
            return imp;
          });
          metadata.imports.push(...baseImports);
        } catch {
          // Query execution failed, skip this query
        }
      }

      // Remove duplicates
      metadata.classes = [...new Set(metadata.classes)];
      metadata.functions = [...new Set(metadata.functions)];
      metadata.imports = [...new Set(metadata.imports)];

      return metadata;
    } catch {
      // Any parsing error - return minimal metadata
      return {
        filePath,
        language: langType,
        classes: [],
        functions: [],
        imports: [],
        exports: [],
        estimatedTokens: countTokensLocally(content),
      };
    } finally {
      // Always clean up tree to prevent memory leaks
      if (tree) {
        try {
          tree.delete();
        } catch {
          // Tree cleanup failed, ignore
        }
      }
    }
  }

  /**
   * Executes a query and extracts capture values.
   *
   * @param tree - Parsed AST tree
   * @param query - Compiled query
   * @param captureNames - Names of captures to extract
   * @returns Array of captured string values
   */
  private executeQuery(
    tree: Tree,
    query: Query,
    captureNames: string[],
  ): string[] {
    const results: string[] = [];
    const captures = query.captures(tree.rootNode);

    for (const capture of captures) {
      if (captureNames.includes(capture.name)) {
        const text = capture.node.text.trim();
        if (text) {
          results.push(text);
        }
      }
    }

    return results;
  }
}


