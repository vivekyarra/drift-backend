import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

export async function handleChatList(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const { data: memberships, error: membershipsError } = await ctx.supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", ctx.session!.userId);

  if (membershipsError) {
    throw new HttpError(500, "Failed to fetch conversations", { expose: false });
  }

  const conversationIds = [...new Set((memberships ?? []).map((row) => row.conversation_id))];
  if (conversationIds.length === 0) {
    return jsonResponse({
      conversations: [],
    });
  }

  const [conversationsResult, membersResult, messagesResult] = await Promise.all([
    ctx.supabase
      .from("conversations")
      .select("id,created_at")
      .in("id", conversationIds),
    ctx.supabase
      .from("conversation_members")
      .select("conversation_id,user_id")
      .in("conversation_id", conversationIds),
    ctx.supabase
      .from("messages")
      .select("id,conversation_id,sender_id,content,created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  if (conversationsResult.error || membersResult.error || messagesResult.error) {
    throw new HttpError(500, "Failed to fetch conversations", { expose: false });
  }

  const conversations = conversationsResult.data ?? [];
  const members = membersResult.data ?? [];
  const messages = messagesResult.data ?? [];

  const lastMessageMap = new Map<
    string,
    {
      id: string;
      sender_id: string;
      content: string;
      created_at: string;
    }
  >();

  for (const message of messages) {
    if (!lastMessageMap.has(message.conversation_id)) {
      lastMessageMap.set(message.conversation_id, {
        id: message.id,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
      });
    }
  }

  const memberMap = new Map<string, string[]>();
  for (const member of members) {
    const existing = memberMap.get(member.conversation_id) ?? [];
    existing.push(member.user_id);
    memberMap.set(member.conversation_id, existing);
  }

  const userIds = [
    ...new Set(
      members
        .map((member) => member.user_id)
        .concat(messages.map((message) => message.sender_id)),
    ),
  ];

  let userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await ctx.supabase
      .from("users")
      .select("id,username")
      .in("id", userIds);

    if (usersError) {
      throw new HttpError(500, "Failed to resolve conversation users", {
        expose: false,
      });
    }

    userMap = new Map((users ?? []).map((user) => [user.id, user.username]));
  }

  const list = conversations
    .map((conversation) => {
      const conversationMembers = memberMap.get(conversation.id) ?? [];
      const otherUserId =
        conversationMembers.find((memberId) => memberId !== ctx.session!.userId) ?? null;
      const lastMessage = lastMessageMap.get(conversation.id) ?? null;
      const updatedAt = lastMessage?.created_at ?? conversation.created_at;

      return {
        conversation_id: conversation.id,
        updated_at: updatedAt,
        other_user: otherUserId
          ? {
              id: otherUserId,
              username: userMap.get(otherUserId) ?? "unknown",
            }
          : null,
        last_message: lastMessage
          ? {
              id: lastMessage.id,
              sender_id: lastMessage.sender_id,
              sender_username: userMap.get(lastMessage.sender_id) ?? "unknown",
              content: lastMessage.content,
              created_at: lastMessage.created_at,
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

  return jsonResponse({
    conversations: list,
  });
}
