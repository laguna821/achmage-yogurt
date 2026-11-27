// Simulates a browser restart during model initialization and inference.
// No AI/model download: the ASR worker is replaced; recording/storage/decoding stay real.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const { chromium, expect } = createRequire(
  resolve(import.meta.dirname, "../package.json"),
)("@playwright/test");
const out =
  process.env.YOGURT_TEST_OUTPUT ||
  resolve(tmpdir(), "achmage-yogurt-recovery-tests");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/27.2 Mobile/15E148 Safari/604.1",
  permissions: ["microphone"],
  serviceWorkers: "block",
});
let hangAt = "load";
await context.route("**/asr.worker-*.js", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: `self.onmessage=({data:{id,action}})=>{if(action===${JSON.stringify(hangAt)})return;self.postMessage({id,result:action==='transcribe'?{text:'복구한 원본의 전사 결과',ms:1}:{loadMs:1}})}`,
  }),
);
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
const unlock = async () => {
  await page
    .getByLabel("잠금 암호", { exact: true })
    .fill("recovery-test-12345");
  await page.getByRole("button", { name: "잠금 해제", exact: true }).click();
};
try {
  await page.goto(process.env.YOGURT_TEST_URL || "http://127.0.0.1:5188/");
  await page
    .getByLabel("새 잠금 암호", { exact: true })
    .fill("recovery-test-12345");
  await page.getByRole("button", { name: "이 암호로 시작하기" }).click();
  await page
    .getByRole("button", { name: "보관했어요 · 녹음 시작 화면으로" })
    .click();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByLabel("실행 방식", { exact: true })).toHaveValue(
    "wasm",
  );
  await page.getByLabel("실행 방식", { exact: true }).selectOption("webgpu");
  await page.getByRole("button", { name: "모델·AI 설정 저장" }).click();
  await page.getByRole("button", { name: "새로 가져오기" }).click();
  await page.getByRole("button", { name: "마이크로 녹음 시작" }).click();
  await page.getByRole("button", { name: "녹음 마치기" }).waitFor();
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: "녹음 마치기" }).click();
  await expect(page.getByRole("status")).toContainText("녹음을 저장");
  await page.getByRole("button", { name: "기기에서 전사 시작" }).click();
  await expect(page.getByRole("status")).toContainText("2/3 다운로드 완료");
  await page.reload();
  await unlock();
  await expect(
    page.getByText("전사가 완료되지 않았습니다", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/마지막 저장 단계: 모델 실행 준비/),
  ).toBeVisible();
  await expect(page.getByText(/녹음은 이 기기에 남아 있습니다/)).toBeVisible();
  await page.screenshot({
    path: resolve(out, "restored-recording.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "같은 모델 · CPU로 전환" }).click();
  hangAt = "transcribe";
  await page.getByRole("button", { name: "기기에서 전사 시작" }).click();
  // The encrypted phase is saved before the simulated worker starts inference.
  await page.waitForFunction(() =>
    document.body.textContent.includes("3/3 전사"),
  );
  await page.waitForTimeout(1000);
  await page.reload();
  await unlock();
  await expect(
    page.getByText(/마지막 저장 단계: 음성을 글로 전사/),
  ).toBeVisible();
  await expect(page.getByText(/실행 방식: CPU/)).toBeVisible();
  hangAt = "none";
  await page.getByRole("button", { name: "기기에서 전사 시작" }).click();
  await expect(page.getByRole("status")).toContainText("전사를 마쳤습니다", {
    timeout: 20000,
  });
  await page
    .getByRole("button", { name: "전사 원문 보기", exact: true })
    .click();
  await expect(page.locator("pre")).toContainText("복구한 원본의 전사 결과");
  await expect(
    page.getByText("전사가 완료되지 않았습니다", { exact: true }),
  ).toHaveCount(0);
  if (errors.length) throw Error(errors.join("\n"));
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("overflow");
  const result = {
    iPhoneDefaultCPU: true,
    modelInitRestartRecovered: true,
    inferenceRestartRecovered: true,
    recordedAudioPreserved: true,
    explicitCPUResume: true,
    modelWorker: "mocked",
    errors,
  };
  writeFileSync(resolve(out, "results.json"), JSON.stringify(result, null, 2));
  console.log(result);
} catch (e) {
  await page.screenshot({ path: resolve(out, "failure.png"), fullPage: true });
  throw e;
} finally {
  await browser.close();
}
