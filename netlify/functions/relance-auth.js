// RELANCE+ : comptes indépendants (e-mail + mot de passe + Google Authenticator).
// Stockage : Netlify Blobs (privé au site). Aucun mot de passe tiers (Veo, moteur) n'est stocké ici.
const crypto = require("crypto");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");

/* ---------- Base32 + TOTP (RFC 6238, SHA-1, 30 s, 6 chiffres) ---------- */
function b32enc(buf) { let bits = 0, v = 0, o = ""; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; } if (bits > 0) o += B32[(v << (5 - bits)) & 31]; return o; }
function b32dec(s) { let bits = 0, v = 0; const out = []; for (const ch of String(s).replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } v &= (1 << bits) - 1; } return Buffer.from(out); }
function hotp(key, counter) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac("sha1", key).update(b).digest(); const o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0"); }
function totpStep(secretB32, code, lastStep, now = Date.now()) { const key = b32dec(secretB32), step = Math.floor(now / 30000); for (let d = -1; d <= 1; d++) { const s = step + d; if (s <= (lastStep || 0)) continue; if (hotp(key, s) === code) return s; } return 0; }

/* ---------- stockage ---------- */
async function store(event) {
  if (global.__CLARA_STORE) return global.__CLARA_STORE;
  const blobs = await import("@netlify/blobs");
  if (event && event.blobs && blobs.connectLambda) blobs.connectLambda(event);
  return blobs.getStore("clara");
}
async function getSecret(st) {
  if (process.env.CLARA_SECRET) return crypto.createHash("sha256").update(process.env.CLARA_SECRET).digest();
  let m = await st.get("meta/secret", { type: "json" });
  if (!m || !m.k) { m = { k: crypto.randomBytes(32).toString("hex") }; await st.setJSON("meta/secret", m); }
  return Buffer.from(m.k, "hex");
}
const enc = (key, text) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv), d = Buffer.concat([c.update(text, "utf8"), c.final()]); return [iv, c.getAuthTag(), d].map((x) => x.toString("base64")).join("."); };
const dec = (key, s) => { const [iv, tag, d] = s.split(".").map((x) => Buffer.from(x, "base64")), c = crypto.createDecipheriv("aes-256-gcm", key, iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString("utf8"); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function sign(key, payload) { const p = b64u(JSON.stringify(payload)); return p + "." + b64u(crypto.createHmac("sha256", key).update(p).digest()); }
function verify(key, tok) { const [p, s] = String(tok || "").split("."); if (!p || !s) return null; const ok = safeEq(b64u(crypto.createHmac("sha256", key).update(p).digest()), s); if (!ok) return null; try { const d = JSON.parse(Buffer.from(p, "base64url").toString()); return d.exp * 1000 > Date.now() ? d : null; } catch (e) { return null; } }

const J = (status, body) => ({ statusCode: status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
const okPw = (p) => typeof p === "string" && p.length >= 8 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);
const GENERIC = "Identifiants ou code incorrects.";

async function lockState(st, k) { const l = (await st.get("lock/" + k, { type: "json" })) || { n: 0, until: 0 }; return l; }
async function fail(st, k) { const l = await lockState(st, k); l.n = (l.until && l.until < Date.now() ? 0 : l.n) + 1; if (l.n >= 5) { l.until = Date.now() + 15 * 60000; l.n = 0; } await st.setJSON("lock/" + k, l); }
const clearLock = (st, k) => st.delete("lock/" + k);

function session(key, user, remember) { const ttl = remember ? 30 * 86400 : 12 * 3600, iat = Math.floor(Date.now() / 1000); return { token: sign(key, { sub: sha(user.email), e: user.email, role: user.role || "user", iat, exp: iat + ttl }), exp: iat + ttl }; }
function otpauth(email, secret) { return "otpauth://totp/" + encodeURIComponent("RELANCE+:" + email) + "?secret=" + secret + "&issuer=RELANCE%2B&algorithm=SHA1&digits=6&period=30"; }

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return J(405, { message: "Méthode non autorisée" });
  let q; try { q = JSON.parse(event.body || "{}"); } catch (e) { return J(400, { message: "Requête invalide" }); }
  let st; try { st = await store(event); } catch (e) { return J(500, { message: "Stockage indisponible : installez la dépendance @netlify/blobs (voir LISEZ-MOI)." }); }
  const key = await getSecret(st), email = String(q.email || "").trim().toLowerCase(), uk = "u/" + sha(email);

  if (q.action === "config") return J(200, { invite: !!process.env.RELANCE_INVITE });
  if (q.action === "verify") { const d = verify(key, q.token); return d ? J(200, { ok: true, email: d.e, exp: d.exp }) : J(401, { ok: false }); }

  if (!okEmail(email)) return J(400, { message: "Adresse e-mail invalide." });

  if (q.action === "register") {
    if (!okPw(q.password)) return J(400, { message: "Mot de passe : 8 caractères minimum, avec au moins une lettre et un chiffre." });
    if (process.env.RELANCE_INVITE && !safeEq(q.invite || "", process.env.RELANCE_INVITE)) return J(403, { message: "Code d’invitation incorrect." });
    const old = await st.get(uk, { type: "json" });
    if (old && old.status === "active") return J(409, { message: "Un compte existe déjà avec cette adresse. Connectez-vous." });
    const first = !(await st.get("meta/first", { type: "json" })), secret = b32enc(crypto.randomBytes(20)), salt = crypto.randomBytes(16).toString("hex");
    await st.setJSON(uk, { email, name: String(q.name || "").slice(0, 80), salt, hash: hashPw(q.password, salt), totp: enc(key, secret), status: "pending", lastStep: 0, recovery: [], created: Date.now(), role: first ? "admin" : "user" });
    return J(200, { secret, otpauth: otpauth(email, secret) });
  }

  const u = await st.get(uk, { type: "json" }), lk = sha(email), l = await lockState(st, lk);
  if (l.until && l.until > Date.now()) return J(429, { message: "Trop de tentatives. Réessayez dans quelques minutes." });
  const pwOk = u && safeEq(hashPw(String(q.password || ""), u.salt), u.hash);
  const code = String(q.code || "").replace(/\s/g, "");

  if (q.action === "reset") {
    // Mot de passe oublié : exige le code Authenticator (ou un code de secours) puis fixe le nouveau mot de passe.
    if (!u || u.status !== "active") { await fail(st, lk); return J(401, { message: GENERIC }); }
    if (!okPw(q.newPassword)) return J(400, { message: "Mot de passe : 8 caractères minimum, avec au moins une lettre et un chiffre." });
    const dg = code.replace(/\D/g, ""); let good = false;
    if (/^\d{6}$/.test(dg)) { const step = totpStep(dec(key, u.totp), dg, u.lastStep); if (step) { u.lastStep = step; good = true; } }
    else if (/^[0-9A-Fa-f]{10}$/.test(code)) { const h = sha(code.toUpperCase()), i = (u.recovery || []).indexOf(h); if (i >= 0) { u.recovery.splice(i, 1); good = true; } }
    if (!good) { await fail(st, lk); return J(401, { message: GENERIC }); }
    u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPw(q.newPassword, u.salt);
    await st.setJSON(uk, u); await clearLock(st, lk);
    return J(200, { ok: true });
  }

  if (q.action === "confirm") {
    if (!u || u.status !== "pending" || !pwOk) { await fail(st, lk); return J(400, { message: "Inscription introuvable ou déjà activée." }); }
    const step = totpStep(dec(key, u.totp), code.replace(/\D/g, ""), 0);
    if (!step) { await fail(st, lk); return J(400, { message: "Code incorrect. Vérifiez l’heure de votre téléphone et réessayez." }); }
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
    u.status = "active"; u.lastStep = step; u.recovery = codes.map((c) => sha(c)); await st.setJSON(uk, u);
    if (u.role === "admin") await st.setJSON("meta/first", { email, at: Date.now() });
    await clearLock(st, lk);
    return J(200, { ...session(key, u, !!q.remember), recovery: codes });
  }

  if (q.action === "login") {
    if (!u || u.status !== "active" || !pwOk) { await fail(st, lk); return J(401, { message: GENERIC }); }
    const digits = code.replace(/\D/g, "");
    let good = false;
    if (/^\d{6}$/.test(digits)) { const step = totpStep(dec(key, u.totp), digits, u.lastStep); if (step) { u.lastStep = step; good = true; } }
    else if (/^[0-9A-Fa-f]{10}$/.test(code)) { const h = sha(code.toUpperCase()), i = (u.recovery || []).indexOf(h); if (i >= 0) { u.recovery.splice(i, 1); good = true; } }
    if (!good) { await fail(st, lk); return J(401, { message: GENERIC }); }
    await st.setJSON(uk, u); await clearLock(st, lk);
    return J(200, { ...session(key, u, !!q.remember), recoveryLeft: (u.recovery || []).length });
  }
  return J(400, { message: "Action inconnue." });
};
exports._totp = { b32enc, b32dec, hotp, totpStep };
