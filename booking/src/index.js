import { handleListServices, handleAvailability, handleCreateBooking, json } from "./api.js";
import {
  checkAuth,
  unauthorized,
  adminListBookings,
  adminPatchBooking,
  adminListServices,
  adminCreateService,
  adminUpdateService,
  adminDeleteService,
  adminGetHours,
  adminPutHours,
  adminListClosures,
  adminCreateClosure,
  adminDeleteClosure,
  adminGetSettings,
  adminPutSettings,
} from "./admin-api.js";
import widgetJs from "./widget.client.js";
import adminHtml from "./admin.page.html";
import demoHtml from "./demo.page.html";

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
      // ---- static assets ----
      if (method === "GET" && path === "/widget.js") {
        return new Response(widgetJs, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (method === "GET" && (path === "/demo" || path === "/")) {
        return new Response(demoHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      // ---- public API ----
      if (method === "GET" && path === "/api/health") return json({ ok: true });
      if (method === "GET" && path === "/api/services") return handleListServices(env);
      if (method === "GET" && path === "/api/availability") return handleAvailability(env, url);
      if (method === "POST" && path === "/api/bookings") return handleCreateBooking(env, request);

      // ---- admin (basic auth) ----
      if (path === "/admin" || path.startsWith("/api/admin/")) {
        if (!checkAuth(request, env)) return unauthorized();

        if (method === "GET" && path === "/admin") {
          return new Response(adminHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        if (method === "GET" && path === "/api/admin/bookings") return adminListBookings(env, url);
        let m = path.match(/^\/api\/admin\/bookings\/(\d+)$/);
        if (m && method === "PATCH") return adminPatchBooking(env, +m[1], request);

        if (method === "GET" && path === "/api/admin/services") return adminListServices(env);
        if (method === "POST" && path === "/api/admin/services") return adminCreateService(env, request);
        m = path.match(/^\/api\/admin\/services\/(\d+)$/);
        if (m && method === "PUT") return adminUpdateService(env, +m[1], request);
        if (m && method === "DELETE") return adminDeleteService(env, +m[1]);

        if (method === "GET" && path === "/api/admin/hours") return adminGetHours(env);
        if (method === "PUT" && path === "/api/admin/hours") return adminPutHours(env, request);

        if (method === "GET" && path === "/api/admin/closures") return adminListClosures(env);
        if (method === "POST" && path === "/api/admin/closures") return adminCreateClosure(env, request);
        m = path.match(/^\/api\/admin\/closures\/(\d{4}-\d{2}-\d{2})$/);
        if (m && method === "DELETE") return adminDeleteClosure(env, m[1]);

        if (method === "GET" && path === "/api/admin/settings") return adminGetSettings(env);
        if (method === "PUT" && path === "/api/admin/settings") return adminPutSettings(env, request);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
};
