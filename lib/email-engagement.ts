import type { SupabaseClient } from "@supabase/supabase-js";

type EngagementInput = {
  providerEventId: string;
  outboundMessageId: string;
  eventType: string;
  occurredAt: string;
  clickedUrl?: string | null;
  providerPayload?: unknown;
};

export async function recordEmailEngagementEvent(admin: SupabaseClient, input: EngagementInput) {
  const { error: eventError } = await admin.from("email_engagement_events").upsert({
    provider_event_id: input.providerEventId,
    outbound_message_id: input.outboundMessageId,
    event_type: input.eventType,
    occurred_at: input.occurredAt,
    clicked_url: input.clickedUrl || null,
    provider_payload: input.providerPayload || {},
  }, { onConflict: "provider_event_id", ignoreDuplicates: true });
  if (eventError) throw eventError;

  // Rebuild summaries from the unique event ledger. Both email providers and
  // link scanners may retry the same event, so counters must never increment
  // directly from a webhook request.
  const { data: events, error: engagementError } = await admin
    .from("email_engagement_events")
    .select("event_type,occurred_at,clicked_url")
    .eq("outbound_message_id", input.outboundMessageId)
    .order("occurred_at", { ascending: true });
  if (engagementError) throw engagementError;

  const rows = events || [];
  const latest = <T,>(items: T[]) => items.length ? items[items.length - 1] : null;
  const delivered = latest(rows.filter((row) => row.event_type === "email.delivered"));
  const opened = rows.filter((row) => row.event_type === "email.opened");
  const clicked = rows.filter((row) => row.event_type === "email.clicked");
  const latestOpened = latest(opened);
  const latestClicked = latest(clicked);
  const failure = latest(rows.filter((row) =>
    row.event_type === "email.bounced" || row.event_type === "email.failed" || row.event_type === "email.complained"
  ));
  const latestEvent = latest(rows);
  const updates: Record<string, unknown> = {
    last_event_at: latestEvent?.occurred_at || input.occurredAt,
    delivered_at: delivered?.occurred_at || null,
    opened_at: latestOpened?.occurred_at || null,
    clicked_at: latestClicked?.occurred_at || null,
    open_count: opened.length,
    click_count: clicked.length,
    last_clicked_url: latestClicked?.clicked_url || null,
    updated_at: new Date().toISOString(),
  };
  if (failure) {
    updates.status = "failed";
    updates.last_error = failure.event_type.replace("email.", "Email ");
  } else if (delivered) {
    updates.status = "delivered";
    updates.last_error = null;
  }
  const { error: updateError } = await admin.from("outbound_messages").update(updates).eq("id", input.outboundMessageId);
  if (updateError) throw updateError;
}

