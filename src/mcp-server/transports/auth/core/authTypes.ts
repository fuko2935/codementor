/**
 * This module was removed as part of SPEC-AUTH-REMOVE-001.
 *
 * The MCP server no longer defines or exposes internal authentication types.
 * Any previous imports of AuthInfo/AuthStore from this path must be removed.
 *
 * Use external infrastructure and clear boundaries (e.g. reverse proxy,
 * identity provider) for any authentication or authorization semantics.
 */
export {};