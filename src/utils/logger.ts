import type { AppContext } from "../types";

type LogLevel = "info" | "warn" | "error";

interface LogEvent {
  level: LogLevel;
  event: string;
  request_id?: string;
  method?: string;
  path?: string;
  user_id?: string;
  code?: string;
  status?: number;
  duration_ms?: number;
  message?: string;
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 300);
}

function emitLog(payload: LogEvent): void {
  const record = {
    ts: new Date().toISOString(),
    ...payload,
  };
  const serialized = JSON.stringify(record);
  if (payload.level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function logRequestCompleted(
  ctx: AppContext,
  status: number,
  durationMs: number,
): void {
  emitLog({
    level: "info",
    event: "http.request.completed",
    request_id: ctx.requestId,
    method: ctx.request.method,
    path: new URL(ctx.request.url).pathname,
    user_id: ctx.session?.userId,
    status,
    duration_ms: durationMs,
  });
}

export function logInternalError(params: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  code?: string;
  message?: string;
}): void {
  emitLog({
    level: "error",
    event: "http.request.error",
    request_id: params.requestId,
    method: params.method,
    path: params.path,
    status: params.status,
    code: safeString(params.code),
    message: safeString(params.message),
  });
}

export function logAsyncWarning(
  ctx: AppContext,
  event: string,
  message: string,
): void {
  emitLog({
    level: "warn",
    event,
    request_id: ctx.requestId,
    method: ctx.request.method,
    path: new URL(ctx.request.url).pathname,
    user_id: ctx.session?.userId,
    message: safeString(message),
  });
}
