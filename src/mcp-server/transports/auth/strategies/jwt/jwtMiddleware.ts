/**
 * This module was removed as part of SPEC-AUTH-REMOVE-001.
 *
 * The MCP server no longer ships built-in JWT or OAuth middleware and does not
 * inspect Authorization headers for its own access control.
 *
 * Any previous imports of jwtMiddleware/mcpAuthMiddleware from this path must
 * be removed. If you require authentication for HTTP access to this MCP server,
 * enforce it via external infrastructure:
 * - Reverse proxy with JWT/OIDC validation
 * - mTLS
 * - IP allowlists or network segmentation
 * - Other dedicated API gateway / security components
 */
export {};