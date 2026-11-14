// End-to-end check of the whole Phase 1 flow in a phone-sized browser.
//
//   node scripts/e2e.mjs <app address> <folder with photos> [folder for screenshots]
//
// Uses whatever AI the server is configured with (FAKE_AI=1 for canned text).
// Optional: PASSCODE=... when the app asks for one, VIDEO=path/to/clip.webm.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Playwright is expected to be installed on the machine, not in this project.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const photoDir = process.argv[3];
const shotDir = process.argv[4] ?? "";
const passcode = process.env.PASSCODE ?? "";
const video = process.env.VIDEO ?? "";
const WAIT_AI = Number(process.env.WAIT_AI ?? 240_000);

if (!photoDir) throw new Error("Give the folder with test photos as the second argument.");
const photos = fs
  .readdirSync(photoDir)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort()
  .map((f) => path.join(photoDir, f));
const uploads = video ? [...photos, video] : photos;

let step = 0;
const problems = [];
function ok(condition, message) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) problems.push(message);
}

// When testing a live address from behind a company or sandbox proxy, the
// browser has to be told about the proxy explicitly.
const viaProxy = !/\/\/(localhost|127\.0\.0\.1)/.test(base) && process.env.HTTPS_PROXY;
const browser = await chromium.launch(viaProxy ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const context = await browser.newContext({ ...devices["iPhone 14"], permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

async function shot(name) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${String(++step).padStart(2, "0")}-${name}.png`), fullPage: true });
}

try {
  await page.goto(base);
  if (passcode) {
    await page.getByLabel("Passcode").fill("definitely-wrong");
    await page.getByRole("button", { name: "Open" }).click();
    await page.getByText("That passcode is not right.").waitFor();
    ok(true, "wrong passcode is refused");
    await page.getByLabel("Passcode").fill(passcode);
    await page.getByRole("button", { name: "Open" }).click();
    consoleErrors.length = 0; // the refused passcode above is expected
  }
  await page.getByRole("button", { name: /Add photos or video/ }).waitFor();
  await shot("home");

  // --- pick photos (and a video) ---
  await page.locator('input[type="file"]').first().setInputFiles(uploads);
  await page.waitForURL(/\/b\//);
  await page.getByRole("button", { name: /Create listings from \d+ photo/ }).waitFor({ timeout: 120_000 });
  const startLabel = await page.getByRole("button", { name: /Create listings from/ }).innerText();
  const uploaded = Number(startLabel.match(/\d+/)?.[0] ?? 0);
  ok(uploaded >= photos.length, `all ${photos.length} photos uploaded${video ? ` plus ${uploaded - photos.length} video frames` : ""}`);
  if (video) ok(uploaded - photos.length >= 2, "video produced at least 2 frames");
  await shot("photos-ready");

  // --- create listings ---
  await page.getByRole("button", { name: /Create listings from/ }).click();
  await page.getByText(/Working out what is in your photos|items? found/).first().waitFor();
  await shot("looking");
  await page.getByRole("heading", { name: /items? found/ }).waitFor({ timeout: WAIT_AI });
  await shot("items-appearing");
  await page.locator(".bottombar").getByRole("button", { name: /^Approve( all \d+| the last one)?$/ }).waitFor({ timeout: WAIT_AI });
  const itemCount = await page.locator("article").count();
  ok(itemCount >= 1, `${itemCount} item(s) written`);
  await shot("listings-ready");

  // --- unsure photo, if the AI asked ---
  const unsure = page.getByText("I am not sure about this photo");
  if ((await unsure.count()) > 0) {
    await page.getByRole("button", { name: "Ignore photo" }).first().click();
    await unsure.first().waitFor({ state: "detached" });
    ok(true, "answered a question about an unclear photo");
  }

  // --- edit the first item ---
  const first = page.locator("article").first();
  await first.getByRole("button", { name: "Title. Tap to edit." }).click();
  await first.getByRole("textbox", { name: "Title" }).fill("Edited by the test");
  await first.getByRole("textbox", { name: "Title" }).blur();
  await first.getByRole("button", { name: "Title. Tap to edit." }).waitFor();
  await first.getByRole("button", { name: "Price. Tap to edit." }).click();
  await first.getByRole("textbox", { name: "Price in kroner" }).fill("1234");
  await first.getByRole("textbox", { name: "Price in kroner" }).blur();
  await first.getByRole("radio", { name: "Like new" }).click();
  await page.waitForTimeout(600);
  await page.reload();
  const again = page.locator("article").first();
  ok((await again.getByRole("button", { name: "Title. Tap to edit." }).innerText()) === "Edited by the test", "title edit was saved");
  ok((await again.getByRole("button", { name: "Price. Tap to edit." }).innerText()).replace(/\s/g, "") === "1234kr", "price edit was saved");
  ok((await again.getByRole("radio", { name: "Like new" }).getAttribute("aria-checked")) === "true", "condition edit was saved");

  // --- answer the AI's questions, if any ---
  const update = again.getByRole("button", { name: "Update the listing" });
  if ((await update.count()) > 0) {
    const choice = again.locator(".questions .chips .chip").first();
    if ((await choice.count()) > 0) await choice.click();
    for (const input of await again.locator(".questions input").all()) await input.fill("About 30 x 20 cm");
    await shot("questions-answered");
    await update.click();
    await again.locator(".questions").waitFor({ state: "detached", timeout: WAIT_AI });
    await again.getByText("Updating the text…").waitFor({ state: "detached", timeout: WAIT_AI });
    ok(true, "answers were folded into the listing");
  }
  await shot("item-edited");

  // --- English text is there too ---
  await again.getByRole("tab", { name: "English" }).click();
  ok((await again.getByRole("button", { name: "Title. Tap to edit." }).innerText()).length > 3, "English title exists");
  await again.getByRole("tab", { name: "Norsk" }).click();

  // --- approve everything ---
  await page.locator(".bottombar").getByRole("button", { name: /^Approve( all \d+| the last one)?$/ }).click();
  await page.getByRole("button", { name: "Yes, approve" }).click();
  await page.getByRole("link", { name: "Done. Go to my items" }).waitFor();
  await shot("all-approved");
  await page.getByRole("link", { name: "Done. Go to my items" }).click();
  await page.getByText(/Ready to post \(\d+\)/).waitFor();
  await shot("home-with-items");

  // --- post screen: copy buttons ---
  await page.getByRole("region", { name: "Ready to post" }).locator("a.itemrow").first().click();
  await page.getByRole("heading", { name: "Post it" }).waitFor();
  await page.getByRole("button", { name: /Save \d+ photos?/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Copy Title" }).click();
  const copiedTitle = await page.evaluate(() => navigator.clipboard.readText());
  ok(copiedTitle.length > 3, `Copy puts the title on the clipboard ("${copiedTitle}")`);
  await page.getByRole("button", { name: "Copy Description" }).click();
  const copiedDescription = await page.evaluate(() => navigator.clipboard.readText());
  ok(copiedDescription.length > 10 && copiedDescription !== copiedTitle, "Copy puts the description on the clipboard");
  await page.getByRole("button", { name: "Copy Price" }).click();
  ok(/^\d+$/.test(await page.evaluate(() => navigator.clipboard.readText())), "Copy puts the price on the clipboard as a plain number");
  const openLink = page.getByRole("link", { name: "Open Finn.no" });
  ok((await openLink.getAttribute("href")).startsWith("https://www.finn.no/"), "the Finn button points to finn.no");
  await shot("post-finn");

  await page.getByRole("checkbox", { name: /I have posted this on Finn/ }).click();
  await page.getByRole("tab", { name: "Finn ✓" }).waitFor();
  ok(true, "marking as posted on Finn is saved");
  await page.getByRole("tab", { name: "eBay" }).click();
  await page.getByRole("button", { name: "Copy Title" }).click();
  const english = await page.evaluate(() => navigator.clipboard.readText());
  ok(english.length > 3 && english.length <= 80, "eBay tab copies the English title (80 characters or fewer)");
  await shot("post-ebay");

  ok(consoleErrors.length === 0, `no errors in the browser console${consoleErrors.length ? `: ${consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
} catch (err) {
  problems.push(String(err));
  console.log("STOPPED ", String(err).split("\n")[0]);
  await shot("where-it-stopped");
} finally {
  await browser.close();
}

console.log(problems.length === 0 ? "\nAll checks passed." : `\n${problems.length} problem(s).`);
process.exit(problems.length === 0 ? 0 : 1);
