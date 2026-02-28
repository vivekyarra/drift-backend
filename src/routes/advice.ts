import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import {
  jsonResponse,
  parseIsoTimestampParam,
  parsePositiveIntParam,
  parseJsonBody,
} from "../utils/http";
import { createNotification } from "../utils/notifications";
import { sanitizeContent, sanitizeUuid } from "../utils/sanitize";

interface AdviceBody {
  content?: unknown;
}

interface AdviceReplyRow {
  id: string;
  advice_id: string;
  user_id: string;
  content: string;
  created_at: string;
  hidden: boolean;
}

function isMissingAdviceTable(errorCode: string | undefined): boolean {
  return (
    errorCode === "42P01" ||
    errorCode === "42703" ||
    errorCode === "PGRST205" ||
    errorCode === "PGRST204"
  );
}

export async function handleCreateAdvice(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "advice.create",
    limit: 12,
    windowMs: 60_000,
    minIntervalMs: 1_000,
    errorCode: "ADVICE_SPAM",
  });

  const body = await parseJsonBody<AdviceBody>(ctx.request);
  const content = sanitizeContent(body.content, 800);
  if (!content) {
    throw new HttpError(400, "Advice request must be 1-800 characters");
  }

  const insert = await ctx.supabase
    .from("advice_posts")
    .insert({
      user_id: ctx.session!.userId,
      content,
      hidden: ctx.session!.isShadowBanned,
    })
    .select("id,user_id,content,created_at")
    .single();

  if (insert.error) {
    if (isMissingAdviceTable(insert.error.code)) {
      throw new HttpError(503, "Advice feature is not available yet");
    }
    throw new HttpError(500, "Failed to create advice request", { expose: false });
  }

  return jsonResponse(
    {
      advice: insert.data,
    },
    201,
  );
}

export async function handleListAdvice(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const url = new URL(ctx.request.url);
  const mode = url.searchParams.get("mode") === "give" ? "give" : "need";
  const cursor = parseIsoTimestampParam(url.searchParams.get("cursor"), "Invalid cursor");
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), {
    min: 1,
    max: 50,
    fallback: 20,
    invalidMessage: "limit must be between 1 and 50",
  });

  let query = ctx.supabase
    .from("advice_posts")
    .select("id,user_id,content,created_at,hidden,report_count")
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const postsResult = await query;
  if (postsResult.error) {
    if (isMissingAdviceTable(postsResult.error.code)) {
      return jsonResponse({
        mode,
        advice: [],
        nextCursor: null,
      });
    }
    throw new HttpError(500, "Failed to fetch advice posts", { expose: false });
  }

  const posts = postsResult.data ?? [];
  const adviceIds = posts.map((post) => post.id);
  const repliesResult =
    adviceIds.length === 0
      ? ({ data: [], error: null } as const)
      : await ctx.supabase
          .from("advice_replies")
          .select("id,advice_id,user_id,content,created_at,hidden")
          .in("advice_id", adviceIds)
          .eq("hidden", false)
          .order("created_at", { ascending: true });

  if (repliesResult.error) {
    if (isMissingAdviceTable(repliesResult.error.code)) {
      return jsonResponse({
        mode,
        advice: [],
        nextCursor: null,
      });
    }
    throw new HttpError(500, "Failed to fetch advice replies", { expose: false });
  }

  const replies: AdviceReplyRow[] = repliesResult.data ? [...repliesResult.data] : [];
  const replyMap = new Map<string, AdviceReplyRow[]>();
  for (const reply of replies) {
    const list = replyMap.get(reply.advice_id) ?? [];
    list.push(reply);
    replyMap.set(reply.advice_id, list);
  }

  const filteredPosts = mode === "give"
    ? posts.filter((post) => (replyMap.get(post.id)?.length ?? 0) < 8)
    : posts;

  const nextCursor =
    filteredPosts.length > 0 ? filteredPosts[filteredPosts.length - 1].created_at : null;

  return jsonResponse({
    mode,
    advice: filteredPosts.map((post) => {
      const postReplies = replyMap.get(post.id) ?? [];
      return {
        ...post,
        is_anonymous: true,
        reply_count: postReplies.length,
        recent_replies:
          mode === "give"
            ? postReplies.slice(-3).map((reply) => ({
                id: reply.id,
                content: reply.content,
                created_at: reply.created_at,
              }))
            : [],
      };
    }),
    nextCursor,
  });
}

export async function handleGetAdviceReplies(
  ctx: AppContext,
  rawAdviceId: string,
): Promise<Response> {
  await requireSession(ctx);

  const adviceId = sanitizeUuid(rawAdviceId);
  if (!adviceId) {
    throw new HttpError(400, "Invalid advice id");
  }

  const repliesResult = await ctx.supabase
    .from("advice_replies")
    .select("id,advice_id,user_id,content,created_at")
    .eq("advice_id", adviceId)
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .limit(200);

  if (repliesResult.error) {
    if (isMissingAdviceTable(repliesResult.error.code)) {
      return jsonResponse({ replies: [] });
    }
    throw new HttpError(500, "Failed to fetch advice replies", { expose: false });
  }

  const replies = repliesResult.data ?? [];
  const userIds = [...new Set(replies.map((reply) => reply.user_id))];
  let userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const usersResult = await ctx.supabase
      .from("users")
      .select("id,username")
      .in("id", userIds);
    if (usersResult.error) {
      throw new HttpError(500, "Failed to resolve advice users", { expose: false });
    }
    userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user.username]));
  }

  return jsonResponse({
    replies: replies.map((reply) => ({
      ...reply,
      username: userMap.get(reply.user_id) ?? "anonymous",
    })),
  });
}

export async function handleCreateAdviceReply(
  ctx: AppContext,
  rawAdviceId: string,
): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "advice.reply",
    limit: 30,
    windowMs: 60_000,
    minIntervalMs: 250,
    errorCode: "ADVICE_REPLY_SPAM",
  });

  const adviceId = sanitizeUuid(rawAdviceId);
  if (!adviceId) {
    throw new HttpError(400, "Invalid advice id");
  }

  const body = await parseJsonBody<AdviceBody>(ctx.request);
  const content = sanitizeContent(body.content, 800);
  if (!content) {
    throw new HttpError(400, "Advice reply must be 1-800 characters");
  }

  const adviceResult = await ctx.supabase
    .from("advice_posts")
    .select("id,user_id")
    .eq("id", adviceId)
    .eq("hidden", false)
    .maybeSingle();

  if (adviceResult.error) {
    if (isMissingAdviceTable(adviceResult.error.code)) {
      throw new HttpError(503, "Advice feature is not available yet");
    }
    throw new HttpError(500, "Failed to load advice request", { expose: false });
  }

  if (!adviceResult.data) {
    throw new HttpError(404, "Advice request not found");
  }

  const replyInsert = await ctx.supabase
    .from("advice_replies")
    .insert({
      advice_id: adviceId,
      user_id: ctx.session!.userId,
      content,
      hidden: ctx.session!.isShadowBanned,
    })
    .select("id,advice_id,user_id,content,created_at")
    .single();

  if (replyInsert.error) {
    if (isMissingAdviceTable(replyInsert.error.code)) {
      throw new HttpError(503, "Advice feature is not available yet");
    }
    throw new HttpError(500, "Failed to submit advice reply", { expose: false });
  }

  await createNotification(ctx, {
    recipientId: adviceResult.data.user_id,
    actorId: ctx.session!.userId,
    type: "advice_reply",
    title: "Advice reply",
    body: `@${ctx.session!.username} replied to your advice request`,
    entityType: "advice",
    entityId: adviceId,
  });

  return jsonResponse(
    {
      reply: replyInsert.data,
    },
    201,
  );
}
