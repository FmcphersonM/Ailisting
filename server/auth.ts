import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

/**
 * A single shared passcode keeps strangers who find the link from spending
 * your API credit. After the right passcode, the phone gets a signed cookie
 * that lasts a year, so you only type it once per device.
 */

const COOKIE = "selg_session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function signingKey(): Buffer {
  // Changing the passcode signs everyone out.
  return crypto.createHash("sha256").update(`selg:${config.sessionSecret}:${config.passcode}`).digest();
}

function sign(expires: number): string {
  return crypto.createHmac("sha256", signingKey()).update(String(expires)).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function tokenIsValid(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [expText, mac] = token.split(".");
  const expires = Number(expText);
  if (!mac || !Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(mac, sign(expires));
}

/** "open" = no passcode needed (local development only). */
export function accessMode(): "open" | "passcode" | "not_configured" {
  if (config.passcode) return "passcode";
  return config.isProduction ? "not_configured" : "open";
}

export function isSignedIn(req: Request): boolean {
  const mode = accessMode();
  if (mode === "open") return true;
  if (mode === "not_configured") return false;
  return tokenIsValid(req.cookies?.[COOKIE]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isSignedIn(req)) return next();
  if (accessMode() === "not_configured") {
    res.status(503).json({ error: "setup_required", message: "APP_PASSCODE is not set on the server yet." });
    return;
  }
  res.status(401).json({ error: "login_required", message: "Please enter the passcode." });
}

// Slow down passcode guessing: 8 wrong tries per 15 minutes per address.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function login(req: Request, res: Response): void {
  if (accessMode() !== "passcode") {
    res.json({ ok: true });
    return;
  }
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    res.status(429).json({ error: "too_many_attempts", message: "Too many tries. Wait 15 minutes and try again." });
    return;
  }
  const given = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  if (!given || !safeEqual(given, config.passcode)) {
    const fresh = !entry || entry.resetAt <= now;
    attempts.set(key, { count: fresh ? 1 : entry.count + 1, resetAt: fresh ? now + WINDOW_MS : entry.resetAt });
    res.status(401).json({ error: "wrong_passcode", message: "That passcode is not right." });
    return;
  }
  attempts.delete(key);
  const expires = now + ONE_YEAR_MS;
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: ONE_YEAR_MS,
    path: "/",
  });
  res.json({ ok: true });
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}
