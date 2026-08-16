import { defineConfig, devices } from "@playwright/test";

// 冒烟默认打生产(E20:对生产环境全量通过);可用 SMOKE_BASE_URL 覆盖为本地/预览
const baseURL = process.env.SMOKE_BASE_URL || "https://aeoeye.com";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // 移动用 chromium 内核设备(iPhone 真机断点留待第6轮 WebKit 专项)
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
