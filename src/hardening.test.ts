import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { extractGatewayClientId, readCapped } from "./auth.js";

// Spy on the Node adapter so the test sees exactly what the SDK handler is given.
const seen: (string | string[] | undefined)[] = [];
vi.mock("@modelcontextprotocol/node", async (orig) => {
  const real = await orig<typeof import("@modelcontextprotocol/node")>();
  return {
    ...real,
    toNodeHandler: (...a: Parameters<typeof real.toNodeHandler>) => {
      const h = real.toNodeHandler(...a);
      return (req: any, res: any) => (seen.push(req.headers.authorization), h(req, res));
    },
  };
});
const { createApp } = await import("./server.js");

let open: Server | undefined;
afterEach(() => void open?.close());

// 100 chunks of 3 bytes; counts how many the reader pulled and whether it cancelled.
function source() {
  const st = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(c) { st.pulls++; st.pulls <= 100 ? c.enqueue(new Uint8Array(3).fill(1)) : c.close(); },
    cancel() { st.cancelled = true; },
  }, { highWaterMark: 0 });
  return { st, res: new Response(body) };
}

describe("readCapped", () => {
  it("reads exactly limit+1 bytes from a multi-chunk body, then stops", async () => {
    const { st, res } = source();
    expect((await readCapped(res, 6)).length).toBe(7);
    expect(st.pulls).toBe(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(st.cancelled).toBe(true);
  });

  it("counts bytes, not characters, for multi-byte UTF-8", async () => {
    const body = new TextEncoder().encode("æ".repeat(10)); // 20 bytes, 10 characters
    expect((await readCapped(new Response(body), 5)).length).toBe(6);
  });

  it("returns a short body whole", async () => {
    expect((await readCapped(new Response("abc"), 5)).length).toBe(3);
  });
});

describe("SDK handler", () => {
  it("never sees the Authorization header", async () => {
    const user = { active: true, idtyp: "user", NAVident: "Z123456", azp: "gw" };
    const { server } = createApp({
      introspectionEndpoint: "http://texas/introspect", exchangeEndpoint: "http://texas/token", gatewayClientId: "gw",
      downstreamUrl: "http://d", downstreamScope: "s", fetch: (async () => Response.json(user)) as typeof fetch,
    });
    open = server.listen(0);
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
      method: "POST", body: "{}",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer inbound-token" },
    });
    await res.text();
    expect(seen).toEqual([undefined]);
  });
});

describe("malformed AZURE_APP_PRE_AUTHORIZED_APPS", () => {
  it("answers 503 on a request", async () => {
    const { server } = createApp({
      introspectionEndpoint: "http://texas/introspect", exchangeEndpoint: "http://texas/token",
      gatewayClientId: extractGatewayClientId("{not json", "dev-gcp"),
      downstreamUrl: "http://d", downstreamScope: "s", fetch: (async () => Response.json({ active: true })) as typeof fetch,
    });
    open = server.listen(0);
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
      method: "POST", body: "{}", headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(503);
  });
});
