import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/db/client";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const ALLOWED_IP_HEADERS = new Set(["x-forwarded-for", "x-real-ip", "cf-connecting-ip"]);

function clientKey(request: NextRequest) {
  let header: string | undefined;
  if (process.env.VERCEL) header = "x-vercel-forwarded-for";
  else if (process.env.TRUSTED_CLIENT_IP_HEADER) {
    const configured = process.env.TRUSTED_CLIENT_IP_HEADER.toLowerCase();
    if (!ALLOWED_IP_HEADERS.has(configured)) throw new Error("Nieobsługiwany TRUSTED_CLIENT_IP_HEADER.");
    header = configured;
  } else if (process.env.NODE_ENV === "production") throw new Error("Poza Vercel ustaw TRUSTED_CLIENT_IP_HEADER zgodnie z zaufanym reverse proxy.");
  else return null;
  const value = request.headers.get(header) || (process.env.VERCEL ? request.headers.get("x-forwarded-for") : null);
  if (!value) throw new Error("Brak zaufanego nagłówka adresu klienta.");
  return createHash("sha256").update(value.split(",")[0].trim()).digest("hex");
}

export async function POST(request: NextRequest) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  const db = getClient();
  let key: string | null;
  try { key = clientKey(request); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 }); }
  if (key) {
    const reserved = await db.query<{ attempts: number }>(`WITH cleaned AS (
      DELETE FROM login_attempts WHERE window_started_at < now()-interval '1 day'
    ), attempt AS (
      INSERT INTO login_attempts(key,attempts,window_started_at) VALUES($1,1,now())
      ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN login_attempts.window_started_at < now()-$2::int*interval '1 minute' THEN 1 ELSE login_attempts.attempts+1 END,
        window_started_at=CASE WHEN login_attempts.window_started_at < now()-$2::int*interval '1 minute' THEN now() ELSE login_attempts.window_started_at END
      RETURNING attempts
    ) SELECT attempts FROM attempt`, [key, WINDOW_MINUTES]);
    if ((reserved.rows[0]?.attempts ?? MAX_ATTEMPTS + 1) > MAX_ATTEMPTS) return NextResponse.redirect(new URL("/login?error=rate", request.url), 303);
  }

  const form = await request.formData();
  const supplied = String(form.get("password") || "");
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  if (!timingSafeEqual(suppliedHash, configuredHash)) return NextResponse.redirect(new URL("/login?error=1", request.url), 303);

  if (key) await db.query("DELETE FROM login_attempts WHERE key=$1", [key]);
  const next = String(form.get("next") || "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(new URL(safeNext, request.url), 303);
  response.cookies.set("app_session", createHash("sha256").update(`lead-scorer:${configured}`).digest("hex"), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  return response;
}
