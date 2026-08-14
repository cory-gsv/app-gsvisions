import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  let response: NextResponse;

  const isBetaRuntime = process.env.APP_ENV === "beta";
  const betaPassword = process.env.BETA_ACCESS_PASSWORD || "";
  const shouldProtectBeta = isBetaRuntime && host !== "sites.gsvisions.co" && host !== "localhost" && host !== "127.0.0.1";
  if (shouldProtectBeta) {
    const authorization = request.headers.get("authorization") || "";
    const encoded = authorization.match(/^Basic\s+(.+)$/i)?.[1] || "";
    let suppliedPassword = "";
    try {
      const decoded = atob(encoded);
      suppliedPassword = decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      suppliedPassword = "";
    }
    if (!betaPassword || suppliedPassword !== betaPassword) {
      return new NextResponse("Protected GSV beta", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Golden State Visions Beta", charset="UTF-8"',
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
  }

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

  if (isBetaRuntime && host !== "sites.gsvisions.co") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
