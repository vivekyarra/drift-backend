import { describe, expect, it } from "vitest";
import { ensureCsrf } from "../src/middleware/csrf";

const ALLOWED_ORIGIN = "https://voidvault.pages.dev";

function makeRequest(params: {
  method: string;
  cookie?: string;
  csrf?: string;
  origin?: string;
}): Request {
  const headers = new Headers();
  if (params.cookie) {
    headers.set("Cookie", params.cookie);
  }
  if (params.csrf) {
    headers.set("X-CSRF-Token", params.csrf);
  }
  if (params.origin) {
    headers.set("Origin", params.origin);
  }
  return new Request("https://api.test.local/post", {
    method: params.method,
    headers,
  });
}

describe("ensureCsrf", () => {
  it("allows safe methods without csrf token", () => {
    expect(() => ensureCsrf(makeRequest({ method: "GET" }), ALLOWED_ORIGIN)).not.toThrow();
  });

  it("allows unauthenticated mutating requests (no session cookie)", () => {
    expect(() => ensureCsrf(makeRequest({ method: "POST" }), ALLOWED_ORIGIN)).not.toThrow();
  });

  it("rejects when session cookie exists but origin is missing", () => {
    expect(() =>
      ensureCsrf(makeRequest({ method: "POST", cookie: "session=abc123" }), ALLOWED_ORIGIN),
    ).toThrow();
  });

  it("rejects when origin mismatches", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123",
          origin: "https://evil.example",
        }),
        ALLOWED_ORIGIN,
      ),
    ).toThrow();
  });

  it("accepts with valid origin even without csrf token", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123",
          origin: ALLOWED_ORIGIN,
        }),
        ALLOWED_ORIGIN,
      ),
    ).not.toThrow();
  });

  it("accepts with valid origin even when csrf cookie exists but header is missing", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123; csrf_token=token_cookie",
          origin: ALLOWED_ORIGIN,
        }),
        ALLOWED_ORIGIN,
      ),
    ).not.toThrow();
  });

  it("rejects when csrf cookie/header mismatch if tokens are provided", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123; csrf_token=token_a",
          csrf: "token_b",
          origin: ALLOWED_ORIGIN,
        }),
        ALLOWED_ORIGIN,
      ),
    ).toThrow();
  });

  it("rejects when csrf header is provided but csrf cookie is missing", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123",
          csrf: "token_only_header",
          origin: ALLOWED_ORIGIN,
        }),
        ALLOWED_ORIGIN,
      ),
    ).toThrow();
  });

  it("accepts when csrf cookie/header match if tokens are provided", () => {
    expect(() =>
      ensureCsrf(
        makeRequest({
          method: "POST",
          cookie: "session=abc123; csrf_token=token_ok",
          csrf: "token_ok",
          origin: ALLOWED_ORIGIN,
        }),
        ALLOWED_ORIGIN,
      ),
    ).not.toThrow();
  });
});
