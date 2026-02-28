import type { AppContext } from "../types";
import { logAsyncWarning } from "./logger";

interface NotificationInput {
  recipientId: string;
  actorId: string | null;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

export async function createNotification(
  ctx: AppContext,
  input: NotificationInput,
): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) {
    return;
  }

  const { error } = await ctx.supabase.from("notifications").insert({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    type: input.type,
    title: input.title,
    body: input.body,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  });

  // If migration is not yet applied, do not break main flow.
  if (error && error.code !== "42P01" && error.code !== "42703") {
    logAsyncWarning(
      ctx,
      "notifications.insert_failed",
      `Failed to insert notification (${error.code ?? "unknown"})`,
    );
  }
}
