// CI only: stands in for Texas so mcp-compliance can run against the example server.
// Answers /introspect and /exchange on 127.0.0.1. Never deployed: the Dockerfile/Nais config do not include it,
// and the server only sees it through NAIS_TOKEN_* env vars that CI sets.
import { createServer } from "node:http";

const claims = {
  "ci-user-token": { active: true, idtyp: "user", NAVident: "Z999999", azp: "ci-gateway" },
  "ci-app-token": { active: true, idtyp: "app", roles: ["access_as_application"], azp: "ci-gateway" },
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const body = JSON.parse(raw || "{}");
    if (req.url === "/introspect") return void res.end(JSON.stringify(claims[body.token] ?? { active: false }));
    if (req.url === "/exchange") return void res.end(JSON.stringify({ access_token: "ci-obo-token" }));
    res.writeHead(404).end("{}");
  });
}).listen(Number(process.env.FAKE_TEXAS_PORT ?? 8099), "127.0.0.1");
