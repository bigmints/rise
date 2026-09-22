import { chromium } from "playwright";

const baseUrl = process.env.RISE_AUDIT_URL || "http://127.0.0.1:8891/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const failures = [];
const errors = [];
let offlinePhase = false;

page.on("console", (message) => {
  if (
    ["error", "warning"].includes(message.type()) &&
    !(
      offlinePhase &&
      (message.text().includes("net::ERR_FAILED") ||
        message.text().includes("net::ERR_INTERNET_DISCONNECTED"))
    )
  )
    errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Rise home" }).waitFor();

  const metadata = await page.evaluate(async () => {
    const manifestUrl = document
      .querySelector('link[rel="manifest"]')
      ?.getAttribute("href");
    const manifest = manifestUrl
      ? await fetch(manifestUrl).then((response) => response.json())
      : null;
    return {
      manifest,
      viewport: document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content"),
      statusBar: document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute("content"),
    };
  });
  if (metadata.manifest?.display !== "standalone")
    failures.push("manifest display is not standalone");
  if (metadata.manifest?.start_url !== "/" || metadata.manifest?.scope !== "/")
    failures.push("manifest start_url or scope is incorrect");
  if (metadata.manifest?.icons?.length < 2)
    failures.push("manifest icons are incomplete");
  if (!metadata.viewport?.includes("viewport-fit=cover"))
    failures.push("viewport-fit=cover is missing");
  if (metadata.statusBar !== "black-translucent")
    failures.push("iOS status bar mode is not configured");

  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator))
      throw new Error("service workers unavailable");
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Rise home" }).waitFor();

  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const cacheNames = await caches.keys();
    const cachedPaths = [];
    for (const name of cacheNames) {
      for (const request of await (await caches.open(name)).keys()) {
        cachedPaths.push(new URL(request.url).pathname);
      }
    }
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      active: registration?.active?.state,
      cacheNames,
      cachedPaths,
    };
  });
  if (!workerState.controlled || workerState.active !== "activated")
    failures.push(
      `service worker is not controlling the app: ${JSON.stringify(workerState)}`,
    );
  if (!workerState.cacheNames.includes("rise-static-v49"))
    failures.push(`v49 cache is missing: ${workerState.cacheNames.join(", ")}`);
  if (workerState.cachedPaths.some((path) => path.startsWith("/api/")))
    failures.push("private API responses were cached");
  if (!workerState.cachedPaths.includes("/"))
    failures.push("navigation shell was not cached");

  offlinePhase = true;
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Rise home" }).waitFor();
  await page.getByText("Rise could not load", { exact: true }).waitFor();
  const offlineLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (offlineLayout.scrollWidth > offlineLayout.width + 1)
    failures.push(`offline layout overflows: ${JSON.stringify(offlineLayout)}`);
  await page.screenshot({
    path: "/tmp/rise-pwa-offline-mobile.png",
    fullPage: true,
  });
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await context.setOffline(false);
  await browser.close();
}

if (errors.length) failures.push(`console: ${errors.join(" | ")}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  "PWA install metadata, service worker control, safe cache, and offline startup passed",
);
