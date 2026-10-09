import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  effectiveDecision,
  verdictLabel,
  type Revision,
  type VerdictKind,
} from "../../core/decision.js";
import type { Lanes } from "../../core/engine.js";
import type { Market } from "../../core/types.js";
import type { Account } from "../account.js";
import { api } from "../api.js";
import { locale } from "../i18n.js";
import { Report, SourceDrawer, type Opened } from "./report.js";
import { Logo } from "../components.js";
import { Ask, day, l, tx } from "./ui.js";

type Framing = {
  who: { en: string; zh: string };
  task: { en: string; zh: string };
};
interface Item {
  id: string;
  input: string;
  created: string;
  framing?: Framing;
  verdict?: VerdictKind;
  actionable: boolean;
  status?: Revision["status"];
  failed: boolean;
  legacy: boolean;
}
interface Running {
  id: string;
  input: string;
  framing?: Framing;
  created: number;
  lanes?: Lanes;
  stage?: string;
}

const examples = [
  ["social media search API", "社媒搜索 API"],
  ["self-hosted forms", "自部署表单"],
  ["invoice tool for freelancers", "给自由职业者的开票工具"],
];

const Name = ({ framing, input }: { framing?: Framing; input: string }) =>
  framing ? (
    <>
      {framing.task[locale]}
      <span>
        {l(" for ", " · ")}
        {framing.who[locale]}
      </span>
    </>
  ) : (
    <>{input}</>
  );

function Mine({ open }: { open: (path: string) => void }) {
  const [data, setData] = useState<{
    items: Item[];
    running: Running[];
  } | null>(null);
  const load = useCallback(
    () =>
      api<{ items: Item[]; running: Running[] }>("/api/researches")
        .then(setData)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const live = !!data?.running.length;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [live, load]);
  if (!data) return null;
  if (!data.items.length && !data.running.length) return null;
  const status = (item: Item) =>
    item.status === "won"
      ? l("Did it, a yes", "做了·成")
      : item.status === "lost"
        ? l("Did it, a no", "做了·没成")
        : item.status === "parked"
          ? l("Parked", "先放下")
          : item.actionable
            ? l("To do", "待行动")
            : "";
  return (
    <section className="rd-below">
      <h2 className="rd-below-title">{l("Your research", "你的研究")}</h2>
      <ul className="rd-list">
        {data.running.map((r) => {
          const read = r.lanes
            ? [...r.lanes.pains, ...r.lanes.supply].filter(
                (i) => i.state === "read",
              ).length
            : 0;
          return (
            <li key={r.id} className="rd-item is-running">
              <button
                className="rd-item-open"
                onClick={() => open("/report/" + r.id)}
              >
                <Name framing={r.framing} input={r.input} />
              </button>
              <span className="rd-item-verdict">
                <i className="rd-live" />
                {r.stage === "brief"
                  ? l("Writing the verdict", "正在下判断")
                  : read
                    ? l(`${read} sources read`, `读了 ${read} 条`)
                    : l("Collecting", "正在采集")}
              </span>
              <span className="rd-item-status" />
              <span className="rd-item-date">{day(r.created)}</span>
            </li>
          );
        })}
        {data.items.map((item) => (
          <li key={item.id} className="rd-item">
            <button
              className="rd-item-open"
              onClick={() => open("/report/" + item.id)}
            >
              <Name framing={item.framing} input={item.input} />
            </button>
            <span className="rd-item-verdict">
              {item.verdict ? (
                <>
                  <i className={`rd-dot is-${item.verdict}`} />
                  {tx(verdictLabel[item.verdict])}
                </>
              ) : item.failed ? (
                l("Didn't finish", "没做完")
              ) : (
                l("Earlier format", "旧版结构")
              )}
            </span>
            <span className="rd-item-status">{status(item)}</span>
            <span className="rd-item-date">{day(item.created)}</span>
            <button
              className="rd-item-remove"
              aria-label={l("Remove from your list", "从列表里移除")}
              title={l("Remove from your list", "从列表里移除")}
              onClick={() =>
                void api(`/api/history/${item.id}`, { method: "DELETE" }).then(
                  load,
                )
              }
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A real, publicly shared report, readable to the end without signing in. */
function Sample() {
  const [data, setData] = useState<
    { market: Market; revision: Revision | null } | null | undefined
  >(undefined);
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = useCallback(() => setOpened(null), []);
  useEffect(() => {
    api<{ market: Market; revision: Revision | null } | null>("/api/sample")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (data === undefined) return null;
  if (!data?.market.brief?.decision) return null;
  const { market, revision } = data;
  const framing = market.topic.plan?.framing;
  return (
    <section className="rd-below">
      <h2 className="rd-below-title">
        {l(
          "A real report, start to finish: ",
          "一份真实的研究，可以直接读完：",
        )}
        {framing
          ? `${framing.who[locale]}${l(", ", "，")}${framing.task[locale]}`
          : market.topic.plan?.input || market.topic.name}
      </h2>
      <div style={{ marginTop: 22 }}>
        <Report
          market={market}
          decision={effectiveDecision(market.brief!.decision!, revision)}
          sources={[...market.brief!.sources, ...(revision?.sources || [])]}
          owner={false}
          revision={null}
          working={null}
          landing={false}
          showingOriginal={false}
          error=""
          onOpen={setOpened}
          onDismiss={() => {}}
          onRestore={() => {}}
          onRejudge={() => {}}
          onAddSupply={() => {}}
          onStatus={() => {}}
          onOriginal={() => {}}
        />
      </div>
      {opened && <SourceDrawer opened={opened} onClose={close} />}
    </section>
  );
}

export function Home({
  account,
  initial,
  note,
  onStart,
  open,
}: {
  account: Account | null;
  initial: string;
  note: string;
  onStart: (input: string) => void;
  open: (path: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    setValue(initial);
    if (initial) input.current?.focus();
  }, [initial]);
  const signedIn = !!account?.user;
  return (
    <div className="rd-wrap rd-home">
      <div className="rd-hero">
        <h1 className="rd-mark">
          <Logo />
        </h1>
        <Ask
          value={value}
          onChange={setValue}
          onSubmit={() => onStart(value.trim())}
          inputRef={input}
          autoFocus
          label={l("Research", "研究")}
          placeholder={l("Enter a domain or an idea", "输入一个领域或想法")}
        />
        {note ? (
          <p className="rd-note" role="alert">
            {note}
          </p>
        ) : (
          <div className="rd-try">
            {examples.map(([en, zh]) => (
              <button
                key={en}
                onClick={() => {
                  setValue(l(en, zh));
                  input.current?.focus();
                }}
              >
                {l(en, zh)}
              </button>
            ))}
          </div>
        )}
      </div>
      {account && (signedIn ? <Mine open={open} /> : <Sample />)}
    </div>
  );
}
