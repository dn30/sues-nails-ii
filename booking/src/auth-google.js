import { json, badRequest } from "./api.js";

const SESSION_COOKIE = "snb_session";
const OAUTH_STATE_COOKIE = "snb_oauth_state";
const SESSION_DAYS = 14;

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function fromB64url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

async function hmacVerify(secret, message, signature) {
  const expected = await hmacSign(secret, message);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieHeader(name, value, { maxAge, httpOnly = true, path = "/" } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "Secure",
    "SameSite=Lax",
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function clearCookie(name) {
  return cookieHeader(name, "", { maxAge: 0 });
}

export function googleAuthConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function originFrom(request, env) {
  if (env.AUTH_BASE_URL) return env.AUTH_BASE_URL.replace(/\/$/, "");
  const url = new URL(request.url);
  return url.origin;
}

export async function getSessionUser(request, env) {
  if (!googleAuthConfigured(env)) return null;
  const cookies = parseCookies(request);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return null;
  if (!(await hmacVerify(env.SESSION_SECRET, payloadB64, sig))) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadB64)));
  } catch {
    return null;
  }
  if (!payload?.email || !payload?.exp || Date.now() > payload.exp) return null;
  const user = await env.DB.prepare(
    "SELECT id, email, role, status FROM admin_users WHERE email = ?"
  )
    .bind(normalizeEmail(payload.email))
    .first();
  if (!user || user.status === "disabled") return null;
  if (user.status !== "active" && user.status !== "invited") return null;
  return user;
}

async function createSessionCookie(env, user) {
  const payload = {
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_DAYS * 86400000,
  };
  const payloadB64 = b64urlJson(payload);
  const sig = await hmacSign(env.SESSION_SECRET, payloadB64);
  return cookieHeader(SESSION_COOKIE, `${payloadB64}.${sig}`, {
    maxAge: SESSION_DAYS * 86400,
  });
}

function randomToken(bytes = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function loginPageHtml({ error, notice, googleReady }) {
  const err = error
    ? `<p class="msg err">${escapeHtml(error)}</p>`
    : "";
  const note = notice
    ? `<p class="msg">${escapeHtml(notice)}</p>`
    : "";
  const button = googleReady
    ? `<a class="google" href="/admin/auth/google">Continue with Google</a>`
    : `<p class="msg err">Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Sue's Nails — Admin Sign In</title>
<style>
:root{--ink:#262016;--muted:#8a8171;--cream:#faf6ef;--white:#fff;--gold:#a8842c;--red:#a33;--hairline:rgba(168,132,44,.28)}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:grid;place-items:center;padding:1.5rem;font-family:system-ui,sans-serif;background:var(--cream);color:var(--ink)}
.card{width:min(400px,100%);background:var(--white);border:1px solid var(--hairline);border-radius:14px;padding:1.75rem 1.5rem;box-shadow:0 8px 28px rgba(38,32,22,.08)}
h1{font-size:1.25rem;margin-bottom:.35rem}
p.lead{color:var(--muted);font-size:.92rem;margin-bottom:1.25rem;line-height:1.45}
.google{display:flex;align-items:center;justify-content:center;gap:.65rem;width:100%;min-height:48px;border-radius:999px;border:1px solid var(--hairline);background:var(--white);color:var(--ink);text-decoration:none;font-weight:600}
.google:hover{border-color:var(--gold)}
.msg{margin:.85rem 0;font-size:.9rem;color:var(--ink)}
.msg.err{color:var(--red)}
.hint{margin-top:1.1rem;font-size:.8rem;color:var(--muted);line-height:1.4}
</style>
</head>
<body>
  <div class="card">
    <h1>Sue&rsquo;s Nails Admin</h1>
    <p class="lead">Sign in with the Google account that received an invite.</p>
    ${err}${note}
    ${button}
    <p class="hint">Access is invite-only. If you were not invited, ask the salon owner to send you an invite email.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function renderLogin(request, env, opts = {}) {
  return new Response(
    loginPageHtml({
      error: opts.error,
      notice: opts.notice,
      googleReady: googleAuthConfigured(env),
    }),
    {
      status: opts.status || 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...(opts.headers || {}),
      },
    }
  );
}

export async function startGoogleOAuth(request, env) {
  if (!googleAuthConfigured(env)) {
    return renderLogin(request, env, { error: "Google sign-in is not configured.", status: 503 });
  }
  const state = randomToken(16);
  const redirectUri = `${originFrom(request, env)}/admin/auth/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": cookieHeader(OAUTH_STATE_COOKIE, state, { maxAge: 600 }),
    },
  });
}

export async function handleGoogleCallback(request, env) {
  if (!googleAuthConfigured(env)) {
    return renderLogin(request, env, { error: "Google sign-in is not configured.", status: 503 });
  }
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    return renderLogin(request, env, { error: "Google sign-in was cancelled or failed.", status: 400 });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request);
  if (!code || !state || state !== cookies[OAUTH_STATE_COOKIE]) {
    return renderLogin(request, env, { error: "Invalid sign-in state. Please try again.", status: 400 });
  }

  const redirectUri = `${originFrom(request, env)}/admin/auth/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("Google token error", await tokenRes.text());
    return renderLogin(request, env, { error: "Could not complete Google sign-in.", status: 502 });
  }
  const tokens = await tokenRes.json();
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return renderLogin(request, env, { error: "Could not load your Google profile.", status: 502 });
  }
  const profile = await userRes.json();
  const email = normalizeEmail(profile.email);
  if (!email || profile.email_verified === false) {
    return renderLogin(request, env, {
      error: "Your Google account email must be verified.",
      status: 403,
    });
  }

  const user = await env.DB.prepare(
    "SELECT * FROM admin_users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (!user || user.status === "disabled") {
    return renderLogin(request, env, {
      error: "This Google account has not been invited. Ask the salon owner for an invite.",
      status: 403,
      headers: { "Set-Cookie": clearCookie(OAUTH_STATE_COOKIE) },
    });
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE admin_users
     SET status = 'active',
         google_sub = ?,
         accepted_at = COALESCE(accepted_at, ?),
         last_login_at = ?,
         invite_token = NULL
     WHERE id = ?`
  )
    .bind(profile.sub || "", now, now, user.id)
    .run();

  const sessionUser = { email, role: user.role };
  const sessionCookie = await createSessionCookie(env, sessionUser);
  const headers = new Headers({ Location: "/admin" });
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

export function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": clearCookie(SESSION_COOKIE),
    },
  });
}

async function sendInviteEmail(env, { to, invitedBy, loginUrl }) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY not set" };
  }
  const from = env.INVITE_FROM_EMAIL || "Sue's Nails <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "You're invited to Sue's Nails booking admin",
      html: `<p>Hi,</p>
<p>${escapeHtml(invitedBy || "The salon owner")} invited you to the Sue's Nails booking admin.</p>
<p>Sign in with <strong>this same Google email</strong> (${escapeHtml(to)}):</p>
<p><a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p>
<p>If you weren't expecting this, you can ignore the email.</p>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Resend error", text);
    return { sent: false, reason: "Email provider error" };
  }
  return { sent: true };
}

export async function adminListUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, role, status, invited_at, invited_by, accepted_at, last_login_at
     FROM admin_users ORDER BY invited_at DESC, id DESC`
  ).all();
  return json({ users: results });
}

export async function adminInviteUser(env, request, actor) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const email = normalizeEmail(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest("A valid email is required");
  }
  const role = body.role === "employee" ? "employee" : "admin";
  const existing = await env.DB.prepare("SELECT id, status FROM admin_users WHERE email = ?")
    .bind(email)
    .first();
  if (existing && existing.status === "active") {
    return badRequest("That user already has access");
  }
  if (existing && existing.status === "disabled") {
    return badRequest("That user is disabled. Re-enable them before inviting again.");
  }

  const now = Date.now();
  const token = randomToken(18);
  if (existing) {
    await env.DB.prepare(
      `UPDATE admin_users
       SET role = ?, status = 'invited', invite_token = ?, invited_at = ?, invited_by = ?
       WHERE id = ?`
    )
      .bind(role, token, now, actor.email, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO admin_users (email, role, status, invite_token, invited_at, invited_by)
       VALUES (?, ?, 'invited', ?, ?, ?)`
    )
      .bind(email, role, token, now, actor.email)
      .run();
  }

  const loginUrl = `${originFrom(request, env)}/admin/login`;
  const mail = await sendInviteEmail(env, {
    to: email,
    invitedBy: actor.email,
    loginUrl,
  });

  return json(
    {
      ok: true,
      email,
      email_sent: mail.sent,
      email_note: mail.sent
        ? "Invite email sent."
        : `Invite saved, but email was not sent (${mail.reason || "unknown"}). Share the login link manually: ${loginUrl}`,
      login_url: loginUrl,
    },
    201
  );
}

export async function adminUpdateUser(env, id, request, actor) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const user = await env.DB.prepare("SELECT * FROM admin_users WHERE id = ?").bind(id).first();
  if (!user) return json({ error: "User not found" }, 404);
  if (normalizeEmail(user.email) === normalizeEmail(actor.email) && body.status === "disabled") {
    return badRequest("You can't disable your own account");
  }

  const sets = [];
  const binds = [];
  if (body.status === "disabled" || body.status === "invited" || body.status === "active") {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (body.role === "admin" || body.role === "employee") {
    sets.push("role = ?");
    binds.push(body.role);
  }
  if (!sets.length) return badRequest("Nothing to update");
  binds.push(id);
  await env.DB.prepare(`UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

/** Soft-launch Basic Auth for the public booking preview page only. */
export function checkBasicAuth(request, env) {
  const expectedUser = env.ADMIN_USERNAME;
  const expectedPass = env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  const user = idx === -1 ? decoded : decoded.slice(0, idx);
  const pass = idx === -1 ? "" : decoded.slice(idx + 1);
  return (
    timingSafeEqual(user.toLowerCase(), expectedUser.toLowerCase()) &&
    timingSafeEqual(pass, expectedPass)
  );
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export function unauthorizedBasic() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Sue\'s Nails", charset="UTF-8"' },
  });
}

export function unauthorizedJson() {
  return json({ error: "Authentication required" }, 401);
}
