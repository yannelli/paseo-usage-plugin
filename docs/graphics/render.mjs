import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
await mkdir(join(root, "docs/images"), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [view, file, width, height, scale] of [
    ["hero", "docs/images/github-banner.png", 1280, 720, 1.5],
    ["preview", "docs/images/quota-preview.png", 1280, 720, 1.5],
    ["social", "docs/images/social-preview.png", 1280, 640, 1],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${pathToFileURL(join(root, "docs/graphics/banner.html"))}?view=${view}`);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, []);
    const valid = await page.evaluate(() => {
      const visible = (element) => element.getBoundingClientRect().width > 0;
      return document.fonts.check("16px Geist") && document.fonts.check("16px 'Geist Mono'")
        && [...document.images].every((img) => img.complete && img.naturalWidth > 0)
        && [...document.querySelectorAll("[data-bounds]")].filter(visible).every((element) => {
          const box = element.getBoundingClientRect();
          return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
            && element.scrollHeight <= element.clientHeight;
        });
    });
    assert(valid, `${view}: missing font/image or overflowing content`);
    const output = join(root, file);
    await page.screenshot({ path: output });
    const bytes = await readFile(output);
    assert.equal(bytes.readUInt32BE(16), width * scale);
    assert.equal(bytes.readUInt32BE(20), height * scale);
    assert((await stat(output)).size < 700_000, `${file} exceeds the image size budget`);
    console.log(`${file}: ${width * scale}×${height * scale}`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.goto(pathToFileURL(join(root, "assets/icon.svg")).href);
  await page.screenshot({ path: join(root, "assets/icon.png"), omitBackground: true });
  console.log("assets/icon.png: 512×512");
} finally {
  await browser.close();
}
