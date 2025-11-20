/**
 * Circular-reference safe sanitization helper
 * This is a patch to be integrated into the main sanitization.ts
 */

/**
 * Sanitizes an object for logging by redacting sensitive fields.
 * Handles circular references gracefully without losing all context.
 *
 * @param input - The input data to sanitize for logging.
 * @param sensitiveFields - Array of sensitive field names to redact
 * @returns A sanitized (deep cloned) version of the input, safe for logging.
 */
export function sanitizeForLoggingCircularSafe(
  input: unknown,
  sensitiveFields: string[]
): unknown {
  if (!input || typeof input !== "object") return input;

  // Use WeakSet to track visited objects and handle circular references
  const seen = new WeakSet<object>();

  const cloneAndRedact = (obj: unknown): unknown => {
    // Handle primitives and null
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    // Handle circular references
    if (seen.has(obj as object)) {
      return "[Circular Reference]";
    }

    seen.add(obj as object);

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => cloneAndRedact(item));
    }

    // Handle Date objects
    if (obj instanceof Date) {
      return obj.toISOString();
    }

    // Handle Error objects
    if (obj instanceof Error) {
      return {
        name: obj.name,
        message: obj.message,
        stack: obj.stack,
      };
    }

    // Handle plain objects
    const result: Record<string, unknown> = {};
    
    try {
      for (const [key, value] of Object.entries(obj)) {
        // Check if key is sensitive
        if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = cloneAndRedact(value);
        }
      }
    } catch (error) {
      // If iteration fails, return a safe representation
      return "[Object: Unable to iterate properties]";
    }

    return result;
  };

  try {
    return cloneAndRedact(input);
  } catch (error) {
    return "[Log Sanitization Failed: Unexpected error]";
  }
}
