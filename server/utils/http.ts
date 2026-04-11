import type { Response } from "express";
import type { ApiFailure, ApiSuccess } from "@shared/types";

export function sendSuccess<T>(response: Response, data: T, status: number = 200): void {
  const payload: ApiSuccess<T> = {
    ok: true,
    data,
  };

  response.status(status).json(payload);
}

export function sendError(response: Response, code: string, message: string, status: number): void {
  const payload: ApiFailure = {
    ok: false,
    error: {
      code,
      message,
    },
  };

  response.status(status).json(payload);
}
