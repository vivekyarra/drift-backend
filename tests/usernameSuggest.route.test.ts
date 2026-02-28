import { describe, expect, it } from "vitest";
import { handleUsernameSuggest } from "../src/routes/usernameSuggest";
import type { AppContext } from "../src/types";

function makeContext(existingUsernames: string[]): AppContext {
  const request = new Request("https://api.test.local/username/suggest?base=voidvaultuser", {
    method: "GET",
  });

  const supabaseMock = {
    from: () => ({
      select: () => ({
        ilike: () => ({
          limit: async () => ({
            data: existingUsernames.map((username) => ({ username })),
            error: null,
          }),
        }),
      }),
    }),
  };

  return {
    request,
    env: {},
    executionCtx: {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as ExecutionContext,
    requestId: "test-request-id",
    config: {
      supabaseUrl: "https://supabase.example",
      supabaseServiceRoleKey: "service_key",
      frontendOrigin: "https://frontend.example",
      cloudinaryCloudName: "demo",
      cloudinaryApiKey: null,
      cloudinaryApiSecret: null,
      adminApiKey: null,
    },
    supabase: supabaseMock as unknown as AppContext["supabase"],
    session: null,
  };
}

describe("GET /username/suggest route", () => {
  it("returns next available username", async () => {
    const response = await handleUsernameSuggest(
      makeContext(["voidvaultuser", "voidvaultuser1", "voidvaultuser3"]),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { username: string };
    expect(payload.username).toBe("voidvaultuser4");
  });
});
