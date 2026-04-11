import { Router } from "express";
import { authLoginSchema } from "@shared/types";
import { clearAuthCookie, isAuthenticated, setAuthCookie } from "../auth";
import { sendError, sendSuccess } from "../utils/http";
import { env } from "../env";

export const authRouter = Router();

authRouter.post("/login", (request, response) => {
  const parsed = authLoginSchema.safeParse(request.body);

  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "登录参数无效", 400);
    return;
  }

  if (parsed.data.password !== env.APP_PASSWORD) {
    sendError(response, "INVALID_CREDENTIALS", "密码错误", 401);
    return;
  }

  setAuthCookie(response);
  sendSuccess(response, { authenticated: true });
});

authRouter.post("/logout", (_request, response) => {
  clearAuthCookie(response);
  sendSuccess(response, { authenticated: false });
});

authRouter.get("/me", (request, response) => {
  sendSuccess(response, { authenticated: isAuthenticated(request) });
});
