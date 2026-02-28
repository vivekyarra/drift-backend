import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parsePositiveIntParam } from "../utils/http";

interface SearchPostRow {
  id: string;
  user_id: string;
  channel: string;
  content: string;
  image_url: string | null;
  video_url?: string | null;
  image_blurhash: string | null;
  created_at: string;
  expires_at: string;
}

function sanitizeSearchQuery(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function toPattern(value: string): string {
  return `%${value}%`;
}

export async function handleSearch(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const requestUrl = new URL(ctx.request.url);
  const query = sanitizeSearchQuery(requestUrl.searchParams.get("q"));
  const limit = parsePositiveIntParam(requestUrl.searchParams.get("limit"), {
    min: 1,
    max: 50,
    fallback: 20,
    invalidMessage: "limit must be between 1 and 50",
  });
  const nowIso = new Date().toISOString();

  const { data: followingRows, error: followingError } = await ctx.supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", ctx.session!.userId);

  if (followingError) {
    throw new HttpError(500, "Failed to fetch search context", { expose: false });
  }

  const followingIds = new Set((followingRows ?? []).map((row) => row.following_id));

  let usersQuery = ctx.supabase
    .from("users")
    .select("id,username,created_at")
    .neq("id", ctx.session!.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (query) {
    usersQuery = usersQuery.ilike("username", toPattern(query));
  }

  const usersResult = await usersQuery;
  if (usersResult.error) {
    throw new HttpError(500, "Failed to search users", { expose: false });
  }

  const runPostQuery = async (withDeletedFilter: boolean, withVideoColumn: boolean) => {
    const selectClause = withVideoColumn
      ? "id,user_id,channel,content,image_url,video_url,image_blurhash,created_at,expires_at"
      : "id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at";

    let postsQuery = ctx.supabase
      .from("posts")
      .select(selectClause)
      .eq("hidden", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (withDeletedFilter) {
      postsQuery = postsQuery.is("deleted_at", null);
    }

    if (query) {
      postsQuery = postsQuery.ilike("content", toPattern(query));
    }

    return postsQuery;
  };

  let { data: posts, error: postsError } = await runPostQuery(true, true);
  if (postsError?.code === "42703") {
    ({ data: posts, error: postsError } = await runPostQuery(false, true));
  }
  if (postsError?.code === "42703") {
    ({ data: posts, error: postsError } = await runPostQuery(true, false));
  }
  if (postsError?.code === "42703") {
    ({ data: posts, error: postsError } = await runPostQuery(false, false));
  }

  if (postsError) {
    throw new HttpError(500, "Failed to search posts", { expose: false });
  }

  const safePosts = (posts ?? []) as unknown as SearchPostRow[];
  const safeUsers = usersResult.data ?? [];

  const userIds = [...new Set(safePosts.map((post) => post.user_id))];
  let userMap = new Map<string, string>();

  if (userIds.length > 0) {
    const primaryUsers = await ctx.supabase
      .from("users")
      .select("id,username,is_shadow_banned")
      .in("id", userIds);

    let postUsers = primaryUsers.data;
    let postUsersError = primaryUsers.error;
    if (postUsersError?.code === "42703") {
      const fallbackUsers = await ctx.supabase
        .from("users")
        .select("id,username")
        .in("id", userIds);
      postUsers = fallbackUsers.data
        ? fallbackUsers.data.map((user) => ({
            ...user,
            is_shadow_banned: false,
          }))
        : null;
      postUsersError = fallbackUsers.error;
    }

    if (postUsersError) {
      throw new HttpError(500, "Failed to build search response", {
        expose: false,
      });
    }

    userMap = new Map(
      (postUsers ?? [])
        .filter((user) => !user.is_shadow_banned)
        .map((user) => [user.id, user.username]),
    );
  }

  return jsonResponse({
    query,
    users: safeUsers
      .slice(0, limit)
      .map((user) => ({
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        is_following: followingIds.has(user.id),
      })),
    posts: safePosts
      .map((post) => ({
        id: post.id,
        user_id: post.user_id,
        channel: post.channel,
        content: post.content,
        image_url: post.image_url,
        video_url: post.video_url ?? null,
        image_blurhash: post.image_blurhash,
        created_at: post.created_at,
        expires_at: post.expires_at,
        username: userMap.get(post.user_id) ?? "unknown",
        is_from_following: followingIds.has(post.user_id),
      }))
      .filter((post) => post.username !== "unknown"),
  });
}
