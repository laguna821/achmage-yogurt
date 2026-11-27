/** Local encryption is separate from website access control. No keys in localStorage or URLs. */
export const encode = (b: ArrayBuffer | Uint8Array) => {
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
};
export const decode = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export type Sealed = { iv: string; data: string };
export type Header = { v: 1; salt: string; wrapped: Sealed; check: Sealed };
const bytes = (s: string) => new TextEncoder().encode(s);
const aes = (raw: Uint8Array) =>
  crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
async function passwordKey(password: string, salt: string) {
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: decode(salt) as BufferSource,
      iterations: 600000,
      hash: "SHA-256",
    },
    await crypto.subtle.importKey("raw", bytes(password), "PBKDF2", false, [
      "deriveKey",
    ]),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  key: CryptoKey,
  data: Uint8Array,
  purpose: string,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    iv: encode(iv),
    data: encode(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: bytes(purpose) },
        key,
        data as BufferSource,
      ),
    ),
  };
}
export async function unseal(key: CryptoKey, box: Sealed, purpose: string) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(box.iv) as BufferSource,
        additionalData: bytes(purpose),
      },
      key,
      decode(box.data) as BufferSource,
    ),
  );
}
export async function createVault(password: string) {
  if (password.length < 10) throw Error("잠금 암호를 10자 이상 입력하세요.");
  const raw = crypto.getRandomValues(new Uint8Array(32)),
    key = await aes(raw),
    salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  const header: Header = {
    v: 1,
    salt,
    wrapped: await seal(await passwordKey(password, salt), raw, "vault-key"),
    check: await seal(key, bytes("Achmage Yogurt vault 1"), "vault-check"),
  };
  return { header, key, recovery: encode(raw) };
}
export async function unlock(
  header: Header,
  password: string,
  recovery = false,
) {
  try {
    const key = await aes(
      recovery
        ? decode(password.trim())
        : await unseal(
            await passwordKey(password, header.salt),
            header.wrapped,
            "vault-key",
          ),
    );
    const check = new TextDecoder().decode(
      await unseal(key, header.check, "vault-check"),
    );
    if (check !== "Achmage Yogurt vault 1") throw Error();
    return key;
  } catch {
    throw Error("암호 또는 복구 키가 맞지 않거나 저장소가 손상되었습니다.");
  }
}
const DEFAULT_DATABASE = "achmage-yogurt-mobile-v1";
const activeDatabase = () =>
  localStorage.getItem("achmage-yogurt-vault-database") || DEFAULT_DATABASE;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(activeDatabase(), 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("vault");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vault", mode),
      r = action(tx.objectStore("vault"));
    tx.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        tx.error ||
          Error("기기 저장에 실패했습니다. 공간과 브라우저 권한을 확인하세요."),
      );
    };
  });
}
export const getHeader = () =>
  transaction<Header | undefined>("readonly", (s) => s.get("header"));
export const setHeader = (h: Header) =>
  transaction("readwrite", (s) => s.put(h, "header"));
export const remove = (id: string) =>
  transaction("readwrite", (s) => s.delete(id));
export const keys = () =>
  transaction<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
async function save(id: string, value: Sealed) {
  await transaction("readwrite", (s) => s.put(value, id));
} // used only for already sealed binary chunks internally
export async function put(key: CryptoKey, id: string, value: unknown) {
  await save(id, await seal(key, bytes(JSON.stringify(value)), id));
}
export async function get<T>(
  key: CryptoKey,
  id: string,
): Promise<T | undefined> {
  const data = await transaction<Sealed | undefined>("readonly", (s) =>
    s.get(id),
  );
  return data
    ? JSON.parse(new TextDecoder().decode(await unseal(key, data, id)))
    : undefined;
}
export async function putBlob(key: CryptoKey, id: string, blob: Blob) {
  await save(id, await seal(key, new Uint8Array(await blob.arrayBuffer()), id));
}
export async function getBlob(key: CryptoKey, id: string) {
  const data = await transaction<Sealed>("readonly", (s) => s.get(id));
  return new Blob([(await unseal(key, data, id)) as BlobPart]);
}
export async function encryptedDocument(value: unknown) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return {
    file: JSON.stringify({
      format: "achmage-yogurt-document",
      v: 1,
      box: await seal(
        await aes(raw),
        bytes(JSON.stringify(value)),
        "shared-document",
      ),
    }),
    key: encode(raw),
  };
}
export async function openDocument(text: string, secret: string) {
  const d = JSON.parse(text);
  if (d.format !== "achmage-yogurt-document" || d.v !== 1)
    throw Error("암호화 문서 형식이 다릅니다.");
  return JSON.parse(
    new TextDecoder().decode(
      await unseal(await aes(decode(secret.trim())), d.box, "shared-document"),
    ),
  );
}

/** Stream an encrypted backup to OPFS. Only ciphertext touches the temporary file. */
export async function backupFile(
  key: CryptoKey,
): Promise<{ file: File; cleanup: () => Promise<void> }> {
  const root = await navigator.storage.getDirectory(),
    name = "yogurt-backup-" + crypto.randomUUID() + ".ayvault";
  const handle = await root.getFileHandle(name, { create: true }),
    writer = await handle.createWritable();
  const receipts: [string, string][] = [];
  try {
    await writer.write(
      JSON.stringify({ format: "achmage-yogurt-vault-stream", v: 2 }) + "\n",
    );
    const ids = await keys();
    ids.sort((a, b) =>
      a === "header"
        ? -1
        : b === "header"
          ? 1
          : String(a).localeCompare(String(b)),
    );
    for (const id of ids) {
      const value = await transaction("readonly", (s) => s.get(id)),
        line = JSON.stringify([id, value]);
      receipts.push([
        String(id),
        encode(await crypto.subtle.digest("SHA-256", bytes(line))),
      ]);
      await writer.write(line + "\n");
    }
    await writer.write(
      JSON.stringify({
        end: await seal(
          key,
          bytes(JSON.stringify(receipts)),
          "backup-manifest",
        ),
      }) + "\n",
    );
    await writer.close();
    return {
      file: await handle.getFile(),
      cleanup: () => root.removeEntry(name),
    };
  } catch (e) {
    await writer.abort().catch(() => {});
    await root.removeEntry(name).catch(() => {});
    throw e;
  }
}
async function* lines(file: Blob) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      let at: number;
      while ((at = pending.indexOf("\n")) >= 0) {
        yield pending.slice(0, at);
        pending = pending.slice(at + 1);
      }
      if (pending.length > 32 * 1024 * 1024)
        throw Error("백업 항목 크기가 비정상적입니다.");
    }
    if (pending.trim()) throw Error("백업 파일 끝이 잘렸습니다.");
  } finally {
    reader.releaseLock();
  }
}
/** Validate and stage in a separate DB; switch the small pointer only after a complete authenticated footer. */
export async function restoreFile(
  file: File,
  password: string,
  recovery = false,
) {
  const iterator = lines(file);
  const first = JSON.parse((await iterator.next()).value || "null");
  if (first?.format !== "achmage-yogurt-vault-stream" || first.v !== 2) {
    await iterator.return();
    throw Error("Yogurt 암호화 백업 파일이 아닙니다.");
  }
  const name = DEFAULT_DATABASE + "-" + crypto.randomUUID(),
    old = activeDatabase();
  const staging = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vault");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let key: CryptoKey | undefined,
    ended = false;
  const receipts: [string, string][] = [];
  const seen = new Set<string>();
  try {
    for await (const line of iterator) {
      if (ended) throw Error("백업 끝에 예상하지 못한 내용이 있습니다.");
      const value = JSON.parse(line);
      if (value.end) {
        if (!key) throw Error("백업 헤더가 없습니다.");
        const manifest = new TextDecoder().decode(
          await unseal(key, value.end, "backup-manifest"),
        );
        if (manifest !== JSON.stringify(receipts))
          throw Error("백업의 일부가 누락되거나 변경되었습니다.");
        ended = true;
        continue;
      }
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof value[0] !== "string" ||
        seen.has(value[0])
      )
        throw Error("백업 항목이 중복되거나 잘못되었습니다.");
      const [id, data] = value;
      seen.add(id);
      if (id === "header") {
        if (key || data.v !== 1) throw Error("백업 헤더가 잘못되었습니다.");
        key = await unlock(data, password, recovery);
      } else {
        if (!key) throw Error("백업 헤더를 먼저 읽어야 합니다.");
        await unseal(key, data, id);
      }
      receipts.push([
        id,
        encode(await crypto.subtle.digest("SHA-256", bytes(line))),
      ]);
      await new Promise<void>((resolve, reject) => {
        const tx = staging.transaction("vault", "readwrite");
        tx.objectStore("vault").put(data, id);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
    if (!key || !ended)
      throw Error("백업이 완성되지 않았습니다. 기존 기록함을 보존했습니다.");
    staging.close();
    localStorage.setItem("achmage-yogurt-vault-database", name);
    indexedDB.deleteDatabase(old);
    return key;
  } catch (e) {
    staging.close();
    indexedDB.deleteDatabase(name);
    throw e;
  } finally {
    await iterator.return();
  }
}
