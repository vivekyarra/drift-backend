import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

interface NotificationItem {
  id: string;
  type: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  title: string;
  body: string;
  entity_type?: string | null;
  entity_id?: string | null;
}

function isMissingRelation(errorCode: string | undefined): boolean {
  return (
    errorCode === "42P01" ||
    errorCode === "42703" ||
    errorCode === "PGRST205" ||
    errorCode === "PGRST204"
  );
}

function sortByDateDesc<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function handleNotifications(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const tableNotifications = await ctx.supabase
    .from("notifications")
    .select("id,type,created_at,actor_id,title,body,entity_type,entity_id")
    .eq("recipient_id", ctx.session!.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!tableNotifications.error) {
    const rows = tableNotifications.data ?? [];
    const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
    let actorMap = new Map<string, string>();

    if (actorIds.length > 0) {
      const actorQuery = await ctx.supabase
        .from("users")
        .select("id,username")
        .in("id", actorIds);

      if (actorQuery.error) {
        throw new HttpError(500, "Failed to resolve notification actors", {
          expose: false,
        });
      }
      actorMap = new Map((actorQuery.data ?? []).map((row) => [row.id, row.username]));
    }

    return jsonResponse({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        created_at: row.created_at,
        actor_id: row.actor_id,
        actor_username: row.actor_id ? actorMap.get(row.actor_id) ?? "unknown" : null,
        title: row.title,
        body: row.body,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
      })),
    });
  }

  if (!isMissingRelation(tableNotifications.error.code)) {
    throw new HttpError(500, "Failed to fetch notifications", { expose: false });
  }

  const [followersResult, membershipsResult, ownPostsResult] = await Promise.all([
    ctx.supabase
      .from("follows")
      .select("follower_id,created_at")
      .eq("following_id", ctx.session!.userId)
      .order("created_at", { ascending: false })
      .limit(25),
    ctx.supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", ctx.session!.userId),
    ctx.supabase
      .from("posts")
      .select("id")
      .eq("user_id", ctx.session!.userId)
      .limit(100),
  ]);

  const hasMissingLegacyTables =
    (followersResult.error && isMissingRelation(followersResult.error.code)) ||
    (membershipsResult.error && isMissingRelation(membershipsResult.error.code)) ||
    (ownPostsResult.error && isMissingRelation(ownPostsResult.error.code));

  if (hasMissingLegacyTables) {
    return jsonResponse({
      notifications: [],
    });
  }

  if (followersResult.error || membershipsResult.error || ownPostsResult.error) {
    throw new HttpError(500, "Failed to fetch notifications", { expose: false });
  }

  const followerRows = followersResult.data ?? [];
  const conversationIds = [...new Set((membershipsResult.data ?? []).map((row) => row.conversation_id))];
  const ownPostIds = (ownPostsResult.data ?? []).map((post) => post.id);

  const messagesPromise =
    conversationIds.length === 0
      ? Promise.resolve({ data: [], error: null } as const)
      : ctx.supabase
          .from("messages")
          .select("id,conversation_id,sender_id,content,created_at")
          .in("conversation_id", conversationIds)
          .neq("sender_id", ctx.session!.userId)
          .order("created_at", { ascending: false })
          .limit(25);

  const reportsPromise =
    ownPostIds.length === 0
      ? Promise.resolve({ data: [], error: null } as const)
      : ctx.supabase
          .from("reports")
          .select("id,content_id,reporter_id,created_at")
          .eq("content_type", "post")
          .in("content_id", ownPostIds)
          .order("created_at", { ascending: false })
          .limit(25);

  const [messagesResult, reportsResult] = await Promise.all([
    messagesPromise,
    reportsPromise,
  ]);

  const hasMissingFallbackTables =
    (messagesResult.error && isMissingRelation(messagesResult.error.code)) ||
    (reportsResult.error && isMissingRelation(reportsResult.error.code));

  if (hasMissingFallbackTables) {
    return jsonResponse({
      notifications: [],
    });
  }

  if (messagesResult.error || reportsResult.error) {
    throw new HttpError(500, "Failed to fetch notifications", { expose: false });
  }

  const messages = messagesResult.data ?? [];
  const reports = reportsResult.data ?? [];
  const actorIds = [
    ...new Set(
      [
        ...followerRows.map((row) => row.follower_id),
        ...messages.map((message) => message.sender_id),
        ...reports.map((report) => report.reporter_id).filter((id): id is string => Boolean(id)),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];

  let actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users, error: usersError } = await ctx.supabase
      .from("users")
      .select("id,username")
      .in("id", actorIds);

    if (usersError && isMissingRelation(usersError.code)) {
      actorMap = new Map();
    } else if (usersError) {
      throw new HttpError(500, "Failed to resolve notification actors", {
        expose: false,
      });
    }

    if (!usersError) {
      actorMap = new Map((users ?? []).map((user) => [user.id, user.username]));
    }
  }

  const notifications: NotificationItem[] = [
    ...followerRows.map((row) => ({
      id: `follow:${row.follower_id}:${row.created_at}`,
      type: "follow" as const,
      created_at: row.created_at,
      actor_id: row.follower_id,
      actor_username: actorMap.get(row.follower_id) ?? "unknown",
      title: "New follower",
      body: `@${actorMap.get(row.follower_id) ?? "unknown"} followed you`,
    })),
    ...messages.map((message) => ({
      id: `message:${message.id}`,
      type: "message" as const,
      created_at: message.created_at,
      actor_id: message.sender_id,
      actor_username: actorMap.get(message.sender_id) ?? "unknown",
      title: "New message",
      body: `@${actorMap.get(message.sender_id) ?? "unknown"}: ${message.content.slice(0, 90)}`,
    })),
    ...reports.map((report) => ({
      id: `report:${report.id}`,
      type: "report" as const,
      created_at: report.created_at,
      actor_id: report.reporter_id,
      actor_username: report.reporter_id
        ? actorMap.get(report.reporter_id) ?? "unknown"
        : "anonymous",
      title: "Post report",
      body: report.reporter_id
        ? `Your post was reported by @${actorMap.get(report.reporter_id) ?? "unknown"}`
        : "Your post was reported",
    })),
  ];

  return jsonResponse({
    notifications: sortByDateDesc(notifications).slice(0, 50),
  });
}
