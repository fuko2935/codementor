---
inclusion: always
---

# Product Overview

Gemini MCP Local is a lightweight Model Context Protocol (MCP) server for local-first AI-powered codebase analysis. It runs directly on your machine or via `npx`, exposing rich analysis workflows without external dependencies like Supabase or DuckDB.

## Core Capabilities

- **Codebase Analysis**: Comprehensive project analysis with AI-powered insights, code search, and pattern detection
- **Code Review**: Git diff integration for reviewing uncommitted changes, specific commits, or commit ranges
- **Project Orchestration**: Intelligent grouping for large codebases that exceed token limits
- **Token Management**: Accurate token counting for Gemini models to plan safe response sizes
- **Multi-Transport**: Supports both STDIO (for IDE/desktop clients) and HTTP (for web/remote access)

## Target Users

- Developers using AI assistants (Claude Desktop, Cursor, etc.)
- Teams needing local-first code analysis without cloud dependencies
- Projects requiring secure, on-premise AI tooling

## Key Differentiators

- **Local-first**: No external services required; bring your own API keys
- **Flexible Authentication**: OAuth via Gemini CLI (default) or API key-based
- **Transport Agnostic**: Works with STDIO for local clients or HTTP for remote access
- **Security Focused**: Path traversal protection, input sanitization, rate limiting
