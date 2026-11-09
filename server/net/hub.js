// Minimal WebSocket + JSON transport.
//
// Protocol (all frames are JSON text):
//   client -> server  {"t":"auth","d":{"username":"..","password":".."}}   (first frame)
//   server -> client  {"t":"welcome"}  or  {"t":"error","d":"reason"} + close
//   client -> server  {"t":"<event>","a":[...args],"id":7}   ("id" only when a reply is wanted)
//   server -> client  {"t":"<event>","d":<data>}
//   server -> client  {"t":"reply","id":7,"d":<data>}
const { EventEmitter } = require("events");
const { WebSocketServer } = require("ws");

const AUTH_TIMEOUT_MS = 10000;
const PING_MS = 25000;

class Conn extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.user = null;
  }

  // Send an event to this client (same shape as socket.io's emit).
  emit(event, data) {
    if (event === "disconnect") return super.emit(event);
    if (this.ws.readyState !== this.ws.OPEN) return false;
    this.ws.send(JSON.stringify(data === undefined ? { t: event } : { t: event, d: data }));
    return true;
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
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
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

  return {
    broadcast(event, data) {
      for (const c of conns) c.emit(event, data);
    },
    size: () => conns.size,
  };
};

module.exports = { createHub };
