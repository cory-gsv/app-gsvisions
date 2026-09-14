const clean = (value: unknown) => String(value ?? "").trim();

function escapeIcsText(value: unknown) {
  return clean(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildAppointmentUpdateIcs(args: {
  bookingId: string;
  scheduledStart: string;
  scheduledEnd: string;
  propertyAddress: string;
  description: string;
  generatedAt?: Date;
}) {
  const start = new Date(args.scheduledStart);
  const end = new Date(args.scheduledEnd);
  const generatedAt = args.generatedAt || new Date();
  if (
    !clean(args.bookingId) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    Number.isNaN(generatedAt.getTime())
  ) {
    return "";
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Golden State Visions//Appointment Update//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`${clean(args.bookingId)}@gsvisions.co`)}`,
    `DTSTAMP:${formatIcsDate(generatedAt)}`,
    `LAST-MODIFIED:${formatIcsDate(generatedAt)}`,
    `SEQUENCE:${Math.floor(generatedAt.getTime() / 1000)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(`Golden State Visions – ${clean(args.propertyAddress) || "Photoshoot"}`)}`,
    `DESCRIPTION:${escapeIcsText(args.description)}`,
    `LOCATION:${escapeIcsText(args.propertyAddress)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Golden State Visions appointment reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
