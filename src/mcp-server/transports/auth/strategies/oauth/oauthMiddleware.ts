/**
 * This module was removed as part of SPEC-AUTH-REMOVE-001.
 *
 * The MCP server no longer ships built-in OAuth/OIDC middleware and does not
 * inspect Authorization headers for its own access control.
 *
 * Any previous imports of `oauthMiddleware` from this path must be removed.
 * To protect HTTP access to this MCP server, use external mechanisms:
 * - Reverse proxy with OIDC/JWT validation
 * - mTLS
 * - IP allowlists or network segmentation
 * - Other dedicated API gateway / security components
 */
export {};