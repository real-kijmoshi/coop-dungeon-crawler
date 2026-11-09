# Real tunnel benchmark

This test opens temporary, public Cloudflare Quick Tunnels to a synthetic dungeon. It uses random, in-memory credentials and does not read or change real saves. It closes its clients and tunnel processes when finished.

It compares loopback, the host's current forced HTTP/2 tunnel setting, and Cloudflare's automatic protocol selection. Automatic mode may select QUIC or fall back to HTTP/2; the report records what was actually negotiated.

Each case uses four clients receiving compressed full game snapshots at 20 Hz, movement every 150 ms, and reliable round-trip probes every 250 ms. Connection warmup is excluded. There are two measured rounds per public tunnel.

## Run locally

Install Node.js 22+ and cloudflared, then install the server dependencies if needed:

```sh
cd server
npm ci --ignore-scripts
cd ..
node diagnostics/benchmark-tunnel.cjs --cloudflared=/path/to/cloudflared --duration=30 --rounds=2
```

If cloudflared is on PATH, omit its argument. The benchmark requires direct Internet access for cloudflared. Restricted environments that allow HTTP only through an explicit proxy may prevent the tunnel from starting; that is not a latency result.

Reports and tunnel logs are written to `diagnostics/results/`. The JSON includes median/p95/max application round-trip times, snapshot age, compression negotiation, received bytes, update frequency, and disconnects. WebSocket byte counts exclude IP/TCP/TLS overhead.

## Interpret the results

The public cases really travel through Cloudflare, but both client and origin run on the testing machine. A GitHub runner result does not establish performance from a player's home in Poland or between two different ISPs. Run the same test on the hosting PC to assess its route. This is a short network transport test with synthetic heroes, not a combat, rendering, database, long-session reliability, or ISP saturation test.

A custom tunnel provider has not been benchmarked just because its documentation was reviewed. Do not present documented features as measured performance.

The workflow on the `diagnostics/tunnel-benchmark` branch runs this test without any player credentials or Cloudflare account.
