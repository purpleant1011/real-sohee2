/**
 * Persistence Error
 * Thrown when durable storage operations (Supabase DB, Cloudflare DO) fail.
 * Strict Fail-Closed policy: never fallback to random UUID or silent in-memory maps.
 */
export class PersistenceError extends Error {
  public readonly operation: string;
  public readonly causeError?: unknown;
  public readonly code?: string;

  constructor(operation: string, message: string, causeError?: unknown, code?: string) {
    super(`[PersistenceError] ${operation}: ${message}`);
    this.name = 'PersistenceError';
    this.operation = operation;
    this.causeError = causeError;
    this.code = code;
    Object.setPrototypeOf(this, PersistenceError.prototype);
  }
}
