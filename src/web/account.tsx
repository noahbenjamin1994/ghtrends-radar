import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Trash2,
  LockKeyhole,
  Globe2,
  LogOut,
} from "lucide-react";
import { api } from "./api.js";
import { t, locale, localUrl, loginUrl } from "./i18n.js";
import type { MarketKind } from "../core/types.js";
import { Loading, Empty } from "./components.js";
import { DeepHistory, type DeepStatus } from "./deep.js";
export interface Account {
  deep?: DeepStatus;
  hosted: boolean;
  engagementEnabled: boolean;
  authAvailable: boolean;
  aiAvailable: boolean;
  user: { name: string; isAdmin: boolean } | null;
  csrf: string;
  dailyLimit: number;
  used: number;
  quota: {
    limit: number;
    used: number;
    remaining: number;
    resetAt: string;
  } | null;
  trends: { retryAt: string | null };
}
export function SignInGate({
  account,
  returnTo = "/history",
  purpose,
}: {
  account: Account | null;
  returnTo?: string;
  purpose?: "compare";
}) {
  return (
    <Empty
      title={t(
        purpose === "compare"
          ? "Continue your project comparison"
          : "Your research, saved for you",
      )}
      description={t(
        purpose === "compare"
          ? "Sign in to compare the selected repositories. Your selection will be kept."
          : "Browse public reports without an account. Sign in to scan and save reports and projects across devices.",
      )}
      action={
        account?.authAvailable ? (
          <a className="button" href={loginUrl(returnTo)}>
            {t("Sign in with Logto")} <ArrowUpRight size={16} />
          </a>
        ) : (
          <p>{t("Sign-in is not configured on this server.")}</p>
        )
      }
    />
  );
}
export function HistoryView({
  account,
  navigate,
  tab = "reports",
  children,
}: {
  account: Account | null;
  navigate: (s: string) => void;
  tab?: "reports" | "projects";
  children?: React.ReactNode;
}) {
  const [rows, setRows] = useState<
      {
        id: string;
        input: string;
        created: string;
        topic: string;
        keyword: string;
        geo: string;
        headline: string;
        kind: MarketKind;
        public: boolean;
      }[]
    >([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = () =>
    api<typeof rows>("/api/history")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  useEffect(() => {
    if (account?.user) void load();
    else setLoading(false);
  }, [account?.user?.name]);
  if (!account) return <Loading />;
  if (!account.user)
    return (
      <SignInGate
        account={account}
        returnTo={tab === "projects" ? "/history?tab=projects" : "/history"}
      />
    );
  return (
    <div className="history-page">
      <div className="eyebrow">{t("YOUR RESEARCH")}</div>
      <div className="history-heading">
        <div>
          <h1>{t("Pick up where you left off")}</h1>
          <p>
            {t(
              "Completed scans are saved automatically. New personal reports stay private until you share them.",
            )}
          </p>
        </div>
        {account.hosted && (
          <div className="account-summary">
            <strong>{account.user.name}</strong>
            <UsageSummary account={account} />
            <a href={localUrl("/account")}>
              {locale === "zh" ? "查看次数与记录" : "View credits & activity"}
            </a>
          </div>
        )}
      </div>
      <nav className="research-tabs" aria-label={t("My research")}>
        <button
          aria-current={tab === "reports" ? "page" : undefined}
          onClick={() => navigate("/history")}
        >
          {t("Reports")}
        </button>
        <button
          aria-current={tab === "projects" ? "page" : undefined}
          onClick={() => navigate("/history?tab=projects")}
        >
          {t("Saved projects")}
        </button>
      </nav>
      {tab === "reports" && <DeepHistory account={account} />}
      {error && (
        <p role="alert" className="error-banner">
          {t(error)}
        </p>
      )}
      {tab === "projects" ? (
        children
      ) : loading ? (
        <Loading />
      ) : rows.length ? (
        <div className="history-list">
          {rows.map((row) => (
            <article key={row.id} className="history-row">
              <button onClick={() => navigate("/report/" + row.id)}>
                <div className="history-row-top">
                  <span>
                    {row.public ? (
                      <Globe2 size={14} />
                    ) : (
                      <LockKeyhole size={14} />
                    )}{" "}
                    {t(row.public ? "Shared" : "Private")}
                  </span>
                  <time>{new Date(row.created).toLocaleString()}</time>
                </div>
                <h3>{row.input}</h3>
                <p>{t(row.headline)}</p>
                <small>
                  {row.keyword} · {row.geo || t("Worldwide")}
                </small>
              </button>
              <button
                className="icon-button"
                aria-label={t("Remove from history")}
                onClick={() =>
                  void api("/api/history/" + row.id, { method: "DELETE" })
                    .then(load)
                    .catch((e) => setError(e.message))
                }
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={t("Your next scan will be here")}
          description={t(
            "Search a category in your own words. We will organize the queries and save the evidence here.",
          )}
          action={
            <button className="button" onClick={() => navigate("/")}>
              {t("Start a scan")} <ArrowUpRight size={16} />
            </button>
          }
        />
      )}
    </div>
  );
}

export function UsageSummary({ account }: { account: Account | null }) {
  if (!account?.quota) return null;
  const q = account.quota;
  return (
    <div className="usage-summary">
      <strong>
        {t("{remaining} of {limit} research credits left today", {
          remaining: q.remaining,
          limit: q.limit,
        })}
      </strong>
      <span>
        {t("Resets at {time}", {
          time: new Date(q.resetAt).toLocaleString(
            locale === "zh" ? "zh-CN" : "en-US",
            {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            },
          ),
        })}
      </span>
      <progress
        value={q.remaining}
        max={q.limit}
        aria-label={t("Research credits remaining")}
      />
    </div>
  );
}
export function ResearchCost({ account }: { account: Account | null }) {
  return (
    <p className="research-cost">
      {t(
        account?.hosted
          ? "Fresh research uses 1 credit. Cached results are free; collection issues return your credit."
          : "Self-hosted: your keys, your data. Scans are saved on this server.",
      )}
    </p>
  );
}
