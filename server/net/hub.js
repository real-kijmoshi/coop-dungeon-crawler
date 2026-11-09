// Minimal WebSocket + JSON transport.
//
// Protocol (JSON text, plus opt-in binary compressed snapshots):
//   client -> server  {"t":"auth","d":{"username":"..","password":".."}}   (first frame)
//   server -> client  {"t":"welcome"}  or  {"t":"error","d":"reason"} + close
//   client -> server  {"t":"<event>","a":[...args],"id":7}   ("id" only when a reply is wanted)
//   server -> client  {"t":"<event>","d":<data>}
//   server -> client  {"t":"reply","id":7,"d":<data>}
// Auth may advertise features:["state-deflate-v1"]. Snapshot binary frames then
// contain ASCII "CDC1" followed by raw DEFLATE of the usual JSON gameState.
const { EventEmitter } = require("events");
const { WebSocketServer } = require("ws");
const { deflateRaw } = require("node:zlib");
const STATE_MAGIC = Buffer.from("CDC1");

const AUTH_TIMEOUT_MS = 10000;
const PING_MS = 25000;

class Conn extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.user = null;
    this.statePending = null;
    this.stateSending = false;
    this.stateRetry = null;
    this.stateCompression = false;
    ws.on("close", () => {
      clearTimeout(this.stateRetry);
      this.statePending = null;
    });
  }

  // Send an event to this client (same shape as socket.io's emit).
  emit(event, data) {
    if (event === "disconnect") return super.emit(event);
    if (this.ws.readyState !== this.ws.OPEN) return false;
    this.ws.send(JSON.stringify(data === undefined ? { t: event } : { t: event, d: data }));
    return true;
  }

  // Snapshots replace each other; replies, chat, loot and combat events do not.
  // Build the newest state only when the previous write has drained, rather
  // than serializing and queueing every intermediate world update.
  sendState(build) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.statePending = build;
    this.flushState();
  }

  flushState() {
    if (this.stateSending || this.stateRetry || !this.statePending) return;
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > 16 * 1024) {
      this.stateRetry = setTimeout(() => {
        this.stateRetry = null;
        this.flushState();
      }, 25);
      return;
    }
    const build = this.statePending;
    this.statePending = null;
    const data = build();
    if (!data) return; // Player disconnected while this snapshot was pending.
    this.stateSending = true;
    const raw = JSON.stringify({ t: "gameState", d: data });
    const done = (err) => {
      this.stateSending = false;
      if (err) this.ws.terminate();
      else this.flushState();
    };
    // Some tunnel paths do not negotiate permessage-deflate. Compress inside
    // our protocol so the saving survives any transparent WebSocket proxy.
    // Only one compression/write per connection can be in flight at a time.
    if (this.stateCompression && Buffer.byteLength(raw) >= 1024) {
      deflateRaw(raw, { level: 1 }, (err, compressed) => {
        if (err) return done(err);
        if (this.ws.readyState !== this.ws.OPEN) {
          this.stateSending = false;
          return;
        }
        this.ws.send(Buffer.concat([STATE_MAGIC, compressed]), { binary: true, compress: false }, done);
      });
    } else {
      this.ws.send(raw, done);
    }
  }

  // Dispatch an incoming client event to handlers registered with on().
  dispatch(msg) {
    const args = Array.isArray(msg.a) ? msg.a.slice(0, 4) : [];
    if (msg.id !== undefined && msg.id !== null) {
      const id = msg.id;
      args.push((data) => {
        if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ t: "reply", id, d: data }));
      });
    }
    try {
      super.emit(msg.t, ...args);
    } catch (err) {
      console.error(`Error handling "${msg.t}":`, err);
    }
  }

  disconnect() {
    this.ws.close();
  }
}

/**
 * Attach a WebSocket hub to an HTTP server at /ws.
 * @param {http.Server} server
 * @param {(creds) => user|null} authenticate
 * @param {(conn: Conn) => void} onConnection
 */
const createHub = (server, { authenticate, onConnection }) => {
  const wss = new WebSocketServer({
    server, path: "/ws", maxPayload: 16 * 1024,
    perMessageDeflate: {
      // Gorilla supports compression without context takeover. Keep small
      // events cheap and compress the repetitive JSON/grid in snapshots.
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: 1024,
      concurrencyLimit: 4,
      zlibDeflateOptions: { level: 1 },
    },
  });
  const conns = new Set();

  wss.on("connection", (ws) => {
    const conn = new Conn(ws);
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    const authTimer = setTimeout(() => {
      if (!conn.user) {
        conn.emit("error", "Authentication timed out");
        ws.close();
      }
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;

      if (!conn.user) {
        if (msg.t !== "auth") return;
        const user = authenticate(msg.d || {});
        clearTimeout(authTimer);
        if (!user) {
          conn.emit("error", "Invalid credentials");
          ws.close();
          return;
        }
        conn.user = user;
        conn.stateCompression = Array.isArray(msg.features) && msg.features.includes("state-deflate-v1");
        conns.add(conn);
        conn.emit("welcome");
        onConnection(conn);
        return;
      }
      conn.dispatch(msg);
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (conns.delete(conn)) conn.emit("disconnect");
    });
    ws.on("error", () => {});
  });

  // Drop dead connections.
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_MS);
  wss.on("close", () => clearInterval(pinger));
  server.on("close", () => wss.close());

  return {
    broadcast(event, data) {
      for (const c of conns) c.emit(event, data);
    },
    size: () => conns.size,
  };
};

module.exports = { createHub, Conn };
