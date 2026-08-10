import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  let response: NextResponse;

  const platformHosts = new Set([
    "sites.gsvisions.co", "beta.gsvisions.co", "hub.gsvisions.co", "app.gsvisions.co",
    "gsvisions.co", "www.gsvisions.co", "localhost", "127.0.0.1",
  ]);
  const isVercelHost = host.endsWith(".vercel.app");

  if (host === "sites.gsvisions.co" && /^\/[a-zA-Z0-9_-]+\/?$/.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${pathname.replace(/^\/+|\/+$/g, "")}`;
    response = NextResponse.rewrite(url);
  } else if (host === "sites.gsvisions.co" && pathname.startsWith("/sites/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/sites/, "") || "/";
    response = NextResponse.redirect(url, 308);
  } else if (!platformHosts.has(host) && !isVercelHost && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${host}`;
    response = NextResponse.rewrite(url);
  } else {
    response = NextResponse.next();
  }

  if (process.env.APP_ENV === "beta" && host !== "sites.gsvisions.co") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
