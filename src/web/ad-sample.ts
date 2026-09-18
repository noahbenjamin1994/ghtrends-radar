// Observed in a real Google browser result on the recorded date.
// UI-only illustration: never enters a topic report or its scoring/model evidence.
export const adSample = {
  query: "crm software",
  searchUrl: "https://www.google.com/search?q=crm+software&gl=us&hl=en",
  requestedRegion: "US",
  observedRegion: "unknown",
  language: "en",
  method: "browser-observation",
  fetchedAt: "2026-09-18T15:36:41.869Z",
  results: [
    {
      title: "HubSpot Free CRM Software | Sales, Marketing & Service CRM",
      url: "https://www.hubspot.com/crm/e010a",
      excerpt:
        "Work faster, smarter and more effectively with HubSpot Smart CRM. See How HubSpot Smart...",
      advertiser: "HubSpot",
    },
    {
      title: "All in One Powerful Package",
      url: "https://www.zendesk.com/lp/brand/",
      excerpt:
        "For Any Business, Any Size — Create exceptional customer experiences with a unified system that saves time and money.",
      advertiser: "Zendesk",
    },
  ],
} as const;
