// Public website: landing page, one-line launch/install scripts, client
// downloads, a status API and the `curl <server>/watch` live stream.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { welcome, watchFrame, ESC, RESET } = require("./ansi");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const SCRIPTS_DIR = path.join(__dirname, "scripts");
const DIST_DIR = process.env.CLIENT_DIST || path.join(__dirname, "..", "..", "client", "dist");
const GITHUB_REPO = process.env.GITHUB_REPO || "real-kijmoshi/coop-dungeon-crawler";
const MAX_WATCHERS = 200;
const WATCH_MAX_MS = 30 * 60 * 1000;
const CLIENT_FILES = /^cdc-(linux|darwin|windows)-(amd64|arm64)(\.exe)?$/;

const isTerminal = (req) => /^(curl|wget|httpie|libfetch|fetch)/i.test(req.get("user-agent") || "");

// Public URL of this server, e.g. https://play.example.com
const baseUrl = (req) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
};

const template = (file, vars) => {
  let s = fs.readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(vars)) s = s.split(`__${k}__`).join(v);
  return s;
};

// A version string that changes whenever the hosted client binaries change,
// so launch scripts re-download only when needed.
const clientVersion = () => {
  try {
    const files = fs.readdirSync(DIST_DIR).filter((f) => CLIENT_FILES.test(f)).sort();
    if (!files.length) return "github-latest";
    const h = crypto.createHash("sha1");
    for (const f of files) {
      const st = fs.statSync(path.join(DIST_DIR, f));
      h.update(`${f}:${st.size}:${st.mtimeMs}`);
    }
    return h.digest("hex").slice(0, 12);
  } catch {
    return "github-latest";
  }
};

const register = (app, { world, leaderboard }) => {
  const status = () => ({
    name: "coop-dungeon-crawler",
    players: world.players.size,
    online: Array.from(world.players.values()).map((p) => ({
      username: p.username,
      cls: world.classOf(p).name,
      level: p.stats.level,
      depth: world.tierAt(p.x, p.y),
    })),
    event: world.event ? { name: world.event.name, desc: world.event.desc } : null,
    top: leaderboard().slice(0, 10),
  });

  // Keep the latest server-wide announcements for the live view.
  const news = [];
  world.on("message", ({ to, text, color }) => {
    if (to !== null) return;
    news.push({ text, color });
    if (news.length > 20) news.shift();
  });

  // ---------------------------------------------------------- landing page
  app.get("/", (req, res) => {
    const base = baseUrl(req);
    if (isTerminal(req)) {
      res.type("text/plain; charset=utf-8").send(welcome({ base, online: world.players.size, top: leaderboard() }));
      return;
    }
    res.type("html").send(template(path.join(PUBLIC_DIR, "index.html"), { BASE: base }));
  });
  app.use("/assets", express.static(path.join(PUBLIC_DIR, "assets"), { maxAge: "1h" }));

  app.get("/api/status", (req, res) => res.json(status()));

  // ------------------------------------------------------ one-line scripts
  const script = (file, type) => (req, res) => {
    const base = baseUrl(req);
    res.type(type).set("Cache-Control", "no-store").send(template(path.join(SCRIPTS_DIR, file), { BASE: base, SERVER: base }));
  };
  for (const p of ["/play", "/play.sh"]) app.get(p, script("play.sh", "text/x-shellscript"));
  for (const p of ["/install", "/install.sh"]) app.get(p, script("install.sh", "text/x-shellscript"));
  app.get("/play.ps1", script("play.ps1", "text/plain"));
  app.get("/install.ps1", script("install.ps1", "text/plain"));

  // ------------------------------------------------------------- downloads
  app.get("/dl/version", (req, res) => res.type("text/plain").set("Cache-Control", "no-store").send(clientVersion()));
  app.get("/dl/:file", (req, res) => {
    const file = req.params.file;
    if (!CLIENT_FILES.test(file)) return res.status(404).type("text/plain").send("Unknown file\n");
    const local = path.join(DIST_DIR, file);
    if (fs.existsSync(local)) {
      res.set("Content-Disposition", `attachment; filename="${file}"`);
      return res.sendFile(local);
    }
    // Not built locally: use the latest GitHub release.
    res.redirect(302, `https://github.com/${GITHUB_REPO}/releases/latest/download/${file}`);
  });

  // ------------------------------------------- live view (parrot.live style)
  let watchers = 0;
  app.get("/watch", (req, res) => {
    if (!isTerminal(req)) {
      res.type("text/plain").send(`Open a terminal and run:\n\n  curl ${baseUrl(req)}/watch\n`);
      return;
    }
    if (watchers >= MAX_WATCHERS) {
      res.status(503).type("text/plain").send("Too many spectators right now, try again soon.\n");
      return;
    }
    watchers++;
    const W = Math.max(60, Math.min(200, Number(req.query.w) || 80));
    const H = Math.max(18, Math.min(60, Number(req.query.h) || 24));
    const heroName = typeof req.query.hero === "string" ? req.query.hero.toLowerCase() : null;
    const base = baseUrl(req);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // tell nginx not to buffer the stream
    });
    res.socket.setNoDelay(true);
    res.write(`${ESC}?25l${ESC}2J`); // hide cursor, clear

    let tick = 0;
    let top = leaderboard();
    const started = Date.now();
    const pickTarget = () => {
      const players = Array.from(world.players.values()).sort((a, b) => b.stats.level - a.stats.level);
      if (!players.length) return null;
      if (heroName) {
        const p = players.find((x) => x.username.toLowerCase() === heroName);
        if (p) return p;
      }
      // Rotate through everyone online every 20 seconds.
      return players[Math.floor(Date.now() / 20000) % players.length];
    };

    const timer = setInterval(() => {
      tick++;
      if (tick % 40 === 0) top = leaderboard();
      try {
        res.write(watchFrame({ world, target: pickTarget(), W, H, tick, base, news, top }));
      } catch (err) {
        console.error("watch frame failed:", err);
      }
      if (Date.now() - started > WATCH_MAX_MS) stop(true);
    }, 200);

    let stopped = false;
    const stop = (ended) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      watchers--;
      if (ended) res.end(`${RESET}${ESC}?25h\n\nThanks for watching! Play: curl -fsSL ${base}/play | sh\n`);
    };
    req.on("close", () => stop(false));
  });
};

module.exports = { register };
