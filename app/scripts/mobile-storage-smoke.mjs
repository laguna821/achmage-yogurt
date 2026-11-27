import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
const OUT = resolve(
  process.env.YOGURT_TEST_OUTPUT ||
    resolve(tmpdir(), "achmage-yogurt-mobile-tests"),
);
mkdirSync(OUT, { recursive: true });
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=7.2:sample_rate=22050",
  OUT + "/sample.wav",
]);
for (const ext of ["m4a", "mp3"])
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    OUT + "/sample.wav",
    OUT + "/sample." + ext,
  ]);
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-stream_loop",
  "9",
  "-i",
  OUT + "/sample.wav",
  "-t",
  "65",
  OUT + "/multichunk.wav",
]);
const require = createRequire(resolve(import.meta.dirname, "../package.json")),
  { chromium } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5189/");
const result = await page.evaluate(
  async (files) => {
    const v = await import("/core/vault.ts"),
      r = await import("/core/records.ts"),
      a = await import("/core/audio.ts");
    const created = await v.createVault("browser-test-123");
    await v.setHeader(created.header);
    const key = created.key;
    let n = {
      id: r.noteId(),
      title: "synthetic private title",
      kind: "audio",
      created: 1,
      updated: 1,
      md: "",
      context: "private context",
      next: 0,
      status: "paused",
    };
    await r.saveNote(key, n);
    // 1200 logical chunks = 10h at 30s/chunk; fake ASR, real encryption + IndexedDB commits.
    for (let i = 0; i < 1200; i++)
      n = await r.checkpoint(key, n, {
        index: i,
        start: i * 30,
        end: (i + 1) * 30,
        text: "synthetic segment " + i,
      });
    // Simulate crash after a segment write but before advancing cursor. Resume from durable cursor.
    await v.put(key, `segment:${n.id}:1200`, {
      index: 1200,
      start: 36000,
      end: 36030,
      text: "orphan-uncommitted",
    });
    n = await v.get(key, "note:" + n.id);
    if (n.next !== 1200) throw Error("cursor advanced before commit");
    n = await r.checkpoint(key, n, {
      index: 1200,
      start: 36000,
      end: 36030,
      text: "reprocessed tail",
    });
    const parts = await r.segments(key, n);
    if (parts.length !== 1201 || parts[1200].text !== "reprocessed tail")
      throw Error("resume loss/duplicate");
    const decode = [];
    for (const [name, bytes] of files) {
      try {
        const input = await a.openAudio(new Blob([new Uint8Array(bytes)]));
        const outputs = [];
        for (let i = 0; i * 30 < input.duration; i++) {
          const out = await input.chunk(i, new AbortController().signal);
          if (out.pcm.length > 480001) throw Error("unbounded PCM");
          outputs.push({
            start: out.start,
            end: out.end,
            length: out.pcm.length,
            rms: Math.sqrt(
              out.pcm.reduce((n, x) => n + x * x, 0) / out.pcm.length,
            ),
          });
        }
        input.close();
        decode.push({ name, ok: true, outputs });
      } catch (e) {
        decode.push({ name, ok: false, error: String(e) });
      }
    }
    // Real ciphertext recording read and backup; tests do not upload any data.
    await v.putBlob(
      key,
      `recording:${n.id}:0`,
      new Blob([new Uint8Array(files[0][1])]),
    );
    const backing = await a.openAudio(
      a.recordedSource(key, n.id, [files[0][1].length]),
    );
    const fromEncrypted = await backing.chunk(0, new AbortController().signal);
    backing.close();
    if (!fromEncrypted.pcm.some((x) => Math.abs(x) > 0.001))
      throw Error("encrypted recording decode empty");
    const exported = await v.backupFile(key),
      blob = exported.file;
    let rejected = false;
    try {
      await v.restoreFile(
        new File([blob.slice(0, blob.size - 100)], "truncated.ayvault"),
        "browser-test-123",
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("truncated backup accepted");
    if (!(await v.get(key, "note:" + n.id)))
      throw Error("restore failure destroyed original");
    const restored = await v.restoreFile(blob, "browser-test-123");
    if ((await r.segments(restored, n)).length !== 1201)
      throw Error("restore segments missing");
    if (
      (await v.getBlob(restored, `recording:${n.id}:0`)).size !==
      files[0][1].length
    )
      throw Error("recording missing");
    await exported.cleanup();
    return {
      logicalChunks: 1201,
      asr: "synthetic, not 10h inference",
      checkpointResume: true,
      truncatedRestoreRejected: rejected,
      backupBytes: blob.size,
      encryptedRecordingRead: true,
      decode,
    };
  },
  ["sample.wav", "sample.m4a", "sample.mp3", "multichunk.wav"].map((name) => [
    name,
    Array.from(readFileSync(OUT + "/" + name)),
  ]),
);
console.log(JSON.stringify(result, null, 2));
writeFileSync(OUT + "/core-results.json", JSON.stringify(result, null, 2));
await browser.close();
