import type { ApiResponse } from "@shared/types";

type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  query?: Record<string, QueryValue | readonly Exclude<QueryValue, null | undefined>[]>;
  skipAuthRedirect?: boolean;
  body?: BodyInit | Record<string, unknown> | null;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function getRequestErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return fallbackMessage;
}

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined || item === "") {
          continue;
        }

        searchParams.append(key, String(item));
      }
      continue;
    }

    if (value === null || value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString ? `/api${path}?${queryString}` : `/api${path}`;
}

function normalizeBody(body: ApiRequestOptions["body"]): BodyInit | null | undefined {
  if (body === undefined || body === null) {
    return body;
  }

  if (typeof body === "string" || body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) {
    return body;
  }

  return JSON.stringify(body);
}

function normalizeHeaders(body: ApiRequestOptions["body"], headers: HeadersInit | undefined): HeadersInit | undefined {
  if (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob
  ) {
    return headers;
  }

  return {
    "Content-Type": "application/json",
    ...headers,
  };
}

function maybeRedirectToLogin(status: number, skipAuthRedirect: boolean | undefined): void {
  if (status !== 401 || skipAuthRedirect || typeof window === "undefined") {
    return;
  }

  window.location.replace("/login");
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, headers, query, skipAuthRedirect, ...init } = options;
  const response = await fetch(buildUrl(path, query), {
    ...init,
    body: normalizeBody(body),
    credentials: "include",
    headers: normalizeHeaders(body, headers),
  });

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload?.ok) {
    const code = payload && !payload.ok ? payload.error.code : "REQUEST_FAILED";
    const message = payload && !payload.ok ? payload.error.message : "请求失败，请稍后重试";
    maybeRedirectToLogin(response.status, skipAuthRedirect);
    throw new ApiRequestError(response.status, code, message);
  }

  return payload.data;
}

export function apiGet<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiRequest<T>(path, {
    ...options,
    method: "GET",
  });
}

export function apiPost<TResponse, TBody extends Record<string, unknown> | FormData>(
  path: string,
  body: TBody,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    ...options,
    method: "POST",
    body,
  });
}

export function apiPatch<TResponse, TBody extends Record<string, unknown>>(
  path: string,
  body: TBody,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function apiDelete<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiRequest<T>(path, {
    ...options,
    method: "DELETE",
  });
}
