import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
const OUT = resolve(
  process.env.YOGURT_TEST_OUTPUT ||
    resolve(tmpdir(), "achmage-yogurt-mobile-tests"),
);
mkdirSync(OUT, { recursive: true });
const require = createRequire(resolve(import.meta.dirname, "../package.json")),
  { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  permissions: ["microphone", "clipboard-write", "clipboard-read"],
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [],
  requests = [],
  ai = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => {
  if (!r.url().startsWith("http://127.0.0.1"))
    requests.push({ url: r.url(), method: r.method() });
});
let count = 0;
const md =
  "## 개요\n\n이번 모임에서는 API의 동작과 자료 보존 방법을 검토했다.\n\n## 결정 사항\n\n원본을 보관하고 검증한 문서만 공유한다.\n\n```mermaid\nflowchart LR\nA[원본] --> B[검토]:::achmage\n```";
await page.route(
  "https://test-provider.example/v1/chat/completions",
  async (route) => {
    ai.push(JSON.parse(route.request().postData()));
    count++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: count % 3 === 1 ? "evidence index" : md },
          },
        ],
      }),
    });
  },
);
try {
  await page.goto(process.env.YOGURT_TEST_URL || "http://127.0.0.1:5188/");
  await expect(page.getByText("1 / 2 · 새 잠금 암호 정하기")).toBeVisible();
  const password = page.getByLabel("새 잠금 암호", { exact: true });
  await password.fill("short");
  await page
    .getByRole("button", { name: "이 암호로 시작하기", exact: true })
    .click();
  await expect(password).toBeVisible();
  if (await password.evaluate((input) => input.validity.valid))
    throw Error("short password accepted");
  await page.getByLabel("입력한 암호 보기").check();
  await expect(password).toHaveAttribute("type", "text");
  await password.fill("mobile-ui-12345");
  await page.getByLabel("입력한 암호 보기").uncheck();
  await page.screenshot({ path: OUT + "/onboarding.png", fullPage: true });
  await page
    .getByRole("button", { name: "이 암호로 시작하기", exact: true })
    .click();
  await page.getByRole("button", { name: "복구 키 복사", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("복사했습니다.");
  await page
    .getByRole("button", { name: "보관했어요 · 녹음 시작 화면으로" })
    .click();
  await expect(
    page.getByRole("button", { name: "마이크로 녹음 시작" }),
  ).toBeVisible();
  await page
    .locator("textarea")
    .fill(
      "PRIVATE_SYNTHETIC_123 검증용 원문입니다. API 동작을 검토하고 원본을 보관하기로 결정했습니다.",
    );
  await page.getByRole("button", { name: "기록 만들기", exact: true }).click();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByLabel("Chat Completions 전체 URL")
    .fill("https://test-provider.example/v1/chat/completions");
  await page.getByLabel("모델 ID", { exact: true }).fill("mock-test-only");
  await page.getByRole("button", { name: "모델·AI 설정 저장" }).click();
  await page.getByRole("button", { name: "내 기록", exact: true }).click();
  await page.getByRole("button", { name: "자료를 대조해 정리" }).click();
  await expect(page.getByTestId("mobile-editor")).toBeVisible();
  if (
    ai.length !== 3 ||
    ai.some(
      (call) => !call.messages[1].content.includes("PRIVATE_SYNTHETIC_123"),
    )
  )
    throw Error("source missing from editorial pass");
  await expect(page.locator("svg.pele")).toHaveCount(1);
  await page.screenshot({ path: OUT + "/editor-ui.png", fullPage: true });
  await page.getByRole("button", { name: "MD 내보내기", exact: true }).click();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "기록함 백업", exact: true }).click();
  const backup = await waiting;
  await backup.saveAs(OUT + "/test-backup.ayvault");
  const state = await page.evaluate(async () => {
    const name =
      localStorage.getItem("achmage-yogurt-vault-database") ||
      "achmage-yogurt-mobile-v1";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve) => {
      const tx = db.transaction("vault"),
        r = tx.objectStore("vault").getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(JSON.stringify(r.result));
      };
    });
  });
  if (
    state.includes("PRIVATE_SYNTHETIC_123") ||
    state.includes("mock-test-only")
  )
    throw Error("plaintext leaked in IDB");
  await page.getByRole("button", { name: "새로 가져오기" }).click();
  await page.getByRole("button", { name: "마이크로 녹음 시작" }).click();
  await page.getByRole("button", { name: "녹음 마치기" }).waitFor();
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: "녹음 마치기" }).click();
  await expect(page.getByRole("status")).toContainText("녹음을 저장");
  await page.getByRole("button", { name: "잠그기", exact: true }).click();
  await page.reload();
  await page.getByLabel("잠금 암호", { exact: true }).fill("mobile-ui-12345");
  await page.getByRole("button", { name: "잠금 해제", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(2);
  // App shell stays available offline; model is explicitly not included in this check.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "기록함 잠금 해제", exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  const result = {
    errors,
    aiCalls: ai.length,
    encryptedPersistence: true,
    recordingPersisted: true,
    offlineShell: true,
    overflow,
    requests,
  };
  writeFileSync(OUT + "/ui-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length || overflow) throw Error("UI validation failed");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: OUT + "/ui-failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}
