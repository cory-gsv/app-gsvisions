import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const requestedNext = url.searchParams.get("next") || "/dashboard";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/dashboard";
  const response = NextResponse.redirect(new URL(next, url.origin));

  const otpType = type === "magiclink" || type === "recovery" || type === "invite" ? type : null;
  if (!code && !(tokenHash && otpType)) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.headers.get("cookie")
            ?.split(";")
            .map((part) => {
              const separator = part.indexOf("=");
              return {
                name: part.slice(0, separator).trim(),
                value: part.slice(separator + 1).trim(),
              };
            })
            .filter((cookie) => cookie.name) || [];
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: otpType!,
      });
  if (error) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  return response;
}
