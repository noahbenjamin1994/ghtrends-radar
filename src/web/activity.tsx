import { activityLabel, type ResearchActivity } from "../core/activity.js";
import { locale } from "./i18n.js";
import { Check, LoaderCircle } from "lucide-react";

export function ActivityFeed({ items = [] }: { items?: ResearchActivity[] }) {
  if (!items.length) return null;
  const zh = locale === "zh";
  const running = items.filter(
    (x) => !["complete", "retrying"].includes(x.state),
  );
  const visible = [
    ...items
      .filter((x) => ["complete", "retrying"].includes(x.state))
      .slice(-3),
    ...running,
  ];
  return (
    <div className="research-activity">
      <div className="activity-heading">
        <span>{zh ? "研究动态" : "Research activity"}</span>
        <span className="activity-live">{zh ? "实时更新" : "Live"}</span>
      </div>
      <ul aria-label={zh ? "研究进度" : "Research progress"}>
        {visible.map((item) => (
          <li key={item.id} data-state={item.state}>
            {item.state === "complete" ? (
              <Check size={14} />
            ) : (
              <LoaderCircle size={14} />
            )}
            <span>
              {activityLabel(item.operation, zh)}
              {!["complete", "retrying"].includes(item.state) && (
                <small>
                  {item.state === "thinking"
                    ? zh
                      ? "正在推敲依据"
                      : "Evaluating evidence"
                    : item.state === "writing"
                      ? zh
                        ? "正在生成内容"
                        : "Receiving the response"
                      : zh
                        ? "已发送，等待响应"
                        : "Request sent, awaiting response"}
                </small>
              )}
              {item.state === "retrying" && (
                <small>
                  {zh ? "本步需要补充核对" : "Further checking needed"}
                </small>
              )}
            </span>
            <time>
              {Math.max(0, Math.round((item.updated - item.started) / 1000))}s
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
