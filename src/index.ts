import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withCorsHeaders,
} from "./middleware/cors";
import { ensureCsrf } from "./middleware/csrf";
import { enforceRateLimit } from "./middleware/rateLimit";
import { withSecurityHeaders } from "./middleware/securityHeaders";
import {
  handleAdminDeleteUser,
  handleAdminDeletePost,
  handleAdminHidePost,
  handleAdminModerateUser,
  handleAdminOverview,
  handleAdminPosts,
  handleAdminReports,
  handleAdminUserDetails,
  handleAdminUsers,
} from "./routes/admin";
import {
  handleChangePassword,
  handleDeactivateAccount,
  handleDeleteAccount,
  handleRotateRecoveryKey,
} from "./routes/account";
import {
  handleCreateAdvice,
  handleCreateAdviceReply,
  handleGetAdviceReplies,
  handleListAdvice,
} from "./routes/advice";
import {
  handleGetConversationMessages,
  handleSendConversationMessage,
  handleStartChat,
} from "./routes/chat";
import { handleChatList } from "./routes/chatList";
import { handleDeletePost } from "./routes/deletePost";
import { handleFeed } from "./routes/feed";
import { handleFollow, handleFollowData, handleUnfollow } from "./routes/follow";
import { handleLogin } from "./routes/login";
import { handleLogout } from "./routes/logout";
import { handleMe } from "./routes/me";
import { handleSignMediaUpload } from "./routes/media";
import { handleNotifications } from "./routes/notifications";
import { handleCreatePost } from "./routes/post";
import {
  handleClearPostReaction,
  handleCreatePostComment,
  handleGetPostById,
  handleGetPostComments,
  handleReactToPost,
  handleSavePost,
  handleUnsavePost,
} from "./routes/postInteractions";
import { handleProfile, handleUpdateProfile } from "./routes/profile";
import { handleReportContent } from "./routes/report";
import { handleRegister } from "./routes/register";
import { handleSearch } from "./routes/search";
import { handleUsernameSuggest } from "./routes/usernameSuggest";
import type { AppConfig, AppContext, Env } from "./types";
import { getConfig } from "./utils/config";
import { createSupabaseClient } from "./utils/db";
import { HttpError, isHttpError } from "./utils/errors";
import { jsonResponse } from "./utils/http";
import { logInternalError, logRequestCompleted } from "./utils/logger";

type RouteHandler = (ctx: AppContext) => Promise<Response>;

const ROUTES = new Map<string, RouteHandler>([
  ["GET /username/suggest", handleUsernameSuggest],
  ["POST /register", handleRegister],
  ["POST /login", handleLogin],
  ["POST /logout", handleLogout],
  ["POST /post", handleCreatePost],
  ["DELETE /post", handleDeletePost],
  ["GET /advice", handleListAdvice],
  ["POST /advice", handleCreateAdvice],
  ["POST /media/sign-upload", handleSignMediaUpload],
  ["POST /report", handleReportContent],
  ["GET /feed", handleFeed],
  ["GET /me", handleMe],
  ["GET /search", handleSearch],
  ["GET /notifications", handleNotifications],
  ["GET /profile", handleProfile],
  ["PATCH /profile", handleUpdateProfile],
  ["POST /account/recovery/rotate", handleRotateRecoveryKey],
  ["POST /account/password/change", handleChangePassword],
  ["POST /account/deactivate", handleDeactivateAccount],
  ["DELETE /account", handleDeleteAccount],
  ["GET /follow", handleFollowData],
  ["POST /follow", handleFollow],
  ["DELETE /follow", handleUnfollow],
  ["GET /chat/list", handleChatList],
  ["POST /chat/start", handleStartChat],
  ["POST /admin/user/moderation", handleAdminModerateUser],
  ["DELETE /admin/user", handleAdminDeleteUser],
  ["POST /admin/post/delete", handleAdminDeletePost],
  ["POST /admin/post/hide", handleAdminHidePost],
  ["GET /admin/overview", handleAdminOverview],
  ["GET /admin/users", handleAdminUsers],
  ["GET /admin/user-details", handleAdminUserDetails],
  ["GET /admin/posts", handleAdminPosts],
  ["GET /admin/reports", handleAdminReports],
]);

const REQUEST_TIMEOUT_MS = 9_000;

function matchChatPath(path: string): {
  conversationId: string;
  routeType: "messages" | "message";
} | null {
  const match = path.match(/^\/chat\/([0-9a-fA-F-]{36})\/(messages|message)$/);

  if (!match) return null;

  return {
    conversationId: match[1],
    routeType: match[2] as "messages" | "message",
  };
}

function matchPostPath(path: string): {
  postId: string;
  routeType: "post" | "reaction" | "save" | "comments";
} | null {
  const postMatch = path.match(/^\/post\/([0-9a-fA-F-]{36})$/);
  if (postMatch) {
    return {
      postId: postMatch[1],
      routeType: "post",
    };
  }

  const postActionMatch = path.match(
    /^\/post\/([0-9a-fA-F-]{36})\/(reaction|save|comments)$/,
  );
  if (!postActionMatch) {
    return null;
  }

  return {
    postId: postActionMatch[1],
    routeType: postActionMatch[2] as "reaction" | "save" | "comments",
  };
}

function matchAdvicePath(path: string): {
  adviceId: string;
  routeType: "replies";
} | null {
  const match = path.match(/^\/advice\/([0-9a-fA-F-]{36})\/(replies)$/);
  if (!match) {
    return null;
  }

  return {
    adviceId: match[1],
    routeType: "replies",
  };
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function shouldRateLimitRoute(method: string, path: string): boolean {
  if (method === "OPTIONS" || method === "GET" || method === "HEAD") {
    return false;
  }

  if (path.startsWith("/chat/")) {
    const chatMatch = matchChatPath(path);
    if (!chatMatch) {
      return true;
    }
    return chatMatch.routeType === "message";
  }

  return true;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new HttpError(504, "Request timeout", { code: "REQUEST_TIMEOUT" }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function handleError(params: {
  error: unknown;
  requestId: string;
  request: Request;
}): Response {
  const { error, requestId, request } = params;
  const url = new URL(request.url);

  if (isHttpError(error)) {
    const responseBody: Record<string, string> = {
      error: error.expose ? error.message : "Internal server error",
    };

    if (error.code) {
      responseBody.code = error.code;
    }

    if (error.status >= 500) {
      logInternalError({
        requestId,
        method: request.method,
        path: url.pathname,
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }

    return jsonResponse(responseBody, error.status);
  }

  const unhandledName = error instanceof Error ? error.name : "UnknownError";
  const unhandledMessage =
    error instanceof Error ? error.message : "Unknown non-Error exception";

  logInternalError({
    requestId,
    method: request.method,
    path: url.pathname,
    status: 500,
    code: "UNHANDLED_ERROR",
    message: `${unhandledName}: ${unhandledMessage}`,
  });
  return jsonResponse({ error: "Internal server error" }, 500);
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    executionCtx: ExecutionContext,
  ): Promise<Response> {
    const startTimeMs = Date.now();
    const requestId = crypto.randomUUID();
    let config: AppConfig | null = null;
    let context: AppContext | null = null;

    try {
      config = getConfig(env);

      const preflightResponse = handleCorsPreflight(request, config.frontendOrigin);
      if (preflightResponse) {
        const withId = withRequestId(preflightResponse, requestId);
        return withSecurityHeaders(withId);
      }

      const rejected = rejectDisallowedOrigin(request, config.frontendOrigin);
      if (rejected) {
        const withId = withRequestId(rejected, requestId);
        const withCors = withCorsHeaders(request, withId, config.frontendOrigin);
        return withSecurityHeaders(withCors);
      }

      const method = request.method.toUpperCase();
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);

      if (shouldRateLimitRoute(method, path)) {
        const rateLimitResponse = enforceRateLimit(request);
        if (rateLimitResponse) {
          const withId = withRequestId(rateLimitResponse, requestId);
          const withCors = withCorsHeaders(request, withId, config.frontendOrigin);
          return withSecurityHeaders(withCors);
        }
      }

      ensureCsrf(request, config.frontendOrigin);

      const supabase = createSupabaseClient(config);
      context = {
        request,
        env,
        executionCtx,
        requestId,
        config,
        supabase,
        session: null,
      };

      let response: Response;

      if (method === "GET" && path === "/") {
        response = jsonResponse({ status: "ok" }, 200);
      } else {
        const routeKey = `${method} ${path}`;
        const handler = ROUTES.get(routeKey);

        if (!handler) {
          const chatMatch = matchChatPath(path);
          const postMatch = matchPostPath(path);
          const adviceMatch = matchAdvicePath(path);

          if (!chatMatch && !postMatch && !adviceMatch) {
            throw new HttpError(404, "Not Found");
          }

          if (chatMatch && method === "GET" && chatMatch.routeType === "messages") {
            response = await withTimeout(
              handleGetConversationMessages(context, chatMatch.conversationId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (chatMatch && method === "POST" && chatMatch.routeType === "message") {
            response = await withTimeout(
              handleSendConversationMessage(context, chatMatch.conversationId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "GET" && postMatch.routeType === "post") {
            response = await withTimeout(
              handleGetPostById(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "POST" && postMatch.routeType === "reaction") {
            response = await withTimeout(
              handleReactToPost(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "DELETE" && postMatch.routeType === "reaction") {
            response = await withTimeout(
              handleClearPostReaction(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "POST" && postMatch.routeType === "save") {
            response = await withTimeout(
              handleSavePost(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "DELETE" && postMatch.routeType === "save") {
            response = await withTimeout(
              handleUnsavePost(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "GET" && postMatch.routeType === "comments") {
            response = await withTimeout(
              handleGetPostComments(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (postMatch && method === "POST" && postMatch.routeType === "comments") {
            response = await withTimeout(
              handleCreatePostComment(context, postMatch.postId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (adviceMatch && method === "GET" && adviceMatch.routeType === "replies") {
            response = await withTimeout(
              handleGetAdviceReplies(context, adviceMatch.adviceId),
              REQUEST_TIMEOUT_MS,
            );
          } else if (adviceMatch && method === "POST" && adviceMatch.routeType === "replies") {
            response = await withTimeout(
              handleCreateAdviceReply(context, adviceMatch.adviceId),
              REQUEST_TIMEOUT_MS,
            );
          } else {
            throw new HttpError(404, "Not Found");
          }
        } else {
          response = await withTimeout(handler(context), REQUEST_TIMEOUT_MS);
        }
      }

      const withId = withRequestId(response, requestId);
      const withCors = withCorsHeaders(request, withId, config.frontendOrigin);
      const secureResponse = withSecurityHeaders(withCors);

      logRequestCompleted(context, secureResponse.status, Date.now() - startTimeMs);
      return secureResponse;
    } catch (error) {
      const errorResponse = handleError({ error, requestId, request });
      const withId = withRequestId(errorResponse, requestId);

      if (!config) {
        return withSecurityHeaders(withId);
      }

      const withCors = withCorsHeaders(request, withId, config.frontendOrigin);
      const secureResponse = withSecurityHeaders(withCors);

      if (context) {
        logRequestCompleted(context, secureResponse.status, Date.now() - startTimeMs);
      }

      return secureResponse;
    }
  },
};
