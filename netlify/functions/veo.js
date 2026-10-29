// Relais vers l'API Veo Pro (contourne le CORS). Liste blanche stricte de chemins.
const BASE = "https://veopro.veocameroun.com/api";
const OK_GET = /^\/(cga-subs|cga-subs-commissions|users|transfers|settings|user-notifications|auth\/me)(\/|\?|$)/;
const OK_POST = ["/auth/login", "/auth/logout", "/cga-subs/init/v2", "/cga-subs/confirm/v2", "/transfers/user-balance"];
exports.handler = async (e) => {
  if (e.httpMethod !== "POST") return { statusCode: 405, body: "" };
  let q; try { q = JSON.parse(e.body); } catch { return { statusCode: 400, body: "bad" }; }
  const { path, method = "GET", body, token } = q;
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("..") || path.includes("//")) return { statusCode: 400, body: "path" };
  const m = String(method).toUpperCase();
  const ok = m === "GET" ? OK_GET.test(path) : m === "POST" && OK_POST.includes(path);
  if (!ok) return { statusCode: 403, body: "blocked" };
  const h = { "content-type": "application/json", "accept-language": "fr" };
  if (token) h.authorization = "Bearer " + token;
  const r = await fetch(BASE + path, { method: m, headers: h, body: m === "POST" ? JSON.stringify(body || {}) : undefined });
  const ct = r.headers.get("content-type") || "application/json";
  if (!/json|text/.test(ct)) return { statusCode: r.status, isBase64Encoded: true, headers: { "content-type": ct }, body: Buffer.from(await r.arrayBuffer()).toString("base64") };
  return { statusCode: r.status, headers: { "content-type": "application/json" }, body: (await r.text()) || "{}" };
};
