import type { Request, Response, NextFunction } from "express";
import { parse, serialize } from "cookie";
import { env } from "./env";
import { encodeSignedValue, verifySignedValue } from "./utils/session";

const SESSION_COOKIE_NAME = "doudian-review-session";
const SESSION_PAYLOAD = "authenticated";

export function setAuthCookie(response: Response): void {
  const token = encodeSignedValue(SESSION_PAYLOAD, env.SESSION_SECRET);
  response.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    }),
  );
}

export function clearAuthCookie(response: Response): void {
  response.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      expires: new Date(0),
    }),
  );
}

export function isAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return false;
  }

  const cookies = parse(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return false;
  }

  return verifySignedValue(token, env.SESSION_SECRET) === SESSION_PAYLOAD;
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!isAuthenticated(request)) {
    response.status(401).json({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "请先登录",
      },
    });
    return;
  }

  next();
}
