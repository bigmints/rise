import { chromium } from "playwright";

const baseUrl = process.env.RISE_AUDIT_URL || "http://127.0.0.1:8893/";
const url = new URL(baseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("weight regression audit only runs against an isolated local server");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10_000);

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Check in", exact: true }).click();
  const checkin = page.getByRole("dialog", { name: "Daily check-in" });
  await checkin.getByRole("tab", { name: "Measure", exact: true }).click();

  const weightQuestions = checkin.getByRole("heading", {
    name: "Weight",
    exact: true,
  });
  if ((await weightQuestions.count()) !== 1) {
    throw new Error(
      `daily check-in rendered ${await weightQuestions.count()} Weight questions`,
    );
  }
  if ((await checkin.getByRole("spinbutton", { name: "Kilograms" }).count()) !== 1) {
    throw new Error("daily check-in did not render one canonical weight input");
  }

  await checkin.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Trends", exact: true }).click();

  const weightCards = page.getByRole("button", {
    name: /^View Weight details$/,
  });
  if ((await weightCards.count()) !== 1) {
    throw new Error(`Trends rendered ${await weightCards.count()} Weight cards`);
  }
  const weightCard = weightCards.first().locator("xpath=ancestor::*[@data-testid='tracker-trend-card']");
  if ((await weightCard.getAttribute("data-entry-count")) !== "2") {
    throw new Error(
      `Weight trend did not merge the two September check-ins: ${await weightCard.getAttribute("data-entry-count")}`,
    );
  }
  await weightCard.getByRole("img", { name: /^Weight trend/ }).waitFor();

  await page.screenshot({
    path: "/tmp/rise-weight-regression-mobile.png",
    fullPage: true,
  });
  console.log("weight check-in and merged trend regression audit passed");
} finally {
  await browser.close();
}
