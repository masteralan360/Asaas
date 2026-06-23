function createCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

function getSupabaseConfig(env) {
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey };
}

function isAuthenticatedServiceRequest(request, env) {
  const serviceToken = env.R2_WORKER_SERVICE_TOKEN || env.R2_SERVICE_TOKEN || "";
  const providedToken = request.headers.get("X-R2-Service-Token") || "";

  return Boolean(serviceToken && providedToken && providedToken === serviceToken);
}

async function requireAuthenticatedUser(request, env, corsHeaders) {
  if (isAuthenticatedServiceRequest(request, env)) {
    return { service: true };
  }

  const config = getSupabaseConfig(env);
  if (!config) {
    return {
      response: jsonResponse(
        { error: "R2 worker authentication is not configured" },
        { status: 500, headers: corsHeaders },
      ),
    };
  }

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      response: jsonResponse(
        { error: "Authentication required" },
        { status: 401, headers: corsHeaders },
      ),
    };
  }

  try {
    const authResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: authHeader,
      },
    });

    if (!authResponse.ok) {
      const status = authResponse.status >= 500 ? 502 : 401;
      return {
        response: jsonResponse(
          { error: status === 401 ? "Authentication required" : "Authentication service unavailable" },
          { status, headers: corsHeaders },
        ),
      };
    }

    const user = await authResponse.json();
    if (!user?.id) {
      return {
        response: jsonResponse(
          { error: "Authentication required" },
          { status: 401, headers: corsHeaders },
        ),
      };
    }

    return { user };
  } catch (error) {
    return {
      response: jsonResponse(
        { error: error?.message || "Authentication failed" },
        { status: 502, headers: corsHeaders },
      ),
    };
  }
}

export default {
  async fetch(request, env) {
    const corsHeaders = createCorsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    if (request.method === "GET") {
      const isListRequest = url.searchParams.get("list") === "1";
      if (isListRequest) {
        const authResult = await requireAuthenticatedUser(request, env, corsHeaders);
        if (authResult.response) return authResult.response;

        const prefix = url.searchParams.get("prefix");
        if (!prefix) {
          return jsonResponse(
            { error: "Missing prefix query parameter" },
            { status: 400, headers: corsHeaders },
          );
        }

        try {
          let cursor = undefined;
          const keys = [];

          do {
            const listResult = await env.MY_BUCKET.list({ prefix, cursor });
            for (const object of listResult.objects || []) {
              if (object?.key) {
                keys.push(object.key);
              }
            }
            cursor = listResult.truncated ? listResult.cursor : undefined;
          } while (cursor);

          return jsonResponse({ keys }, { headers: corsHeaders });
        } catch (error) {
          return jsonResponse(
            { error: error?.message || "Failed to list objects" },
            { status: 500, headers: corsHeaders },
          );
        }
      }

      const object = await env.MY_BUCKET.get(path);
      if (object === null) {
        return new Response("Object Not Found", {
          status: 404,
          headers: corsHeaders,
        });
      }

      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      if (/\/printed-invoices\/versions\//i.test(`/${path}`)) {
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\/printed-invoices\/(A4|receipts)\//i.test(`/${path}`)) {
        // Stable QR aliases always represent the latest saved version.
        headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      } else {
        headers.set("Cache-Control", "public, max-age=3600");
      }

      return new Response(object.body, { headers });
    }

    if (request.method === "PUT") {
      const authResult = await requireAuthenticatedUser(request, env, corsHeaders);
      if (authResult.response) return authResult.response;

      try {
        await env.MY_BUCKET.put(path, request.body, {
          httpMetadata: {
            contentType: request.headers.get("Content-Type") || "application/octet-stream",
          },
        });
        return jsonResponse({ success: true, key: path }, { headers: corsHeaders });
      } catch (error) {
        return new Response(error?.message || "Failed to upload object", {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    if (request.method === "DELETE") {
      const authResult = await requireAuthenticatedUser(request, env, corsHeaders);
      if (authResult.response) return authResult.response;

      await env.MY_BUCKET.delete(path);
      return jsonResponse({ success: true }, { headers: corsHeaders });
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  },
};
