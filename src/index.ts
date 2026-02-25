import { enforceRateLimit } from "./middleware/rateLimit";
import {
  handleGetConversationMessages,
  handleSendConversationMessage,
  handleStartChat,
} from "./routes/chat";
import { handleFeed } from "./routes/feed";
import { handleFollow, handleUnfollow } from "./routes/follow";
import { handleMe } from "./routes/me";
import { handleCreatePost } from "./routes/post";
import { handleRegister } from "./routes/register";
import type { AppContext, Env } from "./types";
import { getConfig } from "./utils/config";
import { createSupabaseClient } from "./utils/db";
import { HttpError, isHttpError } from "./utils/errors";
import { jsonResponse } from "./utils/http";

type RouteHandler = (ctx: AppContext) => Promise<Response>;

const ROUTES = new Map<string, RouteHandler>([
  ["POST /register", handleRegister],
  ["POST /post", handleCreatePost],
  ["GET /feed", handleFeed],
  ["GET /me", handleMe],
  ["POST /follow", handleFollow],
  ["DELETE /follow", handleUnfollow],
  ["POST /chat/start", handleStartChat],
]);

function matchChatPath(path: string): {
  conversationId: string;
  routeType: "messages" | "message";
} | null {
  const match = path.match(
    /^\/chat\/([0-9a-fA-F-]{36})\/(messages|message)$/,
  );
  if (!match) {
    return null;
  }

  return {
    conversationId: match[1],
    routeType: match[2] as "messages" | "message",
  };
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function handleError(error: unknown): Response {
  if (isHttpError(error)) {
    const responseBody: Record<string, string> = {
      error: error.expose ? error.message : "Internal server error",
    };

    if (error.code) {
      responseBody.code = error.code;
    }

    return jsonResponse(responseBody, error.status);
  }

  if (error instanceof Error) {
    console.error("Unhandled error:", error.message);
  } else {
    console.error("Unhandled error:", error);
  }
  return jsonResponse({ error: "Internal server error" }, 500);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    executionCtx: ExecutionContext,
  ): Promise<Response> {
    try {
      const rateLimitResponse = enforceRateLimit(request);
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const config = getConfig(env);
      const supabase = createSupabaseClient(config);
      const context: AppContext = {
        request,
        env,
        executionCtx,
        config,
        supabase,
        session: null,
      };

      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const routeKey = `${request.method.toUpperCase()} ${path}`;

      if (request.method.toUpperCase() === "GET" && path === "/") {
        return jsonResponse({ status: "ok" }, 200);
      }

      const handler = ROUTES.get(routeKey);
      if (!handler) {
        const chatMatch = matchChatPath(path);
        if (!chatMatch) {
          throw new HttpError(404, "Not Found");
        }

        if (request.method.toUpperCase() === "GET" && chatMatch.routeType === "messages") {
          return await handleGetConversationMessages(context, chatMatch.conversationId);
        }

        if (request.method.toUpperCase() === "POST" && chatMatch.routeType === "message") {
          return await handleSendConversationMessage(context, chatMatch.conversationId);
        }

        throw new HttpError(404, "Not Found");
      }

      return await handler(context);
    } catch (error) {
      return handleError(error);
    }
  },
};
