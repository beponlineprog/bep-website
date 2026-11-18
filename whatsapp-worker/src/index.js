const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
    }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "https://beponlineprog.github.io")
    .split(",").map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function getBearer(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyAdmin(request, env) {
  const token = getBearer(request);
  if (!token) throw new Error("Administrator sign-in is required.");

  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" +
      encodeURIComponent(env.FIREBASE_API_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.users) || !data.users[0]) {
    throw new Error("Your administrator session is invalid or expired. Please sign in again.");
  }

  if (data.users[0].localId !== env.ADMIN_UID) {
    throw new Error("Access denied. This account is not an authorised B.E.P. administrator.");
  }
  return token;
}

function firestoreValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ("mapValue" in value) return firestoreFields(value.mapValue.fields || {});
  return null;
}

function firestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    result[key] = firestoreValue(value);
  }
  return result;
}

async function loadMembers(token, env) {
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const base = "https://firestore.googleapis.com/v1/projects/" + project +
    "/databases/(default)/documents/members";
  let pageToken = "";
  const members = [];

  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      headers: { "Authorization": "Bearer " + token }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data.error && data.error.message ? data.error.message : "Firestore request failed.";
      throw new Error("Could not verify member consent from Firestore: " + reason);
    }

    for (const document of data.documents || []) {
      const id = String(document.name || "").split("/").pop();
      members.push({ id, ...firestoreFields(document.fields || {}) });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return members;
}

function normalizeSouthAfricanPhone(raw) {
  let phone = String(raw || "").replace(/[\s()+.-]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = "27" + phone.slice(1);
  if (!phone.startsWith("27")) return "";
  if (!/^27\d{9}$/.test(phone)) return "";
  return phone;
}

function eligibleMembers(members) {
  return members
    .filter(member =>
      String(member.status || "").toLowerCase() === "active" &&
      member.whatsappOptIn === true &&
      normalizeSouthAfricanPhone(member.phone)
    )
    .map(member => ({
      id: member.id,
      fullName: String(member.fullName || "B.E.P. Member").trim().slice(0, 100),
      memberNumber: String(member.memberNumber || ""),
      phone: normalizeSouthAfricanPhone(member.phone)
    }));
}

async function sendTemplateMessage(member, env) {
  const version = String(env.META_GRAPH_API_VERSION || "v23.0").replace(/^\/+|\/+$/g, "");
  const url = "https://graph.facebook.com/" + version + "/" +
    encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID) + "/messages";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: member.phone,
      type: "template",
      template: {
        name: env.WHATSAPP_TEMPLATE_NAME || "bep_member_announcement",
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: member.fullName || "B.E.P. Member" }]
        }]
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error && data.error.message ? data.error.message : "Meta rejected this message.";
    throw new Error(detail);
  }
  const messageId = data.messages && data.messages[0] ? data.messages[0].id : "";
  return messageId;
}

async function handle(request, env) {
  const origin = allowedOrigin(request, env);
  const requestOrigin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    if (requestOrigin && !origin) return json({ ok: false, error: "Origin not allowed." }, 403);
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}) }
    });
  }
  if (requestOrigin && !origin) return json({ ok: false, error: "Origin not allowed." }, 403);

  const url = new URL(request.url);
  if (url.pathname !== "/admin/whatsapp/recipients" &&
      url.pathname !== "/admin/whatsapp/send" &&
      url.pathname !== "/admin/whatsapp/connection-test" &&
      url.pathname !== "/") {
    return json({ ok: false, error: "Not found." }, 404, origin);
  }

  try {
    const token = await verifyAdmin(request, env);

    // Secure Meta connection diagnostic: administrator authentication is required.
    // This checks the WhatsApp phone-number endpoint without sending a message.
    if (url.pathname === "/admin/whatsapp/connection-test") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405, origin);
      }

      try {
        const version = String(env.META_GRAPH_API_VERSION || "v23.0")
          .replace(/^\\/+|\\/+$/g, "");
        const response = await fetch(
          "https://graph.facebook.com/" + version + "/" +
            encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID) +
            "?fields=id,display_phone_number,verified_name",
          {
            headers: {
              "Authorization": "Bearer " + env.WHATSAPP_ACCESS_TOKEN
            }
          }
        );

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return json({
            ok: false,
            connection: "failed",
            error: data.error && data.error.message
              ? data.error.message
              : "Meta connection failed."
          }, 502, origin);
        }

        return json({
          ok: true,
          connection: "connected",
          phoneNumberId: data.id || "",
          displayPhoneNumber: data.display_phone_number || "",
          verifiedName: data.verified_name || ""
        }, 200, origin);
      } catch (error) {
        return json({
          ok: false,
          connection: "failed",
          error: String(error.message || "Connection test failed.")
        }, 500, origin);
      }
    }

    const members = await loadMembers(token, env);
    const eligible = eligibleMembers(members);

    if (request.method === "GET" && (url.pathname === "/admin/whatsapp/recipients" || url.pathname === "/")) {
      return json({
        ok: true,
        totalEligible: eligible.length,
        recipients: eligible.map(member => ({
          id: member.id,
          fullName: member.fullName,
          memberNumber: member.memberNumber
        }))
      }, 200, origin);
    }

    if (request.method !== "POST" || url.pathname !== "/admin/whatsapp/send") {
      return json({ ok: false, error: "Method not allowed." }, 405, origin);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "A valid JSON request body is required." }, 400, origin); }

    const selectedIds = Array.isArray(body.memberIds)
      ? [...new Set(body.memberIds.map(value => String(value).trim()).filter(Boolean))]
      : [];
    if (!selectedIds.length || selectedIds.length > 50) {
      return json({ ok: false, error: "Select between 1 and 50 members." }, 400, origin);
    }

    const eligibleById = new Map(eligible.map(member => [member.id, member]));
    const selected = selectedIds.map(id => eligibleById.get(id)).filter(Boolean);
    if (selected.length !== selectedIds.length) {
      return json({
        ok: false,
        error: "One or more selected members are no longer active, have not opted in, or have an invalid South African WhatsApp number. Refresh the list and try again."
      }, 409, origin);
    }

    const results = [];
    for (const member of selected) {
      try {
        const messageId = await sendTemplateMessage(member, env);
        results.push({
          memberId: member.id,
          fullName: member.fullName,
          status: "accepted",
          messageId
        });
      } catch (error) {
        results.push({
          memberId: member.id,
          fullName: member.fullName,
          status: "failed",
          error: String(error.message || "Message failed").slice(0, 300)
        });
      }
    }

    const accepted = results.filter(item => item.status === "accepted").length;
    return json({
      ok: true,
      total: results.length,
      accepted,
      failed: results.length - accepted,
      note: "Accepted means Meta accepted the message request. Delivery and read confirmation require a WhatsApp webhook.",
      results
    }, 200, origin);
  } catch (error) {
    const message = String(error.message || "Request failed");
    const status = /Access denied|authorised B\.E\.P\./i.test(message) ? 403 :
      /sign-in|session is invalid/i.test(message) ? 401 : 500;
    return json({ ok: false, error: message }, status, origin);
  }
}

export default {
  async fetch(request, env) {
    const required = [
      "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "ADMIN_UID",
      "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"
    ];
    const missing = required.filter(key => !env[key]);
    if (missing.length) {
      return json({ ok: false, error: "Worker configuration is incomplete. Missing: " + missing.join(", ") }, 500);
    }
    return handle(request, env);
  }
};
