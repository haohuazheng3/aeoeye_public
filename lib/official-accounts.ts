/**
 * Verified brand-owned profiles only. Keep this list as the single source for
 * visible account links and Organization.sameAs structured data.
 */
export const officialAccounts = [
  {
    id: "pinterest",
    label: "Pinterest",
    url: "https://www.pinterest.com/AEOeye01/",
  },
  {
    id: "reddit",
    label: "Reddit",
    url: "https://www.reddit.com/user/AEOeye/",
  },
] as const;

export const officialAccountUrls = officialAccounts.map((account) => account.url);
