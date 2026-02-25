import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizeContent, sanitizeUuid } from "../utils/sanitize";

const MAX_MESSAGE_LENGTH = 2_000;
const textEncoder = new TextEncoder();

interface StartChatRequestBody {
  user_id?: unknown;
}

interface SendMessageRequestBody {
  content?: unknown;
}

function formatUuidFromBytes(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

async function derivePairConversationId(
  firstUserId: string,
  secondUserId: string,
): Promise<string> {
  const [a, b] = [firstUserId, secondUserId].sort();
  const seed = `drift:conversation:${a}:${b}`;
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(seed));
  const bytes = new Uint8Array(digest).slice(0, 16);

  // RFC4122 compatible bit layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuidFromBytes(bytes);
}

async function assertConversationMember(
  ctx: AppContext,
  conversationId: string,
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", ctx.session!.userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to validate conversation membership", {
      expose: false,
    });
  }

  if (!data) {
    throw new HttpError(403, "Forbidden");
  }
}

async function assertTargetUserExists(ctx: AppContext, targetUserId: string) {
  const { data, error } = await ctx.supabase
    .from("users")
    .select("id")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to validate target user", { expose: false });
  }

  if (!data) {
    throw new HttpError(404, "Target user not found");
  }
}

export async function handleStartChat(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const body = await parseJsonBody<StartChatRequestBody>(ctx.request);
  const targetUserId = sanitizeUuid(body.user_id);
  if (!targetUserId) {
    throw new HttpError(400, "user_id must be a valid UUID");
  }

  if (targetUserId === ctx.session!.userId) {
    throw new HttpError(400, "Cannot start chat with yourself");
  }

  await assertTargetUserExists(ctx, targetUserId);

  const conversationId = await derivePairConversationId(
    ctx.session!.userId,
    targetUserId,
  );

  const { error: conversationError } = await ctx.supabase
    .from("conversations")
    .upsert(
      {
        id: conversationId,
      },
      {
        onConflict: "id",
        ignoreDuplicates: true,
      },
    );

  if (conversationError) {
    throw new HttpError(500, "Failed to create conversation", { expose: false });
  }

  const { error: membersError } = await ctx.supabase
    .from("conversation_members")
    .upsert(
      [
        {
          conversation_id: conversationId,
          user_id: ctx.session!.userId,
        },
        {
          conversation_id: conversationId,
          user_id: targetUserId,
        },
      ],
      {
        onConflict: "conversation_id,user_id",
        ignoreDuplicates: true,
      },
    );

  if (membersError) {
    throw new HttpError(500, "Failed to add conversation members", {
      expose: false,
    });
  }

  return jsonResponse({
    conversation_id: conversationId,
  });
}

export async function handleGetConversationMessages(
  ctx: AppContext,
  rawConversationId: string,
): Promise<Response> {
  await requireSession(ctx);

  const conversationId = sanitizeUuid(rawConversationId);
  if (!conversationId) {
    throw new HttpError(400, "conversation_id must be a valid UUID");
  }

  await assertConversationMember(ctx, conversationId);

  const { data: messages, error } = await ctx.supabase
    .from("messages")
    .select("id,conversation_id,sender_id,content,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    throw new HttpError(500, "Failed to fetch messages", { expose: false });
  }

  return jsonResponse({
    messages: messages ?? [],
  });
}

export async function handleSendConversationMessage(
  ctx: AppContext,
  rawConversationId: string,
): Promise<Response> {
  await requireSession(ctx);

  const conversationId = sanitizeUuid(rawConversationId);
  if (!conversationId) {
    throw new HttpError(400, "conversation_id must be a valid UUID");
  }

  await assertConversationMember(ctx, conversationId);

  const body = await parseJsonBody<SendMessageRequestBody>(ctx.request);
  const content = sanitizeContent(body.content, MAX_MESSAGE_LENGTH);
  if (!content) {
    throw new HttpError(
      400,
      `content must be between 1 and ${MAX_MESSAGE_LENGTH} characters`,
    );
  }

  const { data: message, error } = await ctx.supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: ctx.session!.userId,
      content,
    })
    .select("id,conversation_id,sender_id,content,created_at")
    .single();

  if (error) {
    throw new HttpError(500, "Failed to send message", { expose: false });
  }

  return jsonResponse(
    {
      message,
    },
    201,
  );
}
