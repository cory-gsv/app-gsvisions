const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

export const m365CalendarEmail = process.env.M365_CALENDAR_EMAIL || "cory@gsvisions.com";

export function isMicrosoftCalendarConfigured() {
  return Boolean(process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET);
}

export async function graphRequest(path: string, init?: RequestInit) {
  const tenant = process.env.M365_TENANT_ID;
  const clientId = process.env.M365_CLIENT_ID;
  const clientSecret = process.env.M365_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) throw new Error("Microsoft 365 calendar is not configured.");

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new Error("Microsoft 365 authentication failed.");
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Microsoft 365 did not return an access token.");

  return fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="Pacific Standard Time"',
      ...init?.headers,
    },
    cache: "no-store",
  });
}

type GraphEvent = {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  webLink?: string;
};

export async function listMicrosoftCalendarEvents(start: string, end: string) {
  if (!isMicrosoftCalendarConfigured()) throw new Error("Microsoft 365 calendar is not configured.");
  const query = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    "$select": "id,subject,start,end,location,isAllDay,isCancelled,showAs,webLink",
    "$orderby": "start/dateTime",
    "$top": "500",
  });
  const response = await graphRequest(
    `/users/${encodeURIComponent(m365CalendarEmail)}/calendarView?${query}`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } }
  );
  if (!response.ok) throw new Error(`Microsoft 365 calendar returned ${response.status}.`);
  const data = await response.json() as { value?: GraphEvent[] };
  return (data.value || [])
    .filter((event) => !event.isCancelled && event.start?.dateTime && event.end?.dateTime)
    .map((event) => ({
      id: event.id || "",
      title: event.subject || "(No title)",
      start: new Date(`${event.start!.dateTime!.replace(/Z$/, "")}Z`).toISOString(),
      end: new Date(`${event.end!.dateTime!.replace(/Z$/, "")}Z`).toISOString(),
      allDay: event.isAllDay === true,
      location: event.location?.displayName || "",
      showAs: event.showAs || "busy",
      webLink: event.webLink || "",
    }));
}

function graphDateTime(value: string, label: string) {
  const date = new Date(String(value || "").trim());
  if (Number.isNaN(date.getTime())) throw new Error(`Microsoft 365 calendar ${label} is invalid.`);
  return {
    dateTime: date.toISOString().replace(/Z$/, ""),
    timeZone: "UTC",
  };
}

export async function updateMicrosoftCalendarEvent(args: {
  eventId: string;
  content?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}) {
  if (!isMicrosoftCalendarConfigured()) {
    return { updated: false, reason: "microsoft_not_configured" } as const;
  }
  const id = String(args.eventId || "").trim();
  if (!id) return { updated: false, reason: "event_id_not_available" } as const;

  const start = String(args.scheduledStart || "").trim();
  const end = String(args.scheduledEnd || "").trim();
  if ((start && !end) || (!start && end)) {
    throw new Error("Microsoft 365 calendar updates require both a start and end time.");
  }

  const payload: Record<string, unknown> = {};
  if (args.content !== undefined && args.content !== null) {
    payload.body = { contentType: "text", content: String(args.content) };
  }
  if (start && end) {
    payload.start = graphDateTime(start, "start time");
    payload.end = graphDateTime(end, "end time");
  }

  if (!Object.keys(payload).length) return { updated: false, reason: "no_calendar_changes" } as const;

  const response = await graphRequest(
    `/users/${encodeURIComponent(m365CalendarEmail)}/events/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const graphError = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const detail = String(graphError?.error?.message || "").trim();
    throw new Error(`Microsoft 365 calendar update returned ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return { updated: true } as const;
}

export async function updateMicrosoftCalendarEventBody(eventId: string, content: string) {
  return updateMicrosoftCalendarEvent({ eventId, content });
}

function parseGraphUtcDateTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function shiftMicrosoftCalendarTravelEvents(args: {
  propertyAddress: string;
  previousStart: string;
  previousEnd: string;
  nextStart: string;
  nextEnd: string;
}) {
  if (!isMicrosoftCalendarConfigured()) {
    return { updated: false, count: 0, reason: "microsoft_not_configured" } as const;
  }

  const previousStart = new Date(args.previousStart);
  const previousEnd = new Date(args.previousEnd);
  const nextStart = new Date(args.nextStart);
  const nextEnd = new Date(args.nextEnd);
  if ([previousStart, previousEnd, nextStart, nextEnd].some((date) => Number.isNaN(date.getTime()))) {
    throw new Error("Microsoft 365 travel blocks received an invalid appointment time.");
  }

  const query = new URLSearchParams({
    startDateTime: new Date(previousStart.getTime() - 24 * 60 * 60_000).toISOString(),
    endDateTime: new Date(previousEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    "$select": "id,subject,start,end",
    "$orderby": "start/dateTime",
    "$top": "100",
  });
  const response = await graphRequest(
    `/users/${encodeURIComponent(m365CalendarEmail)}/calendarView?${query}`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } }
  );
  if (!response.ok) throw new Error(`Microsoft 365 travel-block lookup returned ${response.status}.`);

  const data = await response.json() as { value?: GraphEvent[] };
  const addressKey = String(args.propertyAddress || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const matchingAddress = (event: GraphEvent) => {
    if (!addressKey) return true;
    return String(event.subject || "").toLowerCase().includes(addressKey);
  };
  const withinTwoMinutes = (left: Date | null, right: Date) =>
    Boolean(left && Math.abs(left.getTime() - right.getTime()) <= 2 * 60_000);
  const events = data.value || [];
  const travelTo = events.find((event) =>
    String(event.subject || "").toLowerCase().startsWith("travel to") &&
    matchingAddress(event) &&
    withinTwoMinutes(parseGraphUtcDateTime(event.end?.dateTime), previousStart)
  );
  const travelFrom = events.find((event) =>
    String(event.subject || "").toLowerCase().startsWith("travel from") &&
    matchingAddress(event) &&
    withinTwoMinutes(parseGraphUtcDateTime(event.start?.dateTime), previousEnd)
  );

  const updates: Promise<unknown>[] = [];
  if (travelTo?.id) {
    const travelStart = parseGraphUtcDateTime(travelTo.start?.dateTime);
    const travelEnd = parseGraphUtcDateTime(travelTo.end?.dateTime);
    if (travelStart && travelEnd) {
      const duration = travelEnd.getTime() - travelStart.getTime();
      updates.push(updateMicrosoftCalendarEvent({
        eventId: travelTo.id,
        scheduledStart: new Date(nextStart.getTime() - duration).toISOString(),
        scheduledEnd: nextStart.toISOString(),
      }));
    }
  }
  if (travelFrom?.id) {
    const travelStart = parseGraphUtcDateTime(travelFrom.start?.dateTime);
    const travelEnd = parseGraphUtcDateTime(travelFrom.end?.dateTime);
    if (travelStart && travelEnd) {
      const duration = travelEnd.getTime() - travelStart.getTime();
      updates.push(updateMicrosoftCalendarEvent({
        eventId: travelFrom.id,
        scheduledStart: nextEnd.toISOString(),
        scheduledEnd: new Date(nextEnd.getTime() + duration).toISOString(),
      }));
    }
  }

  await Promise.all(updates);
  return { updated: true, count: updates.length } as const;
}
