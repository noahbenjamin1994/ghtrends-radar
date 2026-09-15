import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
let cached: { token: string; expires: number } | undefined;
export function appJwt(): string {
  const id = process.env.GITHUB_APP_ID || process.env.GHTRENDS_GITHUB_APP_ID;
  const path =
    process.env.GITHUB_PRIVATE_KEY_PATH ||
    process.env.GHTRENDS_GITHUB_PRIVATE_KEY_PATH;
  if (!id || !path)
    throw new Error("GitHub App ID and private key path are required.");
  const encode = (x: unknown) =>
    Buffer.from(JSON.stringify(x)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: id })}`;
  const signature = createSign("RSA-SHA256")
    .update(payload)
    .sign(readFileSync(path), "base64url");
  return `${payload}.${signature}`;
}
export async function githubToken(): Promise<string | undefined> {
  const app = process.env.GITHUB_APP_ID || process.env.GHTRENDS_GITHUB_APP_ID;
  const install =
    process.env.GITHUB_INSTALLATION_ID ||
    process.env.GHTRENDS_GITHUB_INSTALLATION_ID;
  if (!app || !install) return process.env.GITHUB_TOKEN || undefined;
  if (cached && cached.expires > Date.now() + 120000) return cached.token;
  const r = await fetch(
    `https://api.github.com/app/installations/${install}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) throw new Error(`GitHub App authentication failed (${r.status}).`);
  const data = (await r.json()) as { token: string; expires_at: string };
  cached = { token: data.token, expires: Date.parse(data.expires_at) };
  return cached.token;
}
