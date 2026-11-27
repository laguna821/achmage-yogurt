import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createVault,
  unlock,
  seal,
  unseal,
  encryptedDocument,
  openDocument,
  encode,
} from "../mobile-lab/core/vault";
import { splitSource, chat } from "../mobile-lab/core/organize";
import { playerResponse, getCaptions } from "../mobile-lab/core/youtube";
describe("mobile security boundaries", () => {
  it("encrypts every save with fresh IV and authenticates identity, password and tampering", async () => {
    const v = await createVault("test-password-123");
    const key = await unlock(v.header, "test-password-123");
    const recovered = await unlock(v.header, v.recovery, true);
    const data = new TextEncoder().encode("민감한 회의 내용");
    const a = await seal(key, data, "record:1"),
      b = await seal(key, data, "record:1");
    expect(a.iv).not.toBe(b.iv);
    expect(
      new TextDecoder().decode(await unseal(recovered, a, "record:1")),
    ).toBe("민감한 회의 내용");
    await expect(unlock(v.header, "wrong")).rejects.toThrow();
    await expect(unseal(key, a, "record:2")).rejects.toThrow();
    await expect(
      unseal(key, { ...a, data: encode(new Uint8Array(24)) }, "record:1"),
    ).rejects.toThrow();
    expect(JSON.stringify(v.header)).not.toContain(v.recovery);
  }, 10000);
  it("portable file contains no titles or plaintext and needs separate bearer key", async () => {
    const d = { title: "회의 비밀 제목", md: "## 개인 내용" };
    const bundle = await encryptedDocument(d);
    expect(bundle.file).not.toContain(d.title);
    expect(bundle.file).not.toContain(bundle.key);
    expect(await openDocument(bundle.file, bundle.key)).toEqual(d);
    await expect(
      openDocument(
        bundle.file,
        encode(crypto.getRandomValues(new Uint8Array(32))),
      ),
    ).rejects.toThrow();
  });
});
describe("mobile source fidelity and API gates", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("retains beginning and end across many bounded chunks including huge paragraphs", () => {
    const source = Array.from(
      { length: 1400 },
      (_, i) => "구간" + i + " " + "abc한글".repeat(20),
    ).join("\n");
    const parts = splitSource(source);
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.every((p) => p.length <= 12000)).toBe(true);
    expect(parts.join("\n")).toBe(source);
    const long = "끝".repeat(24001);
    expect(splitSource(long).join("")).toBe(long);
  });
  it("extracts balanced player JSON without executing page scripts", () => {
    expect(
      playerResponse(
        'window.x=1; ytInitialPlayerResponse = {"x":"}\\\"{","videoDetails":{"title":"yes"}}; evil()',
      ).videoDetails.title,
    ).toBe("yes");
  });
  it("does not retry 429 or start hidden ASR", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", f);
    await expect(
      getCaptions("https://youtu.be/ADP3Wo47m6E", new AbortController().signal),
    ).rejects.toThrow("429");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("refuses partial AI output and redirects; sends only to an explicit endpoint", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "length", message: { content: "partial" } },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", f);
    const config = {
      endpoint: "https://example.org/v1/chat/completions",
      model: "user-model",
      key: "secret",
      reasoning: "high",
      maxOutput: 12000,
    };
    await expect(
      chat(config, "Source", new AbortController().signal),
    ).rejects.toThrow("완성되지");
    expect(f.mock.calls[0][1].redirect).toBe("error");
    expect(f.mock.calls[0][1].credentials).toBe("omit");
    await expect(
      chat(
        { ...config, endpoint: "http://example.org" },
        "Source",
        new AbortController().signal,
      ),
    ).rejects.toThrow("HTTPS");
  });
});

describe("resume source identity", () => {
  it("checks middle bytes too and allows renamed identical files", async () => {
    const { sourceFingerprint } = await import("../mobile-lab/core/records");
    const data = new Uint8Array(3 * 1024 * 1024);
    data[1500000] = 17;
    const original = new File([data], "original.wav");
    const first = await sourceFingerprint(original);
    expect(await sourceFingerprint(new File([data], "renamed.wav"))).toBe(
      first,
    );
    data[1500000] = 18;
    expect(await sourceFingerprint(new File([data], "original.wav"))).not.toBe(
      first,
    );
    const c = new AbortController();
    await expect(
      sourceFingerprint(original, c.signal, () => c.abort()),
    ).rejects.toThrow();
  }, 10000);
});
