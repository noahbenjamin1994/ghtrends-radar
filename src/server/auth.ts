import { appPath, basePathFromUrl } from "../core/paths.js";
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import type { Store } from "../core/store.js";

export interface Identity {
  id: string;
  name: string;
  csrf: string;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");
export function sessionKey(token: string) {
  return "session:" + digest(token);
}
export function safeReturnPath(value: unknown, basePath = "") {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\r\n]/.test(value) &&
    value.length < 2000 &&
    (!basePath ||
      value === basePath ||
      value.startsWith(basePath + "/") ||
      value.startsWith(basePath + "?"))
    ? value
    : appPath("/history", basePath);
}
export function installAuth(app: Express, store: Store) {
  const hosted = process.env.GHTRENDS_HOSTED === "1";
  const endpoint = process.env.LOGTO_ENDPOINT || process.env.LOGTO_URL;
  const appId = process.env.LOGTO_APP_ID || process.env.GHTRENDS_LOGTO_APP_ID;
  const secret =
    process.env.LOGTO_APP_SECRET || process.env.GHTRENDS_LOGTO_APP_SECRET;
  const enabled = !!(endpoint && appId && secret);
  const basePath = process.env.PUBLIC_URL
    ? basePathFromUrl(process.env.PUBLIC_URL)
    : "";
  const origin = process.env.PUBLIC_URL
    ? new URL(process.env.PUBLIC_URL).origin
    : "";
  const base = origin + basePath;
  if (hosted && (!base || !base.startsWith("https://")))
    throw new Error("Hosted mode requires an HTTPS PUBLIC_URL.");
  const cookieName = hosted ? "__Host-ghtrends_session" : "ghtrends_session";
  const transactionName = hosted ? "__Host-ghtrends_login" : "ghtrends_login";
  const cookie = {
    httpOnly: true,
    secure: hosted,
    sameSite: "lax" as const,
    path: "/",
  };
  const readCookie = (q: Request, name: string) =>
    q
      .get("cookie")
      ?.split(/;\s*/)
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || "";
  const user = (q: Request): Identity | null => {
    if (!hosted && !enabled)
      return { id: "local", name: "Local workspace", csrf: "" };
    const token = readCookie(q, cookieName);
    return /^[\w-]{43}$/.test(token)
      ? store.get<Identity>(sessionKey(token))
      : null;
  };
  const requireUser = (q: Request) => {
    const identity = user(q);
    if (!identity)
      throw Object.assign(
        new Error("Sign in to scan and save your research."),
        { status: 401 },
      );
    return identity;
  };
  const isAdmin = (identity: Identity | null) =>
    !!identity &&
    ((!hosted && !enabled && identity.id === "local") ||
      (process.env.GHTRENDS_ADMIN_USER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(identity.id));
  const requireAdmin = (q: Request) => {
    const identity = requireUser(q);
    if (!isAdmin(identity))
      throw Object.assign(new Error("Administrator access required."), {
        status: 403,
      });
    return identity;
  };
  const protect = (q: Request) => {
    const identity = requireUser(q);
    if (hosted || enabled) {
      const origin = q.get("origin");
      if (
        (origin && origin !== new URL(base).origin) ||
        q.get("X-CSRF-Token") !== identity.csrf
      )
        throw Object.assign(
          new Error("Please reload the page and try again."),
          { status: 403 },
        );
    }
    return identity;
  };
  let configuration: Promise<oidc.Configuration> | undefined;
  const config = () => {
    if (!enabled) throw new Error("Sign-in is not configured on this server.");
    return (configuration ||= oidc
      .discovery(
        new URL(endpoint!.replace(/\/$/, "").replace(/(?:\/oidc)?$/, "/oidc")),
        appId!,
        secret!,
        oidc.ClientSecretPost(secret!),
        { timeout: 15 },
      )
      .then((c) => {
        oidc.enableNonRepudiationChecks(c);
        return c;
      })
      .catch((e) => {
        configuration = undefined;
        throw e;
      }));
  };
  const fail = (r: Response, message: string, status = 400) =>
    r
      .status(status)
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>ghtrends sign-in</title><body><h1>Sign-in could not finish</h1><p>${message}</p><p><a href="${appPath("/", basePath)}">Return to ghtrends</a></p></body></html>`,
      );
  app.get("/auth/login", async (q, r) => {
    if (!enabled)
      return fail(r, "Sign-in is not configured on this server.", 503);
    try {
      const c = await config(),
        verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        token = random();
      store.set(
        "login:" + digest(token),
        {
          verifier,
          state,
          nonce,
          returnTo: safeReturnPath(q.query.returnTo, basePath),
        },
        10 * 60000,
      );
      r.cookie(transactionName, token, { ...cookie, maxAge: 10 * 60000 });
      const url = oidc.buildAuthorizationUrl(c, {
        redirect_uri: base + "/auth/callback",
        scope: "openid profile",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      r.set("Cache-Control", "no-store").redirect(url.href);
    } catch {
      return fail(
        r,
        "The identity service is temporarily unavailable. Please try again.",
        503,
      );
    }
  });
  app.get("/auth/callback", async (q, r) => {
    r.set("Cache-Control", "no-store");
    const token = readCookie(q, transactionName);
    r.clearCookie(transactionName, cookie);
    const tx = store.take<{
      verifier: string;
      state: string;
      nonce: string;
      returnTo: string;
    }>("login:" + digest(token));
    if (!tx)
      return fail(r, "This login attempt expired. Please sign in again.");
    try {
      const c = await config();
      const tokens = await oidc.authorizationCodeGrant(
        c,
        new URL(q.originalUrl, base),
        {
          pkceCodeVerifier: tx.verifier,
          expectedState: tx.state,
          expectedNonce: tx.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error("Missing subject");
      let profile: Record<string, unknown> = claims;
      try {
        profile = await oidc.fetchUserInfo(c, tokens.access_token, claims.sub);
      } catch {
        /* Verified identity still works if profile lookup is unavailable. */
      }
      const name = String(
        profile.name ||
          profile.username ||
          profile.preferred_username ||
          claims.name ||
          "Member",
      ).slice(0, 100);
      store.saveUser(claims.sub, name);
      const previous = readCookie(q, cookieName);
      if (previous) store.take(sessionKey(previous));
      const session = random(),
        identity = { id: claims.sub, name, csrf: random() };
      store.set(sessionKey(session), identity, 86400000);
      r.cookie(cookieName, session, { ...cookie, maxAge: 86400000 });
      r.redirect(tx.returnTo);
    } catch {
      return fail(
        r,
        "The login response could not be verified. Please start again.",
      );
    }
  });
  app.post("/auth/logout", (q, r) => {
    try {
      protect(q);
    } catch {
      return r
        .status(403)
        .json({ error: "Please reload the page and try again." });
    }
    store.take(sessionKey(readCookie(q, cookieName)));
    r.clearCookie(cookieName, cookie);
    return r.set("Cache-Control", "no-store").json({ ok: true });
  });
  return { hosted, enabled, user, requireUser, protect, isAdmin, requireAdmin };
}
