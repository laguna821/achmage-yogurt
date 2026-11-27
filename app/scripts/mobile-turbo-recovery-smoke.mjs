// Seeds a 0.1.3-style interrupted Turbo record in a NEW synthetic vault only.
// Recording/encryption/decoding are real; ASR is mocked to test selection and gates.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const { chromium, expect } = createRequire(
  resolve(import.meta.dirname, "../package.json"),
)("@playwright/test");
const out =
  process.env.YOGURT_TEST_OUTPUT ||
  resolve(tmpdir(), "achmage-yogurt-turbo-recovery");
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
let workers = 0;
const network = [];
context.on("request", (r) => {
  if (r.url().includes("huggingface")) network.push(r.url());
});
await context.route("**/asr.worker-*.js", (route) => {
  workers++;
  return route.fulfill({
    contentType: "text/javascript",
    body: `self.onmessage=({data:{id,action,model,device}})=>{if(action!=='transcribe'&&(model!=='small'||device!=='wasm')){self.postMessage({id,error:'wrong retry configuration'});return;}self.postMessage({id,result:action==='transcribe'?{text:'같은 녹음 복구 완료',ms:1}:{loadMs:1}})}`,
  });
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const unlock = async () => {
  await page.getByLabel("잠금 암호", { exact: true }).fill("turbo-test-12345");
  await page.getByRole("button", { name: "잠금 해제", exact: true }).click();
};
try {
  await page.goto(process.env.YOGURT_TEST_URL || "http://127.0.0.1:5188/");
  await page
    .getByLabel("새 잠금 암호", { exact: true })
    .fill("turbo-test-12345");
  await page.getByRole("button", { name: "이 암호로 시작하기" }).click();
  const recovery = await page.getByLabel("새 기록함 복구 키").inputValue();
  await page
    .getByRole("button", { name: "보관했어요 · 녹음 시작 화면으로" })
    .click();
  await page.getByRole("button", { name: "마이크로 녹음 시작" }).click();
  await page.getByRole("button", { name: "녹음 마치기" }).waitFor();
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: "녹음 마치기" }).click();
  await expect(page.getByRole("status")).toContainText("녹음을 저장");
  const recordingBefore = await page.evaluate(async (recovery) => {
    const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const encode = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
    const bytes = (s) => new TextEncoder().encode(s);
    const key = await crypto.subtle.importKey(
      "raw",
      decode(recovery),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("achmage-yogurt-mobile-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const read = (op) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("vault"),
          r = op(tx.objectStore("vault"));
        tx.oncomplete = () => resolve(r.result);
        tx.onerror = () => reject(tx.error);
      });
    const keys = await read((s) => s.getAllKeys());
    const audio = [];
    for (const id of keys) {
      if (String(id).startsWith("recording:"))
        audio.push([id, await read((s) => s.get(id))]);
      if (!String(id).startsWith("note:")) continue;
      const box = await read((s) => s.get(id));
      const n = JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: decode(box.iv), additionalData: bytes(id) },
            key,
            decode(box.data),
          ),
        ),
      );
      Object.assign(n, {
        model: "turbo",
        device: "webgpu",
        language: "korean",
        status: "paused",
        next: 0,
        duration: 107.79733333333333,
        asrAttempt: {
          phase: "initialize",
          state: "running",
          at: 1795772957682,
        },
      });
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: bytes(id) },
        key,
        bytes(JSON.stringify(n)),
      );
      await new Promise((resolve, reject) => {
        const tx = db.transaction("vault", "readwrite");
        tx.objectStore("vault").put({ iv: encode(iv), data: encode(data) }, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
    return JSON.stringify(audio);
  }, recovery);
  await page.reload();
  await unlock();
  await expect(
    page.getByText("Turbo를 다시 실행하지 않습니다", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "기기에서 전사 시작" }),
  ).toBeDisabled();
  if (workers || network.length)
    throw Error("blocked Turbo created worker/download");
  await page.screenshot({
    path: resolve(out, "turbo-blocked.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Small + CPU로 전환", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Small + CPU를 선택" }),
  ).toBeVisible();
  await page.reload();
  await unlock();
  await expect(page.getByText(/Whisper Small · 기본/)).toBeVisible();
  await expect(page.getByText(/실행 방식: CPU/)).toBeVisible();
  await expect(
    page.getByText("Turbo를 다시 실행하지 않습니다", { exact: true }),
  ).toHaveCount(0);
  if (workers) throw Error("model switched automatically started ASR");
  const recordingAfter = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("achmage-yogurt-mobile-v1");
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction("vault"),
      s = tx.objectStore("vault"),
      keys = s.getAllKeys(),
      values = s.getAll();
    return new Promise((resolve) => {
      tx.oncomplete = () => {
        const audio = keys.result.flatMap((k, i) =>
          String(k).startsWith("recording:") ? [[k, values.result[i]]] : [],
        );
        db.close();
        resolve(JSON.stringify(audio));
      };
    });
  });
  if (recordingBefore !== recordingAfter)
    throw Error("audio changed during model switch");
  await page.getByRole("button", { name: "기기에서 전사 시작" }).click();
  await expect(page.getByRole("status")).toContainText("전사를 마쳤습니다", {
    timeout: 20000,
  });
  await page
    .getByRole("button", { name: "전사 원문 보기", exact: true })
    .click();
  await expect(page.locator("pre")).toContainText("같은 녹음 복구 완료");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByLabel("전사 모델", { exact: true })).toHaveValue(
    "small",
  );
  await expect(page.getByLabel("실행 방식", { exact: true })).toHaveValue(
    "wasm",
  );
  await expect(page.locator('option[value="turbo"]')).toHaveJSProperty(
    "disabled",
    true,
  );
  if (errors.length || network.length)
    throw Error(JSON.stringify({ errors, network }));
  const result = {
    legacyTurboBlocked: true,
    noTurboDownload: true,
    explicitSmallCPUPersisted: true,
    recordingBytesUnchanged: true,
    retryCompleted: true,
    ASR: "mocked",
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
