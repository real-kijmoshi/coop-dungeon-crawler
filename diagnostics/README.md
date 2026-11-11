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

## Recorded results — 9 November 2026

Real Quick Tunnels, not a simulated link. Both tests used four synthetic heroes, 20 snapshots/s, movement every 150 ms, reliable probes every 250 ms, and two 30-second rounds per public tunnel. The baseline runner was Azure `westus`; the fixed-code runner was `westus2`. Clients and origin ran on the same runner in each test. These measurements do not establish latency from Poland or long-session availability.

| Public path | Application codec | Native WebSocket compression | Total received traffic | Median probe RTT | p95 probe RTT | Disconnects |
| --- | --- | --- | --- | --- | --- | --- |
| HTTP/2 before | Off | Not negotiated | 408.3–410.1 KiB/s | 8.3–8.9 ms | 13.0–15.3 ms | 0 |
| Automatic before (QUIC) | Off | Not negotiated | 408.8 KiB/s | 9.3–9.6 ms | 15.9–17.1 ms | 0 |
| HTTP/2 after | DEFLATE v1 | Not negotiated | 72.0–72.1 KiB/s | 13.4–15.3 ms | 16.8–21.4 ms | 0 |
| Automatic after (QUIC) | DEFLATE v1 | Not negotiated | 72.0–72.1 KiB/s | 14.4 ms | 18.3–19.4 ms | 0 |

All cases sustained approximately 20 updates/s per player. The new codec cut total received game traffic by about 82% on the measured workload despite the absence of WebSocket extension compression. The separate runners/routes mean RTT differences between before and after are not a controlled comparison of codec overhead.

This supports keeping Cloudflare as an account-free convenience option after fixing application compression. It does not prove that a particular home ISP path is fast, or that Quick Tunnels provide permanent addresses or uptime guarantees. A stable server identity/invite code remains a separate feature.

Raw measurements: [before](reports/cloudflare-before.json), [after](reports/cloudflare-after.json). Source runs: [before](https://github.com/real-kijmoshi/coop-dungeon-crawler/actions/runs/42678290529), [after](https://github.com/real-kijmoshi/coop-dungeon-crawler/actions/runs/42679492614).
