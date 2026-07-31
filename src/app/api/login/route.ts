import { NextRequest, NextResponse } from "next/server";
async function token(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lead-scorer:${password}`));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function POST(request: NextRequest) {
  const form = await request.formData(), supplied = form.get("password")?.toString() || "", configured = process.env.APP_PASSWORD;
  if (!configured || supplied !== configured) return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  const next = form.get("next")?.toString(); const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.cookies.set("app_session", await token(configured), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 12 });
  return response;
}
