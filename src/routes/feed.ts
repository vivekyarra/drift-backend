import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError, isHttpError } from "../utils/errors";
import {
  jsonResponse,
  parseIsoTimestampParam,
  parsePositiveIntParam,
} from "../utils/http";
import { fetchPostEngagement } from "../utils/postEngagement";

interface FeedPostRow {
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

export async function handleFeed(ctx: AppContext): Promise<Response> {
  const requestUrl = new URL(ctx.request.url);
  const followingOnly = requestUrl.searchParams.get("following_only") === "true";
  const cursor = parseIsoTimestampParam(
    requestUrl.searchParams.get("cursor"),
    "Invalid cursor",
  );
  const limit = parsePositiveIntParam(requestUrl.searchParams.get("limit"), {
    min: 1,
    max: 50,
    fallback: 20,
    invalidMessage: "limit must be between 1 and 50",
  });
  let followedUserIds: string[] | null = null;
  let viewerUserId: string | null = null;

  try {
    await requireSession(ctx);
    viewerUserId = ctx.session!.userId;
  } catch (error) {
    if (followingOnly) {
      throw error;
    }

    if (!isHttpError(error) || (error.status !== 401 && error.status !== 403)) {
      throw error;
    }
  }

  if (followingOnly) {
    const { data: follows, error: followsError } = await ctx.supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", ctx.session!.userId);

    if (followsError) {
      throw new HttpError(500, "Failed to fetch follow relationships", {
        expose: false,
      });
    }

    followedUserIds = (follows ?? []).map((follow) => follow.following_id);
    if (followedUserIds.length === 0) {
      return jsonResponse({
        posts: [],
        nextCursor: null,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const runFeedQuery = async (
    withDeletedFilter: boolean,
    withVideoColumn: boolean,
  ) => {
    const selectClause = withVideoColumn
      ? "id,user_id,channel,content,image_url,video_url,image_blurhash,created_at,expires_at"
      : "id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at";

    let query = ctx.supabase
      .from("posts")
      .select(selectClause)
      .eq("hidden", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (withDeletedFilter) {
      query = query.is("deleted_at", null);
    }

    if (followingOnly) {
      query = query.in("user_id", followedUserIds!);
    }

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    return query;
  };

  let { data: posts, error } = await runFeedQuery(true, true);
  if (error?.code === "42703") {
    ({ data: posts, error } = await runFeedQuery(false, true));
  }
  if (error?.code === "42703") {
    ({ data: posts, error } = await runFeedQuery(true, false));
  }
  if (error?.code === "42703") {
    // Backward-compatible fallback when both deleted_at and video_url are not migrated yet.
    ({ data: posts, error } = await runFeedQuery(false, false));
  }

  if (error) {
    throw new HttpError(500, "Failed to fetch feed", { expose: false });
  }

  const safePosts = (posts ?? []) as unknown as FeedPostRow[];
  const postAuthorIds = [...new Set(safePosts.map((post) => post.user_id))];
  let userMap = new Map<
    string,
    {
      username: string;
      isShadowBanned: boolean;
    }
  >();

  if (postAuthorIds.length > 0) {
    const primaryAuthors = await ctx.supabase
      .from("users")
      .select("id,username,is_shadow_banned")
      .in("id", postAuthorIds);

    let authors = primaryAuthors.data;
    let authorsError = primaryAuthors.error;

    if (authorsError?.code === "42703") {
      const fallbackAuthors = await ctx.supabase
        .from("users")
        .select("id,username")
        .in("id", postAuthorIds);

      authors = fallbackAuthors.data
        ? fallbackAuthors.data.map((user) => ({
            ...user,
            is_shadow_banned: false,
          }))
        : null;
      authorsError = fallbackAuthors.error;
    }

    if (authorsError) {
      throw new HttpError(500, "Failed to build feed", { expose: false });
    }

    userMap = new Map(
      (authors ?? []).map((author) => [
        author.id,
        {
          username: author.username,
          isShadowBanned: Boolean(author.is_shadow_banned),
        },
      ]),
    );
  }

  const mappedPosts = safePosts
    .filter((post) => {
      const author = userMap.get(post.user_id);
      return !author?.isShadowBanned;
    })
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
      username: userMap.get(post.user_id)?.username ?? "unknown",
    }));

  const engagementMap = await fetchPostEngagement(
    ctx,
    mappedPosts.map((post) => post.id),
    viewerUserId,
  );

  const nextCursor =
    mappedPosts.length > 0 ? mappedPosts[mappedPosts.length - 1].created_at : null;

  return jsonResponse({
      posts: mappedPosts.map((post) => ({
        ...post,
        engagement: engagementMap.get(post.id) ?? null,
      })),
      nextCursor,
    },
    200,
    {
      "Cache-Control": followingOnly
        ? "private, no-store"
        : "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
    },
  );
}
