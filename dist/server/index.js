const fallbackBody = "WatchParty est en cours de chargement.";
const roomCodePattern = /^[A-Z0-9]{4,6}$/;
let schemaPromise;

const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const readJson = async (request) => { try { return await request.json(); } catch (_) { return {}; } };

const ensureSchema = async (db) => {
  if (!schemaPromise) {
    schemaPromise = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, host_name TEXT, host_picture TEXT, guest_name TEXT, guest_picture TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS room_events (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, participant_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS room_events_room_id ON room_events (room_code, id)"),
    ]).catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
};

const roomState = async (db, code, after = 0) => {
  const room = await db.prepare("SELECT code, created_at, host_name, host_picture, guest_name, guest_picture FROM rooms WHERE code = ?1").bind(code).first();
  const events = await db.prepare("SELECT id, participant_id, event_type, payload, created_at FROM room_events WHERE room_code = ?1 AND id > ?2 ORDER BY id ASC LIMIT 100").bind(code, after).all();
  return {
    room: room ? { code: room.code, createdAt: room.created_at, host: room.host_name ? { name: room.host_name, picture: room.host_picture || "" } : null, guest: room.guest_name ? { name: room.guest_name, picture: room.guest_picture || "" } : null } : null,
    events: (events.results || []).map((event) => ({ id: event.id, participantId: event.participant_id, type: event.event_type, payload: JSON.parse(event.payload || "{}"), createdAt: event.created_at })),
  };
};

const handleRoomApi = async (request, env, pathname, searchParams) => {
  if (!env?.DB) return json({ error: "Room storage is not configured." }, 503);
  const code = pathname.split("/")[3]?.toUpperCase() || "";
  if (!roomCodePattern.test(code)) return json({ error: "Invalid room code." }, 400);
  await ensureSchema(env.DB);

  if (request.method === "POST" && pathname.endsWith("/join")) {
    const body = await readJson(request);
    const role = body.role === "guest" ? "guest" : "host";
    const user = body.user || {};
    const name = String(user.name || "Invité").slice(0, 80);
    const picture = String(user.picture || "").slice(0, 500);
    const columnName = role === "guest" ? "guest_name" : "host_name";
    const columnPicture = role === "guest" ? "guest_picture" : "host_picture";
    await env.DB.prepare(`INSERT INTO rooms (code, created_at, ${columnName}, ${columnPicture}) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(code) DO UPDATE SET ${columnName} = excluded.${columnName}, ${columnPicture} = excluded.${columnPicture}`).bind(code, Date.now(), name, picture).run();
    return json(await roomState(env.DB, code));
  }

  if (request.method === "POST" && pathname.endsWith("/events")) {
    const body = await readJson(request);
    const participantId = String(body.participantId || "").slice(0, 120);
    const type = String(body.type || "").slice(0, 40);
    if (!participantId || !type) return json({ error: "Missing event fields." }, 400);
    await env.DB.prepare("INSERT INTO room_events (room_code, participant_id, event_type, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(code, participantId, type, JSON.stringify(body.payload || {}), Date.now()).run();
    return json({ ok: true });
  }

  if (request.method === "GET" && pathname.endsWith("/state")) {
    return json(await roomState(env.DB, code, Number(searchParams.get("after") || 0)));
  }

  return json({ error: "Not found." }, 404);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/rooms/")) {
      try { return await handleRoomApi(request, env, url.pathname, url.searchParams); } catch (error) { return json({ error: "Room service unavailable.", detail: String(error?.message || error) }, 503); }
    }
    if (!env?.ASSETS?.fetch) return new Response(fallbackBody, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    return env.ASSETS.fetch(request);
  },
};
