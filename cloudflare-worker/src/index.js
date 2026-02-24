export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.slice(1);
    const AUTH_TOKEN = env.AUTH_TOKEN;
    const authHeader = request.headers.get("Authorization");

    if (request.method === "GET") {
      const isListRequest = url.searchParams.get("list") === "1";
      if (isListRequest) {
        if (!AUTH_TOKEN || authHeader !== `Bearer ${AUTH_TOKEN}`) {
          return new Response("Unauthorized", {
            status: 401,
            headers: corsHeaders
          });
        }

        const prefix = url.searchParams.get("prefix");
        if (!prefix) {
          return new Response(JSON.stringify({ error: "Missing prefix query parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
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

          return new Response(JSON.stringify({ keys }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e?.message || "Failed to list objects" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      const object = await env.MY_BUCKET.get(path);
      if (object === null) {
        return new Response("Object Not Found", {
          status: 404,
          headers: corsHeaders
        });
      }

      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=3600");

      return new Response(object.body, { headers });
    }

    // Check Auth for PUT/DELETE
    if (!AUTH_TOKEN || authHeader !== `Bearer ${AUTH_TOKEN}`) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders
      });
    }

    if (request.method === "PUT") {
      try {
        await env.MY_BUCKET.put(path, request.body, {
          httpMetadata: {
            contentType: request.headers.get("Content-Type") || "application/octet-stream",
          }
        });
        return new Response(JSON.stringify({ success: true, key: path }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(e.message, {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    if (request.method === "DELETE") {
      await env.MY_BUCKET.delete(path);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  },
};
