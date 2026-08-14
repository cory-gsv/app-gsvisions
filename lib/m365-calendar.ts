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
  const response = await graphRequest(`/users/${encodeURIComponent(m365CalendarEmail)}/calendarView?${query}`);
  if (!response.ok) throw new Error(`Microsoft 365 calendar returned ${response.status}.`);
  const data = await response.json() as { value?: GraphEvent[] };
  return (data.value || [])
    .filter((event) => !event.isCancelled && event.start?.dateTime && event.end?.dateTime)
    .map((event) => ({
      id: event.id || "",
      title: event.subject || "(No title)",
      start: event.start!.dateTime!,
      end: event.end!.dateTime!,
      allDay: event.isAllDay === true,
      location: event.location?.displayName || "",
      showAs: event.showAs || "busy",
      webLink: event.webLink || "",
    }));
}

export async function updateMicrosoftCalendarEventBody(eventId: string, content: string) {
  if (!isMicrosoftCalendarConfigured()) {
    return { updated: false, reason: "microsoft_not_configured" } as const;
  }
  const id = String(eventId || "").trim();
  if (!id) return { updated: false, reason: "event_id_not_available" } as const;
  const response = await graphRequest(
    `/users/${encodeURIComponent(m365CalendarEmail)}/events/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body: { contentType: "text", content } }),
    }
  );
  if (!response.ok) {
    throw new Error(`Microsoft 365 calendar update returned ${response.status}.`);
  }
  return { updated: true } as const;
}
