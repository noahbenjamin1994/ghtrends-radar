/** Pricing, Terms, Privacy and Refund pages for the hosted site (English only).
 *
 * Payment providers review these pages: what is sold, the price, renewal and
 * cancellation, refunds, contact, data handling and prohibited use. When the price
 * or refund rules change, change them here; this file is the only place they live.
 */
import type { Express } from "express";

export const BRAND = "Find Blue Ocean";
export const SUPPORT_EMAIL = "support@findblueocean.com";
/** The operator's legal name (passport spelling). Empty hides the line. */
export const OPERATOR = "";
const UPDATED = "November 8, 2026";

export const PLANS = [
  { name: "Free", price: "$0", period: "forever", features: ["10 research runs a day", "Category evidence, repository comparison and watchlist", "Reports saved for 30 days"] },
  { name: "Pro", price: "$19", period: "per month", features: ["100 research runs a day", "Everything in Free", "Priority email support"] },
];

type Doc = { title: string; description: string; sections: [string, string[]][] };
const who = OPERATOR ? `${BRAND} is operated by ${OPERATOR}, an individual. ` : "";
const mail = `email ${SUPPORT_EMAIL}`;

export const LEGAL: Record<"/terms" | "/privacy" | "/refund", Doc> = {
  "/terms": {
    title: "Terms of Service",
    description: `The terms for using ${BRAND}.`,
    sections: [
      ["Who we are", [`${who}${BRAND} is a research tool that measures open-source supply on GitHub against search demand and writes evidence-backed reports. Questions about these terms: ${mail}.`]],
      ["Your account", ["You need an account for research runs and saved reports. Keep your password secret; you are responsible for activity under your account.", "You must be at least 18 years old, or the age of majority where you live, to buy a plan."]],
      ["Plans and billing", ["Plans and prices are listed on the Pricing page in US dollars, excluding tax. Pro is a monthly subscription that renews automatically on the same day each month until you cancel.", "Daily research allowances reset every day and do not carry over. Runs that fail on our side do not count against your allowance.", "Payments are processed by our payment provider. We never see or store your full card number."]],
      ["Cancelling", ["You can cancel at any time from your account page, or by emailing us. Cancelling stops the next renewal; you keep Pro until the end of the period you already paid for.", "Refunds follow our Refund Policy."]],
      ["Acceptable use", ["Do not use the service to break any law, infringe anyone's rights, send spam, or overload the service or the sites it reads from. Do not resell access or automate sign-ups to get more free runs.", "You may not use the service if you are located in, or are a resident of, a country or region subject to comprehensive sanctions, or if you are on a government sanctions list.", "We may suspend or close an account that breaks these rules. If we close a paid account without a breach on your side, we refund the unused part of the current period."]],
      ["Reports are research, not advice", ["Reports are built from public data and AI analysis. They can be incomplete or wrong. Use them as one input to your own decisions; they are not financial, legal or investment advice."]],
      ["Availability and changes", ["We work to keep the service available but do not guarantee uninterrupted service.", "We may update these terms. If a change materially affects you, we tell you by email or on the site before it takes effect."]],
      ["Disclaimer and liability", ["The service is provided as is, without warranties of any kind, to the extent the law allows.", "To the extent the law allows, our total liability for any claim relating to the service is limited to the amount you paid us in the three months before the claim. We are not liable for indirect or consequential losses."]],
      ["Contact", [`Support, billing and legal questions: ${mail}. We reply within two business days.`]],
    ],
  },
  "/privacy": {
    title: "Privacy Policy",
    description: `What ${BRAND} collects, why, and how to have it deleted.`,
    sections: [
      ["Summary", [`${who}We collect only what we need to run the service and bill for it. We do not sell personal data and do not use advertising trackers. Questions or requests: ${mail}.`]],
      ["What we collect", ["Account: the username you sign up with and, if you add one, your email address. Passwords are handled by our sign-in service and stored only as hashes.", "Research: the topics you research, the reports produced, your watchlist and any feedback notes you save.", "Billing: your plan, payment status and invoices. Card details go directly to our payment provider; we never receive them.", "Technical: IP address and browser type in server logs, and privacy-friendly page analytics without cross-site tracking, used for security and to improve the product."]],
      ["Cookies", ["We use only the cookies needed to keep you signed in and to complete sign-in safely. Your language choice is stored in your browser."]],
      ["Who else processes data", ["Our payment provider, our hosting and network providers, and the services a research run needs: public data sources such as GitHub and search engines, and AI model providers that analyse the collected evidence. Research topics are sent to them; your account details are not."]],
      ["How long we keep it", ["Private reports are kept for 30 days unless you save or share them. Billing records are kept for up to 24 months, or longer where the law requires. When you delete your account, we delete your profile, history and feedback, and keep only the billing records we must keep."]],
      ["Your rights", [`You can ask for a copy of your data, a correction, or deletion of your account at any time: ${mail}. We answer within 30 days.`]],
      ["Security", ["Traffic is encrypted with TLS and access to production systems is limited to the operator."]],
      ["Changes", ["If we change this policy in a way that matters, we update the date above and tell signed-in users by email or on the site."]],
    ],
  },
  "/refund": {
    title: "Refund Policy",
    description: `When and how ${BRAND} refunds a charge.`,
    sections: [
      ["Within 14 days", ["If you are not happy with Pro, ask for a refund within 14 days of the charge. If you used less than 20% of that period's research runs, we refund the charge in full."]],
      ["Always refunded", ["Duplicate charges, charges after you cancelled, and periods where an outage on our side stopped you from using the service are refunded in full, at any time."]],
      ["Otherwise", ["Outside these cases we do not refund partial periods. You can cancel at any time and keep Pro until the end of the period you paid for."]],
      ["How to ask", [`Email ${SUPPORT_EMAIL} from your account email, or include your username and the date of the charge. We reply within two business days. Approved refunds go back to the original payment method and usually arrive within 5 to 10 business days.`]],
    ],
  },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(base: string, path: string, title: string, description: string, body: string) {
  const links: [string, string][] = [["/pricing", "Pricing"], ["/terms", "Terms"], ["/privacy", "Privacy"], ["/refund", "Refunds"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${BRAND}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(base + path)}"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{--ink:#1d2433;--ink2:#4b5563;--ink3:#6b7280;--line:#e5e7eb;--bg:#fff;--accent:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--ink:#e8ecf3;--ink2:#b6bfcc;--ink3:#8a94a3;--line:#2a3140;--bg:#0f1420;--accent:#5b8ee6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink2);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line)}header .wrap{display:flex;align-items:center;gap:20px;height:60px}
header .brand{display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:600}header .grow{flex:1}header nav{display:flex;gap:18px;font-size:14px}
header nav a{color:var(--ink3)}header nav a[aria-current]{color:var(--ink)}
main{padding:64px 0 80px}h1{margin:0 0 6px;color:var(--ink);font-size:34px;letter-spacing:-.02em;line-height:1.2}
.updated{margin:0 0 36px;color:var(--ink3);font-size:14px}h2{margin:34px 0 8px;color:var(--ink);font-size:18px}p{margin:0 0 12px}
.plans{display:grid;grid-template-columns:1fr 1fr;margin:32px 0 16px;border-top:1px solid var(--line)}
.plan{padding:28px 28px 8px 0}.plan+.plan{padding-left:28px;border-left:1px solid var(--line)}
.plan h2{margin:0}.price{margin:6px 0 16px;color:var(--ink);font-size:34px;font-weight:600}.price small{font-size:15px;font-weight:400;color:var(--ink3)}
.plan ul{margin:0 0 20px;padding-left:18px}.cta{display:inline-block;margin-bottom:20px;padding:9px 16px;border-radius:6px;background:var(--accent);color:#fff;font-size:14px}
.cta.quiet{background:none;color:var(--accent);padding-left:0}
footer{border-top:1px solid var(--line);padding:24px 0 48px;font-size:14px;color:var(--ink3)}footer .wrap{display:flex;flex-wrap:wrap;gap:18px}
@media (max-width:640px){.plans{grid-template-columns:1fr}.plan+.plan{padding-left:0;border-left:0;border-top:1px solid var(--line)}header nav{display:none}}
</style></head><body>
<header><div class="wrap"><a class="brand" href="/"><img src="/favicon.svg" width="22" height="22" alt="">${BRAND}</a><span class="grow"></span><nav>${links.map(([h, l]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav></div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap"><span>${BRAND}</span>${links.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}<a href="mailto:${SUPPORT_EMAIL}">Contact: ${SUPPORT_EMAIL}</a></div></footer>
</body></html>`;
}

export function pricingHtml(base: string) {
  const plans = PLANS.map((p) => `<section class="plan"><h2>${esc(p.name)}</h2><div class="price">${p.price} <small>${p.period}</small></div><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>${p.name === "Free" ? `<a class="cta quiet" href="/auth/login">Start free</a>` : `<a class="cta" href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Pro subscription")}">Get Pro</a>`}</section>`).join("");
  return page(base, "/pricing", "Pricing", `${BRAND} plans: Free and Pro.`, `<h1>Pricing</h1><p class="updated">Prices in US dollars, excluding tax. Pro renews monthly until you cancel; cancel any time.</p><div class="plans">${plans}</div><p>Questions before you buy: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Refunds follow our <a href="/refund">Refund Policy</a>.</p>`);
}

export function legalHtml(base: string, path: keyof typeof LEGAL) {
  const d = LEGAL[path];
  return page(base, path, d.title, d.description, `<h1>${esc(d.title)}</h1><p class="updated">Last updated ${UPDATED}</p>${d.sections.map(([h, ps]) => `<section><h2>${esc(h)}</h2>${ps.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("")}`);
}

export const LEGAL_PATHS = ["/pricing", "/terms", "/privacy", "/refund"] as const;

export function registerLegal(app: Express, baseURL: (q: any) => string) {
  app.get("/pricing", (q, r) => r.type("html").set("Cache-Control", "public, max-age=600").send(pricingHtml(baseURL(q))));
  for (const path of ["/terms", "/privacy", "/refund"] as const)
    app.get(path, (q, r) => r.type("html").set("Cache-Control", "public, max-age=600").send(legalHtml(baseURL(q), path)));
}
