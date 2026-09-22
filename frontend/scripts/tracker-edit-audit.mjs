import { chromium } from "playwright";

const baseUrl = process.env.RISE_AUDIT_URL || "http://127.0.0.1:8892/";
const url = new URL(baseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("tracker edit audit only runs against an isolated local server");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10_000);
try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Trends", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Time range", exact: true }).waitFor();
  await page.getByText(/^View 1 reading$/).click();
  await page
    .getByRole("button", { name: /^Edit Blood pressure reading from / })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit Blood pressure" });
  await dialog.waitFor();
  const systolic = dialog.getByRole("spinbutton", { name: "Systolic" });
  const diastolic = dialog.getByRole("spinbutton", { name: "Diastolic" });
  if ((await systolic.inputValue()) !== "121" || (await diastolic.inputValue()) !== "79")
    throw new Error("edit dialog did not load the saved blood-pressure values");
  await systolic.fill("119");
  await dialog.getByRole("button", { name: "Save reading", exact: true }).click();
  await page.getByText("119/79", { exact: true }).first().waitFor();
  const response = await page.request.get(`${url.origin}/api/trackers?days=30`);
  const data = await response.json();
  const bloodPressure = data.trackers.find((tracker) => tracker.key === "blood_pressure");
  if (bloodPressure.entries.length !== 1)
    throw new Error(`edit created a duplicate reading: ${bloodPressure.entries.length}`);
  if (bloodPressure.entries[0].components.systolic.numeric_value !== 119)
    throw new Error("edited systolic value was not persisted");
  await page.screenshot({ path: "/tmp/rise-track-edit-mobile.png", fullPage: false });
  console.log("tracker edit persisted in place without a duplicate");
} finally {
  await browser.close();
}
