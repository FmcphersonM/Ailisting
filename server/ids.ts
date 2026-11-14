import crypto from "node:crypto";

/** Short random id that is safe to put in a URL. */
export function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}
