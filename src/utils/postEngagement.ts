import type { AppContext } from "../types";

export interface PostEngagementSummary {
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  saveCount: number;
  myReaction: "like" | "dislike" | "emoji" | null;
  myEmoji: string | null;
  isSaved: boolean;
  emojiCounts: Record<string, number>;
}

function defaultSummary(): PostEngagementSummary {
  return {
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    saveCount: 0,
    myReaction: null,
    myEmoji: null,
    isSaved: false,
    emojiCounts: {},
  };
}

export async function fetchPostEngagement(
  ctx: AppContext,
  postIds: string[],
  viewerUserId: string | null,
): Promise<Map<string, PostEngagementSummary>> {
  const result = new Map<string, PostEngagementSummary>();
  if (postIds.length === 0) {
    return result;
  }

  for (const postId of postIds) {
    result.set(postId, defaultSummary());
  }

  const [reactionsResult, commentsResult, savesResult, mySavesResult] =
    await Promise.all([
      ctx.supabase
        .from("post_reactions")
        .select("post_id,user_id,reaction_type,emoji")
        .in("post_id", postIds),
      ctx.supabase
        .from("comments")
        .select("post_id")
        .in("post_id", postIds)
        .eq("hidden", false),
      ctx.supabase
        .from("saved_posts")
        .select("post_id,user_id")
        .in("post_id", postIds),
      viewerUserId
        ? ctx.supabase
            .from("saved_posts")
            .select("post_id")
            .in("post_id", postIds)
            .eq("user_id", viewerUserId)
        : Promise.resolve({ data: [] as Array<{ post_id: string }>, error: null } as const),
    ]);

  if (!reactionsResult.error) {
    for (const reaction of reactionsResult.data ?? []) {
      const entry = result.get(reaction.post_id);
      if (!entry) {
        continue;
      }

      if (reaction.reaction_type === "like") {
        entry.likeCount += 1;
      } else if (reaction.reaction_type === "dislike") {
        entry.dislikeCount += 1;
      } else if (reaction.reaction_type === "emoji" && reaction.emoji) {
        entry.emojiCounts[reaction.emoji] = (entry.emojiCounts[reaction.emoji] ?? 0) + 1;
      }

      if (viewerUserId && reaction.user_id === viewerUserId) {
        entry.myReaction = reaction.reaction_type;
        entry.myEmoji = reaction.emoji;
      }
    }
  }

  if (!commentsResult.error) {
    for (const comment of commentsResult.data ?? []) {
      const entry = result.get(comment.post_id);
      if (entry) {
        entry.commentCount += 1;
      }
    }
  }

  if (!savesResult.error) {
    for (const saved of savesResult.data ?? []) {
      const entry = result.get(saved.post_id);
      if (entry) {
        entry.saveCount += 1;
      }
    }
  }

  if (!mySavesResult.error) {
    for (const saved of mySavesResult.data ?? []) {
      const entry = result.get(saved.post_id);
      if (entry) {
        entry.isSaved = true;
      }
    }
  }

  return result;
}
