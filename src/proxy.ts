import { NextRequest, NextResponse } from "next/server";

async function token(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lead-scorer:${password}`));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function proxy(request: NextRequest) {
  const method = request.method.toUpperCase(), mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating && request.nextUrl.pathname !== "/api/login") {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Odrzucono żądanie z obcego źródła." }, { status: 403 });
  }
  const password = process.env.APP_PASSWORD;
  if (!password || request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/api/login" || request.nextUrl.pathname === "/api/cron/research") return NextResponse.next();
  if (request.cookies.get("app_session")?.value === await token(password)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Wymagane logowanie." }, { status: 401 });
  const target = new URL("/login", request.url); target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(target);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|sample/).*)"] };
