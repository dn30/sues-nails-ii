import { handleListServices, handleAvailability, handleCreateBooking, json } from "./api.js";
import {
  adminListBookings,
  adminAvailability,
  adminCreateBooking,
  adminPatchBooking,
  adminListServices,
  adminCreateService,
  adminUpdateService,
  adminDeleteService,
  adminListStaff,
  adminCreateStaff,
  adminDeleteStaff,
  adminGetHours,
  adminPutHours,
  adminListClosures,
  adminCreateClosure,
  adminDeleteClosure,
  adminGetSettings,
  adminPutSettings,
} from "./admin-api.js";
import {
  googleAuthConfigured,
  getSessionUser,
  renderLogin,
  startGoogleOAuth,
  handleGoogleCallback,
  handleLogout,
  adminListUsers,
  adminInviteUser,
  adminUpdateUser,
  checkBasicAuth,
  unauthorizedBasic,
  unauthorizedJson,
} from "./auth-google.js";
import widgetJs from "./widget.client.js";
import adminHtml from "./admin.page.html";
import bookingHtml from "./booking.page.html";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Widget JS stays public so the authenticated booking page can load it.
      if (method === "GET" && path === "/widget.js") {
        return new Response(widgetJs, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ---- public API (needed by the widget after soft-launch login) ----
      if (method === "GET" && path === "/api/health") return json({ ok: true });
      if (method === "GET" && path === "/api/services") return handleListServices(env);
      if (method === "GET" && path === "/api/availability") return handleAvailability(env, url);
      if (method === "POST" && path === "/api/bookings") return handleCreateBooking(env, request);

      // ---- Google auth routes for admin (public) ----
      if (method === "GET" && path === "/admin/login") {
        const notice = url.searchParams.get("invited")
          ? "Invite received. Sign in with the same Google email that got the invite."
          : "";
        return renderLogin(request, env, { notice });
      }
      if (method === "GET" && path === "/admin/auth/google") return startGoogleOAuth(request, env);
      if (method === "GET" && path === "/admin/auth/callback") return handleGoogleCallback(request, env);
      if (method === "GET" && path === "/admin/logout") return handleLogout();

      // ---- Admin UI + API: Google session (invite-only) ----
      const adminGated = path === "/admin" || path.startsWith("/api/admin/");
      if (adminGated) {
        let adminUser = null;
        // Local/dev fallback while Google secrets are not configured yet.
        if (!googleAuthConfigured(env)) {
          if (!checkBasicAuth(request, env)) {
            return path.startsWith("/api/") ? unauthorizedJson() : unauthorizedBasic();
          }
          adminUser = {
            email: env.ADMIN_USERNAME || "admin",
            role: "admin",
            status: "active",
          };
        } else {
          adminUser = await getSessionUser(request, env);
          if (!adminUser) {
            if (path.startsWith("/api/")) return unauthorizedJson();
            return Response.redirect(new URL("/admin/login", request.url).toString(), 302);
          }
        }

        if (method === "GET" && path === "/admin") {
          return new Response(adminHtml, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }

        if (method === "GET" && path === "/api/admin/me") {
          return json({
            user: {
              email: adminUser.email,
              role: adminUser.role,
              status: adminUser.status,
            },
            google_auth: googleAuthConfigured(env),
          });
        }

        if (method === "GET" && path === "/api/admin/users") return adminListUsers(env);
        if (method === "POST" && path === "/api/admin/users/invite") {
          return adminInviteUser(env, request, adminUser);
        }
        let um = path.match(/^\/api\/admin\/users\/(\d+)$/);
        if (um && method === "PATCH") {
          return adminUpdateUser(env, +um[1], request, adminUser);
        }

        if (method === "GET" && path === "/api/admin/bookings") return adminListBookings(env, url);
        if (method === "POST" && path === "/api/admin/bookings") return adminCreateBooking(env, request);
        if (method === "GET" && path === "/api/admin/availability") return adminAvailability(env, url);
        let m = path.match(/^\/api\/admin\/bookings\/(\d+)$/);
        if (m && method === "PATCH") return adminPatchBooking(env, +m[1], request);

        if (method === "GET" && path === "/api/admin/services") return adminListServices(env);
        if (method === "POST" && path === "/api/admin/services") return adminCreateService(env, request);
        m = path.match(/^\/api\/admin\/services\/(\d+)$/);
        if (m && method === "PUT") return adminUpdateService(env, +m[1], request);
        if (m && method === "DELETE") return adminDeleteService(env, +m[1]);

        if (method === "GET" && path === "/api/admin/staff") return adminListStaff(env);
        if (method === "POST" && path === "/api/admin/staff") return adminCreateStaff(env, request);
        m = path.match(/^\/api\/admin\/staff\/(\d+)$/);
        if (m && method === "DELETE") return adminDeleteStaff(env, +m[1]);

        if (method === "GET" && path === "/api/admin/hours") return adminGetHours(env);
        if (method === "PUT" && path === "/api/admin/hours") return adminPutHours(env, request);

        if (method === "GET" && path === "/api/admin/closures") return adminListClosures(env);
        if (method === "POST" && path === "/api/admin/closures") return adminCreateClosure(env, request);
        m = path.match(/^\/api\/admin\/closures\/(\d{4}-\d{2}-\d{2})$/);
        if (m && method === "DELETE") return adminDeleteClosure(env, m[1]);

        if (method === "GET" && path === "/api/admin/settings") return adminGetSettings(env);
        if (method === "PUT" && path === "/api/admin/settings") return adminPutSettings(env, request);

        return json({ error: "Not found" }, 404);
      }

      // ---- Soft-launch booking page: Basic Auth (unchanged) ----
      const bookingGated = path === "/booking" || path === "/" || path === "/demo";
      if (bookingGated) {
        if (!checkBasicAuth(request, env)) return unauthorizedBasic();
        if (method === "GET") {
          return new Response(bookingHtml, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
};
