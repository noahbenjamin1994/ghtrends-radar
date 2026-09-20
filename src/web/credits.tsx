import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api } from "./api.js";
import { MyFeedback } from "./feedback.js";
import { locale, localUrl } from "./i18n.js";
import { Loading } from "./components.js";
import { SignInGate, type Account } from "./account.js";
import type { CreditsResponse, CreditAccountView } from "../core/credits.js";
import "./credits.css";

const say = (en: string, zh: string) => (locale === "zh" ? zh : en);
const date = (value: string) =>
  new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const eventName = {
  pack_grant: ["Purchase received", "购买到账"],
  pack_reserve: ["Reserved for research", "研究预留"],
  pack_settle: ["Research completed", "研究完成"],
  pack_release: ["Reservation released", "预留已释放"],
  pack_timeout: ["Reservation expired", "预留到时释放"],
  pack_expire: ["Pack expired", "研究包到期"],
  pack_adjust: ["Purchase adjustment", "购买权益调整"],
};
const orderName = {
  pending: ["Awaiting payment confirmation", "等待付款确认"],
  confirming: ["Confirming credits", "正在确认到账"],
  paid: ["Credits received", "次数已到账"],
  failed: ["Checkout ended", "本次结账已结束"],
  canceled: ["Checkout closed", "本次结账已关闭"],
  refunded: ["Refund processed", "退款已处理"],
};
const merge = <T extends { id: string }>(old: T[], fresh: T[]) => [
  ...new Map([...old, ...fresh].map((row) => [row.id, row])).values(),
];

export function AccountView({ account }: { account: Account | null }) {
  if (!account) return <Loading />;
  if (!account.user)
    return <SignInGate account={account} returnTo="/account" />;
  return <AccountDetails account={account} />;
}

function AccountDetails({ account }: { account: Account }) {
  const [data, setData] = useState<CreditAccountView | null>(null);
  const [sync, setSync] = useState("");
  const [state, setState] = useState<
    "loading" | "ready" | "off" | "unavailable"
  >("loading");
  const [busy, setBusy] = useState(false);
  const current = useRef<AbortController | null>(null);
  const load = useCallback(
    async (page?: { kind: "activity" | "purchase"; cursor: string }) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setBusy(true);
      const query = page
        ? `?${page.kind}_cursor=${encodeURIComponent(page.cursor)}`
        : "";
      try {
        const result = await api<CreditsResponse>(
          "/api/account/credits" + query,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setState(result.state);
        if (result.state === "ready") {
          setSync(result.syncedAt);
          setData((old) =>
            page && old
              ? {
                  ...old,
                  balance: result.data.balance,
                  ...(page.kind === "activity"
                    ? {
                        activity: merge(old.activity, result.data.activity),
                        activity_next: result.data.activity_next,
                      }
                    : {
                        purchases: merge(old.purchases, result.data.purchases),
                        purchase_next: result.data.purchase_next,
                      }),
                }
              : result.data,
          );
        } else setData(null);
      } catch {
        if (!controller.signal.aborted) setState("unavailable");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    void load();
    const update = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("ghtrends:usage", update);
    return () => {
      current.current?.abort();
      window.removeEventListener("ghtrends:usage", update);
    };
  }, [load]);
  const ready = state === "ready" && data;
  const trial = account.deep?.allowance;
  const soonest = ready
    ? data.balance.lots
        .filter((lot) => lot.available > 0)
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at))[0]
    : null;
  return (
    <div className="credits-page">
      <header className="credits-heading">
        <div>
          <div className="eyebrow">{say("YOUR ACCOUNT", "我的账户")}</div>
          <h1>
            {say("A clear view of your credits.", "每一次研究，心里有数。")}
          </h1>
          <p>
            {account.hosted
              ? account.user!.name
              : say("Local workspace", "本地工作区")}{" "}
            ·{" "}
            {say(
              "Research credits, purchases and activity",
              "研究次数、购买与使用记录",
            )}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {busy
            ? say("Syncing…", "同步中…")
            : say("Refresh records", "刷新记录")}
        </button>
      </header>
      {state === "unavailable" && (
        <div className="credits-notice" role="status">
          <strong>
            {say("Your account is syncing.", "账户信息正在同步。")}
          </strong>
          <span>
            {say(
              "Refresh in a moment to see your current balance.",
              "稍后刷新，即可核对当前余额。",
            )}
          </span>
          {sync && (
            <span>
              {say("Records below were synced at ", "下方记录的同步时间：")}
              {date(sync)}
            </span>
          )}
        </div>
      )}
      <section
        className="credits-summary"
        aria-label={say("Research allowances", "研究额度")}
      >
        <div className="credits-metric">
          <h2>{say("Daily research", "今日研究")}</h2>
          <p className="credits-number">
            {account.quota?.remaining ?? "—"}
            <span>{account.quota ? `/ ${account.quota.limit}` : ""}</span>
          </p>
          <p>
            {account.quota
              ? say("Resets ", "恢复时间：") + date(account.quota.resetAt)
              : say("Uses your own service keys", "使用自备服务密钥")}
          </p>
        </div>
        {account.hosted && account.deep?.enabled && (
          <div className="credits-metric">
            <h2>{say("First focused research", "首次专项体验")}</h2>
            <p className="credits-number">
              {trial?.remaining ?? "—"}
              <span>{trial?.limit ? `/ ${trial.limit}` : ""}</span>
            </p>
            <p>
              {trial?.reserved
                ? say("Reserved for your current task", "已为当前任务预留")
                : trial?.used
                  ? say(
                      "Your first research is saved in My research",
                      "首次研究已保存到「我的研究」",
                    )
                  : say(
                      "One introductory research per account",
                      "每个账户享有一次专项体验",
                    )}
            </p>
          </div>
        )}
        {state !== "off" && (
          <div className="credits-metric credits-paid">
            <h2>{say("Purchased research", "已购专项研究")}</h2>
            <p className="credits-number">
              {ready ? data.balance.available : "—"}
              <span>{say("available", "次可用")}</span>
            </p>
            <p>
              {ready
                ? say(
                    `${data.balance.reserved} reserved · ${data.balance.used} completed`,
                    `已预留 ${data.balance.reserved} 次 · 已完成 ${data.balance.used} 次`,
                  )
                : say("Confirming your balance", "正在核对余额")}
            </p>
            {soonest && (
              <p className="credits-expiry">
                {say(
                  `${soonest.available} credits expire `,
                  `${soonest.available} 次将于 `,
                )}
                {date(soonest.expires_at)}
                {say("", " 到期")}
              </p>
            )}
            {account.checkoutUrl && (
              <a className="button secondary" href={account.checkoutUrl}>
                {say("View research pack", "查看专项研究包")}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </section>
      <div className="credits-next">
        <p>
          {say(
            "Each focused research starts with a question you choose from a report.",
            "从报告中选定一个方向和问题，再开始专项研究。",
          )}
        </p>
        <a href={localUrl("/history")}>
          {say("Open my research", "打开我的研究")}{" "}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      {data && (
        <>
          <section
            className="credits-section"
            aria-labelledby="credit-purchases"
          >
            <div className="credits-section-heading">
              <h2 id="credit-purchases">
                {say("Your research packs", "我的研究包")}
              </h2>
              <span>
                {say(
                  "Each purchase keeps its own expiry date",
                  "每笔购买分别计算有效期",
                )}
              </span>
            </div>
            {data.purchases.length ? (
              <div className="credits-purchases">
                {data.purchases.map((order) => (
                  <article key={order.id} className="credits-purchase">
                    <div className="credits-order-title">
                      <h3>
                        {order.name === "Research pack"
                          ? say("Focused research pack", "专项研究包")
                          : order.name}
                      </h3>
                      <span>
                        {order.status === "paid" && order.lot?.expired
                          ? say("Pack expired", "研究包已到期")
                          : say(
                              ...(orderName[order.status] as [string, string]),
                            )}
                      </span>
                    </div>
                    <div className="credits-order-body">
                      <p className="credits-order-count">
                        {order.lot ? order.lot.available : "—"}
                        <span>
                          {order.lot
                            ? say(
                                ` of ${order.units} available`,
                                ` / ${order.units} 次可用`,
                              )
                            : say(
                                `${order.units ?? "—"} credits in this order`,
                                `本笔 ${order.units ?? "—"} 次`,
                              )}
                        </span>
                      </p>
                      <div>
                        <strong>
                          {new Intl.NumberFormat(
                            locale === "zh" ? "zh-CN" : "en-US",
                            { style: "currency", currency: order.currency },
                          ).format(order.amount_minor / 100)}
                        </strong>
                        <small>
                          {order.amount_kind === "paid_total"
                            ? say("Original payment", "原实付金额")
                            : say("Quoted before tax", "税前报价")}
                        </small>
                      </div>
                    </div>
                    {order.lot && (
                      <p>
                        {say("Expires ", "到期时间：")}
                        {date(order.lot.expires_at)}
                      </p>
                    )}
                    {order.lot &&
                      (order.lot.reserved > 0 ||
                        order.lot.used > 0 ||
                        order.lot.revoked > 0 ||
                        order.lot.expired_unused > 0) && (
                        <p className="credits-order-details">
                          {[
                            order.lot.reserved &&
                              say(
                                `${order.lot.reserved} reserved`,
                                `已预留 ${order.lot.reserved} 次`,
                              ),
                            order.lot.used &&
                              say(
                                `${order.lot.used} completed`,
                                `已完成 ${order.lot.used} 次`,
                              ),
                            order.lot.revoked &&
                              say(
                                `${order.lot.revoked} adjusted after purchase`,
                                `购买后调整 ${order.lot.revoked} 次`,
                              ),
                            order.lot.expired_unused &&
                              say(
                                `${order.lot.expired_unused} expired`,
                                `到期 ${order.lot.expired_unused} 次`,
                              ),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    <details>
                      <summary>{say("Order details", "订单详情")}</summary>
                      <p>{date(order.created_at)}</p>
                      <p>{order.order_number || order.id}</p>
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <p className="credits-empty">
                {say(
                  "Your purchases and expiry dates will appear here.",
                  "购买完成后，这里会显示研究次数和到期日。",
                )}
              </p>
            )}
            {data.purchase_next && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void load({ kind: "purchase", cursor: data.purchase_next! })
                }
              >
                {say("Earlier purchases", "更早的购买")}
              </button>
            )}
          </section>
          <section
            className="credits-section"
            aria-labelledby="credit-activity"
          >
            <div className="credits-section-heading">
              <h2 id="credit-activity">
                {say("Credit activity", "次数使用记录")}
              </h2>
            </div>
            <p className="credits-explanation">
              {say(
                "Starting research reserves one credit; completing it confirms that use. The change column shows changes to your available balance.",
                "开始研究时预留 1 次，完成后确认使用。「可用变化」记录可用余额的变化。",
              )}
            </p>
            {data.activity.length ? (
              <div className="credits-table-wrap">
                <table className="credits-table">
                  <thead>
                    <tr>
                      <th>{say("Activity", "记录")}</th>
                      <th>{say("Time", "时间")}</th>
                      <th>{say("Available change", "可用变化")}</th>
                      <th>{say("Available after", "变更后可用")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activity.map((event) => (
                      <tr key={event.id}>
                        <td>
                          {say(
                            ...(eventName[event.reason] as [string, string]),
                          )}
                          {event.researchId && (
                            <a href={localUrl("/research/" + event.researchId)}>
                              {say("View research", "查看研究")}{" "}
                              <ArrowUpRight size={12} aria-hidden="true" />
                            </a>
                          )}
                          {event.attempt && (
                            <small>
                              {say(
                                `Attempt ${event.attempt}`,
                                `第 ${event.attempt} 次尝试`,
                              )}
                            </small>
                          )}
                        </td>
                        <td>
                          <time dateTime={event.created_at}>
                            {date(event.created_at)}
                          </time>
                        </td>
                        <td className={event.delta > 0 ? "credits-added" : ""}>
                          {event.delta > 0 ? "+" : ""}
                          {event.delta}
                        </td>
                        <td>{event.balance_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="credits-empty">
                {say(
                  "Purchases and research activity will be recorded here.",
                  "购买与研究产生的次数变化，会逐笔记录在这里。",
                )}
              </p>
            )}
            {data.activity_next && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void load({ kind: "activity", cursor: data.activity_next! })
                }
              >
                {say("Earlier activity", "更早的记录")}
              </button>
            )}
          </section>
          {sync && (
            <p className="credits-sync">
              {say("Last synced ", "最近同步：")}
              {date(sync)} ·{" "}
              {say(
                "Times shown in your local time zone",
                "时间按你所在时区显示",
              )}
            </p>
          )}
        </>
      )}
      <MyFeedback account={account} />
    </div>
  );
}
