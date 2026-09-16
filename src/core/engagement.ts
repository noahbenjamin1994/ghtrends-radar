export const ENGAGEMENT_EVENTS = [
  "report_view",
  "share_copy",
  "share_publish",
  "export_png",
  "export_md",
  "export_json",
  "opensource_view",
  "github_click",
  "install_copy",
  "project_save",
  "report_save",
] as const;
export type EngagementEvent = (typeof ENGAGEMENT_EVENTS)[number];
