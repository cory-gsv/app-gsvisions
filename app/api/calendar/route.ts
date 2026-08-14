import { authorizationErrorResponse, requireUser } from "@/lib/authz";
import { listMicrosoftCalendarEvents } from "@/lib/m365-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireUser(request);
    const body = await request.json().catch(() => ({}));
    if (body.action !== "list") {
      return Response.json({ error: "Unsupported calendar action." }, { status: 400 });
    }
    const start = String(body.start || "").trim();
    const end = String(body.end || "").trim();
    if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
      return Response.json({ error: "Valid calendar start and end dates are required." }, { status: 400 });
    }
    const events = await listMicrosoftCalendarEvents(start, end);
    return Response.json({ source: "microsoft365", events });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("M365_CALENDAR_LIST_FAILED", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Microsoft 365 calendar could not be loaded." },
      { status: 502 },
    );
  }
}
