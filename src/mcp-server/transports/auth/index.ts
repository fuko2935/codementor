/**
 * Backward-compatible auth shim.
 *
 * Internal authentication and scope enforcement have been removed as part of
 * SPEC-AUTH-REMOVE-001. The only remaining export is `withRequiredScopes`,
 * implemented as a no-op helper for existing integrations.
 */
export { withRequiredScopes } from "./core/authUtils.js";