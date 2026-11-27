import * as vault from "./vault";
export type Segment = {
  index: number;
  start: number;
  end: number;
  text: string;
  ms?: number;
};
export type Note = {
  id: string;
  title: string;
  kind: "audio" | "youtube" | "text";
  created: number;
  updated: number;
  md: string;
  context: string;
  url?: string;
  sourceId?: string;
  duration?: number;
  model?: string;
  device?: "webgpu" | "wasm";
  language?: string;
  next: number;
  status: "ready" | "paused" | "done";
  error?: string;
  recording?: {
    mime: string;
    parts: number;
    sizes: number[];
    complete: boolean;
  };
  aiParts?: number;
  asrSelection?: {
    model: "tiny" | "small" | "turbo";
    device: "webgpu" | "wasm";
  };
  asrAttempt?: {
    phase: "download" | "initialize" | "decode" | "transcribe";
    state: "running" | "paused" | "error";
    at: number;
  };
};
export const noteId = () => crypto.randomUUID();
export async function listNotes(key: CryptoKey) {
  const ids = (await vault.keys()).filter(
    (x) => typeof x === "string" && x.startsWith("note:"),
  );
  const notes = await Promise.all(
    ids.map((id) => vault.get<Note>(key, String(id))),
  );
  return notes
    .filter((n): n is Note => !!n)
    .sort((a, b) => b.updated - a.updated);
}
export async function segments(key: CryptoKey, n: Note) {
  const out: Segment[] = [];
  for (let i = 0; i < n.next; i++) {
    const part = await vault.get<Segment>(key, `segment:${n.id}:${i}`);
    if (!part) throw Error("전사 구간이 누락되었습니다. 백업을 확인하세요.");
    out.push(part);
  }
  return out;
}
export const saveNote = (key: CryptoKey, n: Note) =>
  vault.put(key, "note:" + n.id, n);
/** Segment first, then cursor. Crash between writes repeats one chunk, never skips it. Idempotent key overwrites. */
export async function checkpoint(key: CryptoKey, n: Note, part: Segment) {
  if (part.index !== n.next) throw Error("저장 순서가 일치하지 않습니다.");
  await vault.put(key, `segment:${n.id}:${part.index}`, part);
  const next = { ...n, next: n.next + 1, updated: Date.now() };
  await saveNote(key, next);
  return next;
}
export async function deleteNote(key: CryptoKey, n: Note) {
  for (const id of await vault.keys())
    if (
      typeof id === "string" &&
      (id === `note:${n.id}` ||
        id.startsWith(`segment:${n.id}:`) ||
        id.startsWith(`recording:${n.id}:`) ||
        id.startsWith(`ai:${n.id}:`))
    )
      await vault.remove(id);
}
/** Hash every input byte in bounded 1 MiB reads; renaming a byte-identical file is safe. */
export async function sourceFingerprint(
  file: File,
  signal?: AbortSignal,
  onProgress?: (n: number) => void,
) {
  const size = 1024 * 1024,
    total = Math.ceil(file.size / size),
    digests = new Uint8Array(total * 32);
  for (let i = 0; i < total; i++) {
    signal?.throwIfAborted();
    digests.set(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          await file.slice(i * size, (i + 1) * size).arrayBuffer(),
        ),
      ),
      i * 32,
    );
    onProgress?.((i + 1) / total);
  }
  signal?.throwIfAborted();
  return JSON.stringify({
    v: 2,
    size: file.size,
    chunkSize: size,
    sha256: vault.encode(await crypto.subtle.digest("SHA-256", digests)),
  });
}
