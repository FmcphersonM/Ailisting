import type { Request } from "express";

/**
 * Who is using the app right now.
 *
 * There are no logins yet, so everyone who knows the passcode is the same
 * single user. Every table already stores a user_id, so adding real accounts
 * later means changing only this function (and adding a sign-in screen).
 */
export const DEFAULT_USER_ID = 1;

export function currentUserId(_req: Request): number {
  return DEFAULT_USER_ID;
}
