import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { createNotification } from "../utils/notifications";
import { sanitizeContent, sanitizeUuid } from "../utils/sanitize";

type ReportableContentType = "post" | "comment";

interface ReportRequestBody {
  content_type?: unknown;
  content_id?: unknown;
  reason?: unknown;
}

interface ReportableRecord {
  id: string;
  user_id: string;
  report_count: number;
  hidden: boolean;
  deleted_at?: string | null;
}

function sanitizeContentType(value: unknown): ReportableContentType | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value.trim().toLowerCase();
  if (sanitized === "post" || sanitized === "comment") {
    return sanitized;
  }

  return null;
}

function sanitizeReportReason(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "reason must be a string");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = sanitizeContent(trimmed, 500);
  if (!sanitized) {
    throw new HttpError(400, "reason must be 1-500 characters");
  }

  return sanitized;
}

async function reportAlreadyExists(
  ctx: AppContext,
  contentType: ReportableContentType,
  contentId: string,
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from("reports")
    .select("id")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("reporter_id", ctx.session!.userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to check report status", { expose: false });
  }

  return Boolean(data);
}

async function insertReport(
  ctx: AppContext,
  contentType: ReportableContentType,
  contentId: string,
  reason: string | null,
): Promise<boolean> {
  const primaryInsert = await ctx.supabase.from("reports").insert({
    content_type: contentType,
    content_id: contentId,
    reporter_id: ctx.session!.userId,
    reason,
  });

  if (!primaryInsert.error) {
    return false;
  }

  if (primaryInsert.error.code === "23505") {
    return true;
  }
  if (primaryInsert.error.code === "42703") {
    const fallbackInsert = await ctx.supabase.from("reports").insert({
      content_type: contentType,
      content_id: contentId,
      reporter_id: ctx.session!.userId,
    });

    if (!fallbackInsert.error) {
      return false;
    }

    if (fallbackInsert.error.code === "23505") {
      return true;
    }
  }

  throw new HttpError(500, "Failed to create report", { expose: false });
}

async function getPostForReport(
  ctx: AppContext,
  postId: string,
): Promise<ReportableRecord | null> {
  const primaryQuery = await ctx.supabase
    .from("posts")
    .select("id,user_id,report_count,hidden,deleted_at")
    .eq("id", postId)
    .maybeSingle();

  if (!primaryQuery.error) {
    if (primaryQuery.data?.deleted_at) {
      return null;
    }
    return primaryQuery.data;
  }

  if (primaryQuery.error.code !== "42703") {
    throw new HttpError(500, "Failed to fetch post", { expose: false });
  }

  const fallbackQuery = await ctx.supabase
    .from("posts")
    .select("id,user_id,report_count,hidden")
    .eq("id", postId)
    .maybeSingle();

  if (fallbackQuery.error) {
    throw new HttpError(500, "Failed to fetch post", { expose: false });
  }

  return fallbackQuery.data;
}

async function getCommentForReport(
  ctx: AppContext,
  commentId: string,
): Promise<ReportableRecord | null> {
  const { data, error } = await ctx.supabase
    .from("comments")
    .select("id,user_id,report_count,hidden")
    .eq("id", commentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to fetch comment", { expose: false });
  }

  return data;
}

async function applyReportUpdate(
  ctx: AppContext,
  contentType: ReportableContentType,
  contentId: string,
  currentReportCount: number,
  currentlyHidden: boolean,
): Promise<{ reportCount: number; hidden: boolean }> {
  const nextReportCount = currentReportCount + 1;
  const shouldHide = currentlyHidden || nextReportCount > 5;
  const targetTable = contentType === "post" ? "posts" : "comments";

  const { error } = await ctx.supabase
    .from(targetTable)
    .update({
      report_count: nextReportCount,
      hidden: shouldHide,
    })
    .eq("id", contentId);

  if (error) {
    throw new HttpError(500, "Failed to update report count", { expose: false });
  }

  return {
    reportCount: nextReportCount,
    hidden: shouldHide,
  };
}

export async function handleReportContent(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "report.create",
    limit: 20,
    windowMs: 60_000,
    minIntervalMs: 500,
    errorCode: "REPORT_SPAM",
  });

  const body = await parseJsonBody<ReportRequestBody>(ctx.request);
  const contentType = sanitizeContentType(body.content_type);
  const contentId = sanitizeUuid(body.content_id);
  const reason = sanitizeReportReason(body.reason);

  if (!contentType) {
    throw new HttpError(400, "content_type must be one of: post, comment");
  }

  if (!contentId) {
    throw new HttpError(400, "content_id must be a valid UUID");
  }

  const content =
    contentType === "post"
      ? await getPostForReport(ctx, contentId)
      : await getCommentForReport(ctx, contentId);

  if (!content) {
    throw new HttpError(404, "Content not found");
  }

  const existingReport = await reportAlreadyExists(ctx, contentType, contentId);
  if (existingReport) {
    return jsonResponse({
      success: true,
      duplicate: true,
      content_type: contentType,
      content_id: contentId,
      report_count: content.report_count,
      hidden: content.hidden,
    });
  }

  const duplicateFromInsert = await insertReport(ctx, contentType, contentId, reason);
  if (duplicateFromInsert) {
    return jsonResponse({
      success: true,
      duplicate: true,
      content_type: contentType,
      content_id: contentId,
      report_count: content.report_count,
      hidden: content.hidden,
    });
  }

  const moderationState = await applyReportUpdate(
    ctx,
    contentType,
    contentId,
    content.report_count,
    content.hidden,
  );

  const trustUpdate = await ctx.supabase
    .from("users")
    .select("trust_score")
    .eq("id", content.user_id)
    .maybeSingle();

  if (!trustUpdate.error && trustUpdate.data) {
    const nextTrustScore = Math.max(0, (trustUpdate.data.trust_score ?? 0) - 1);
    await ctx.supabase
      .from("users")
      .update({ trust_score: nextTrustScore })
      .eq("id", content.user_id);
  }

  await createNotification(ctx, {
    recipientId: content.user_id,
    actorId: ctx.session!.userId,
    type: "report",
    title: contentType === "post" ? "Post reported" : "Comment reported",
    body: `@${ctx.session!.username} reported your ${contentType}`,
    entityType: contentType,
    entityId: contentId,
  });

  return jsonResponse({
    success: true,
    duplicate: false,
    content_type: contentType,
    content_id: contentId,
    report_count: moderationState.reportCount,
    hidden: moderationState.hidden,
  });
}
