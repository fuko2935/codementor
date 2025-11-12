/**
 * No-op authorization helper for backward compatibility.
 *
 * This module intentionally performs no security or scope validation.
 * It exists only to avoid breaking imports after removal of built-in auth.
 */

/**
 * No-op helper retained for backward compatibility with existing imports.
 * Does not enforce any scopes or perform runtime checks.
 */
export function withRequiredScopes(_requiredScopes: string[]): void {
  return;
}
