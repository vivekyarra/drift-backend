import { describe, expect, it } from "vitest";
import {
  sanitizeBio,
  sanitizeChannel,
  sanitizeContent,
  sanitizeImageUrl,
  sanitizeUsername,
} from "../src/utils/sanitize";

describe("sanitizeUsername", () => {
  it("normalizes and validates username", () => {
    expect(sanitizeUsername("  VoidUser_1 ")).toBe("voiduser_1");
    expect(sanitizeUsername("ab")).toBeNull();
    expect(sanitizeUsername("bad-name")).toBeNull();
  });
});

describe("sanitizeContent", () => {
  it("rejects empty and oversized content", () => {
    expect(sanitizeContent("   ")).toBeNull();
    expect(sanitizeContent("x".repeat(501))).toBeNull();
  });

  it("keeps valid content", () => {
    expect(sanitizeContent("hello world")).toBe("hello world");
  });
});

describe("sanitizeChannel", () => {
  it("normalizes simple channels", () => {
    expect(sanitizeChannel(" General ")).toBe("general");
    expect(sanitizeChannel("bad channel *")).toBeNull();
  });
});

describe("sanitizeBio", () => {
  it("allows null/empty and limits length", () => {
    expect(sanitizeBio(null)).toBeNull();
    expect(sanitizeBio("hello")).toBe("hello");
    expect(sanitizeBio("x".repeat(201))).toBeNull();
  });
});

describe("sanitizeImageUrl", () => {
  it("accepts valid cloudinary image urls", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg";
    expect(sanitizeImageUrl(url, "demo")).toBe(url);
  });

  it("rejects invalid domains/protocols/query", () => {
    expect(
      sanitizeImageUrl(
        "https://example.com/image.jpg",
        "demo",
      ),
    ).toBeNull();
    expect(
      sanitizeImageUrl(
        "http://res.cloudinary.com/demo/image/upload/sample.jpg",
        "demo",
      ),
    ).toBeNull();
    expect(
      sanitizeImageUrl(
        "https://res.cloudinary.com/demo/image/upload/sample.jpg?raw=1",
        "demo",
      ),
    ).toBeNull();
  });
});
