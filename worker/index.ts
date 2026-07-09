/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type RoomRecord = {
  code: string;
  game: unknown;
  claims: Record<string, string>;
  updatedAt: number;
};

const rooms = new Map<string, RoomRecord>();
let roomsTableReady = false;

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function ensureRoomsTable(env: Env) {
  if (!env.DB || roomsTableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS red_rooms (
      code TEXT PRIMARY KEY,
      game_json TEXT NOT NULL,
      claims_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ).run();
  roomsTableReady = true;
}

async function getRoom(env: Env, code: string) {
  await ensureRoomsTable(env);
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT code, game_json, claims_json, updated_at FROM red_rooms WHERE code = ?",
    ).bind(code).first<{
      code: string;
      game_json: string;
      claims_json: string;
      updated_at: number;
    }>();
    if (!row) return null;
    return {
      code: row.code,
      game: JSON.parse(row.game_json),
      claims: JSON.parse(row.claims_json),
      updatedAt: row.updated_at,
    } satisfies RoomRecord;
  }
  return rooms.get(code) ?? null;
}

async function saveRoom(env: Env, room: RoomRecord) {
  await ensureRoomsTable(env);
  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO red_rooms (code, game_json, claims_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         game_json = excluded.game_json,
         claims_json = excluded.claims_json,
         updated_at = excluded.updated_at`,
    ).bind(
      room.code,
      JSON.stringify(room.game),
      JSON.stringify(room.claims),
      room.updatedAt,
    ).run();
    return;
  }
  rooms.set(room.code, room);
}

function assignPlayer(game: unknown, claims: Record<string, string>, clientId: string) {
  if (claims[clientId]) return claims[clientId];
  const players = (game as { players?: Array<{ id: string }> }).players ?? [];
  const claimed = new Set(Object.values(claims));
  const nextPlayer = players.find((player) => !claimed.has(player.id));
  if (!nextPlayer) return null;
  claims[clientId] = nextPlayer.id;
  return nextPlayer.id;
}

async function handleRoomApi(request: Request, url: URL, env: Env) {
  if (url.pathname === "/api/red/rooms" && request.method === "POST") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || !("game" in body) || !("clientId" in body) || typeof body.clientId !== "string") {
      return json({ error: "Missing game state." }, { status: 400 });
    }

    let code = roomCode();
    while (await getRoom(env, code)) code = roomCode();
    const claims: Record<string, string> = {};
    const playerId = assignPlayer(body.game, claims, body.clientId);
    const room = { code, game: body.game, claims, updatedAt: Date.now() };
    await saveRoom(env, room);
    return json({ code, playerId, room });
  }

  const match = url.pathname.match(/^\/api\/red\/rooms\/([A-Z0-9]{5})$/);
  if (!match) return null;

  const code = match[1];
  if (request.method === "GET") {
    const room = await getRoom(env, code);
    if (!room) return json({ error: "Room not found." }, { status: 404 });
    return json(room);
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || !("clientId" in body) || typeof body.clientId !== "string") {
      return json({ error: "Missing client." }, { status: 400 });
    }
    const room = await getRoom(env, code);
    if (!room) return json({ error: "Room not found." }, { status: 404 });
    const playerId = assignPlayer(room.game, room.claims, body.clientId);
    if (!playerId) return json({ error: "Room is full." }, { status: 409 });
    const next = { ...room, updatedAt: Date.now() };
    await saveRoom(env, next);
    return json({ playerId, room: next });
  }

  if (request.method === "PUT") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || !("game" in body)) {
      return json({ error: "Missing game state." }, { status: 400 });
    }
    const room = await getRoom(env, code);
    if (!room) return json({ error: "Room not found." }, { status: 404 });
    await saveRoom(env, { ...room, game: body.game, updatedAt: Date.now() });
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const roomResponse = await handleRoomApi(request, url, env);
    if (roomResponse) return roomResponse;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
