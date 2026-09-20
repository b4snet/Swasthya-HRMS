/**
 * Stable application errors for the Notifications context (Slice 1.0;
 * ADR-011). Same contract as Credentials/Contracts/Documents/Workforce:
 * clients receive ONLY { code, message, field? }; DB internals never cross.
 */
export type NotificationsAppErrorCode =
  "VALIDATION_FAILED" | "AUTHORIZATION_DENIED" | "NOT_FOUND" | "UNEXPECTED";

export const NOTIFICATIONS_ERROR_STATUS: Record<NotificationsAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  UNEXPECTED: 500,
};

export class NotificationsAppError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: NotificationsAppErrorCode,
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "NotificationsAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

export function serializeNotificationsAppError(err: NotificationsAppError): {
  ok: false;
  error: { code: NotificationsAppErrorCode; message: string; field?: string };
} {
  return {
    ok: false,
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  };
}
