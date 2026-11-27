import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "../src/renderer/src/components/Editor";
import { parseTranscript } from "../src/shared/imports";
import * as vault from "./core/vault";
import {
  type Note,
  type Segment,
  noteId,
  listNotes,
  saveNote,
  segments,
  checkpoint,
  deleteNote,
  sourceFingerprint,
} from "./core/records";
import {
  MODELS,
  type ModelId,
  isAppleMobile,
  asrUnavailable,
} from "./core/models";
import { Asr } from "./core/asr";
import { importWeights, modelCacheName } from "./core/modelCache";
import { openAudio, recordedSource, CHUNK_SECONDS } from "./core/audio";
import { getCaptions } from "./core/youtube";
import {
  type AISettings,
  defaultAI,
  endpointURL,
  splitSource,
  organizePart,
} from "./core/organize";
import "../src/renderer/src/achmage.css";
import "./style.css";
const VERSION = "모바일 베타 0.1.4";
const appleMobile = isAppleMobile(navigator);
const asrPhase = {
  download: "모델 다운로드·검증",
  initialize: "모델 실행 준비",
  decode: "음성 해독",
  transcribe: "음성을 글로 전사",
};

const hostLabel = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "주소 확인 필요";
  }
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function download(
  name: string,
  value: Blob | string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(
    value instanceof Blob ? value : new Blob([value], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function App() {
  const [header, setHeader] = useState<vault.Header | null | undefined>(
      undefined,
    ),
    [key, setKey] = useState<CryptoKey>(),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [recoveryMode, setRecoveryMode] = useState(false),
    [recovery, setRecovery] = useState("");
  const [notes, setNotes] = useState<Note[]>([]),
    [note, setNote] = useState<Note>(),
    [tab, setTab] = useState<"records" | "settings" | "new">("records"),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(true);
  const [file, setFile] = useState<File>(),
    [model, setModel] = useState<ModelId>("small"),
    [device, setDevice] = useState<"webgpu" | "wasm">(
      appleMobile ? "wasm" : "webgpu",
    ),
    [language, setLanguage] = useState("korean"),
    [settings, setSettings] = useState<AISettings>(defaultAI),
    [url, setUrl] = useState(""),
    [paste, setPaste] = useState(""),
    [raw, setRaw] = useState(""),
    [showRaw, setShowRaw] = useState(false),
    [shareKey, setShareKey] = useState(""),
    [recording, setRecording] = useState(false),
    [offline, setOffline] = useState(false),
    [update, setUpdate] = useState<ServiceWorker>(),
    [restoreFile, setRestoreFile] = useState<File>(),
    [report, setReport] = useState<object[]>([]),
    [legacy, setLegacy] = useState(
      () => !!localStorage.getItem("yogurt-mobile-lab-draft"),
    );
  const active = useRef<Note | undefined>(undefined),
    writeQueue = useRef(Promise.resolve()),
    controller = useRef<AbortController | undefined>(undefined),
    engine = useRef<Asr | undefined>(undefined),
    recorder = useRef<MediaRecorder | undefined>(undefined),
    busyRef = useRef(false),
    keyRef = useRef<CryptoKey | undefined>(undefined),
    recordError = useRef(false),
    saveRevision = useRef(0),
    saveFailure = useRef(false);
  const notifyError = (e: unknown) => {
    setError(errorText(e));
    setStatus("");
  };
  const updateNote = (n: Note) => {
    active.current = n;
    setNote(n);
    setNotes((old) =>
      [n, ...old.filter((x) => x.id !== n.id)].sort(
        (a, b) => b.updated - a.updated,
      ),
    );
  };
  const persist = async (n: Note) => {
    if (!keyRef.current) throw Error("먼저 잠금을 해제하세요.");
    await saveNote(keyRef.current, n);
    updateNote(n);
  };
  const edit = (patch: Partial<Note>) => {
    if (!active.current || !keyRef.current) return;
    const n = { ...active.current, ...patch, updated: Date.now() };
    updateNote(n);
    setSaved(false);
    const k = keyRef.current,
      revision = ++saveRevision.current;
    writeQueue.current = writeQueue.current
      .then(() => saveNote(k, n))
      .then(() => {
        if (revision === saveRevision.current) {
          saveFailure.current = false;
          setSaved(true);
        }
      })
      .catch((e) => {
        saveFailure.current = true;
        setSaved(false);
        notifyError(e);
      });
  };
  const enter = async (k: CryptoKey) => {
    keyRef.current = k;
    setKey(k);
    setPassword("");
    setShowPassword(false);
    const loadedNotes = await listNotes(k);
    setNotes(loadedNotes);
    const config = await vault.get<{
      ai: AISettings;
      model: ModelId;
      device: "webgpu" | "wasm";
      language: string;
    }>(k, "settings");
    if (config) {
      setSettings(config.ai);
      setModel(config.model);
      setDevice(config.device);
      setLanguage(config.language);
    }
    const unfinished = loadedNotes.find(
      (n) => n.kind === "audio" && n.status === "paused" && n.model,
    );
    if (unfinished) {
      await choose(unfinished);
      setStatus(
        "완료되지 않은 전사 기록을 열었습니다. 저장된 녹음과 완료 구간을 확인하고 이어서 진행하세요.",
      );
    } else setStatus("기록은 이 기기에 암호화해 저장됩니다.");
    void navigator.storage?.persist?.().catch(() => false);
  };
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const c = new AbortController();
    controller.current = c;
    let wake: any;
    try {
      await writeQueue.current;
      if (saveFailure.current)
        throw Error(
          "최근 편집을 저장하지 못했습니다. MD를 내보내 원문을 보관하고 저장 공간을 확인하세요.",
        );
      try {
        wake = await (navigator as any).wakeLock?.request("screen");
      } catch {}
      await fn(c.signal);
    } catch (e) {
      if (c.signal.aborted)
        setStatus("일시 중지했습니다. 완료한 구간은 저장되어 있습니다.");
      else notifyError(e);
    } finally {
      engine.current?.close();
      engine.current = undefined;
      await wake?.release?.().catch(() => {});
      controller.current = undefined;
      busyRef.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    getInitial();
    async function getInitial() {
      try {
        setHeader((await vault.getHeader()) || null);
      } catch (e) {
        notifyError(e);
      }
    }
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          setOffline(!!reg.active);
          if (reg.waiting) setUpdate(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed") {
                if (navigator.serviceWorker.controller) setUpdate(worker);
                else setOffline(true);
              }
            });
          });
          navigator.serviceWorker.addEventListener("controllerchange", () =>
            setOffline(true),
          );
        })
        .catch(notifyError);
    const warn = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const lock = async () => {
    await writeQueue.current;
    if (saveFailure.current) {
      setError("저장 상태를 확인한 뒤 잠그세요.");
      return;
    }
    keyRef.current = undefined;
    setKey(undefined);
    active.current = undefined;
    setNote(undefined);
    setNotes([]);
    setRaw("");
    setPaste("");
    setFile(undefined);
    setSettings(defaultAI);
    setShareKey("");
    setRecovery("");
    setError("");
    setStatus("잠겼습니다.");
  };
  const choose = async (n: Note) => {
    await writeQueue.current;
    updateNote(n);
    setFile(undefined);
    setShareKey("");
    setShowRaw(false);
    setRaw("");
    if (n.kind === "audio" && n.model && n.model in MODELS) {
      setModel(n.asrSelection?.model || (n.model as ModelId));
      if (n.asrSelection?.device || n.device)
        setDevice(n.asrSelection?.device || n.device!);
      if (n.language) setLanguage(n.language);
    }
    setTab("records");
    setError("");
  };
  const create = async (title: string, kind: Note["kind"]) => {
    const n: Note = {
      id: noteId(),
      title,
      kind,
      created: Date.now(),
      updated: Date.now(),
      md: "",
      context: "",
      next: 0,
      status: "ready",
    };
    await persist(n);
    setTab("records");
    setRaw("");
    setShowRaw(false);
    setFile(undefined);
    return n;
  };
  const importText = async (text: string, name: string, ext: string) => {
    const turns = parseTranscript(text, ext).turns;
    let n = await create(name, "text");
    for (const [index, t] of turns.entries())
      n = await checkpoint(keyRef.current!, n, {
        index,
        start: t.startMs / 1000,
        end: t.endMs / 1000,
        text: t.text,
      });
    await persist({ ...n, status: "done", md: ext === "md" ? text : "" });
    setStatus("전사문을 가져왔습니다. 맥락을 추가한 뒤 정리할 수 있습니다.");
  };
  const importFile = (f: File) =>
    void run(async () => {
      if (/\.(txt|md|srt|vtt|json)$/i.test(f.name)) {
        if (f.size > 20 * 1024 * 1024)
          throw Error("텍스트 파일은 20 MB 이하로 가져오세요.");
        await importText(
          await f.text(),
          f.name.replace(/\.[^.]+$/, ""),
          f.name.split(".").pop()!,
        );
      } else {
        await create(f.name.replace(/\.[^.]+$/, ""), "audio");
        setFile(f);
        setStatus(
          "선택한 파일은 서버로 업로드하지 않습니다. 아래에서 기기 전사를 시작하세요.",
        );
      }
    });
  const selectASRProfile = (
    nextModel: ModelId,
    nextDevice: "webgpu" | "wasm",
  ) =>
    void run(async () => {
      const n = active.current!;
      if (n.next && n.model !== nextModel)
        throw Error("이미 전사한 구간이 있어 모델을 바꿀 수 없습니다.");
      const unavailable = asrUnavailable(nextModel, nextDevice, appleMobile);
      if (unavailable) throw Error(unavailable);
      await persist({
        ...n,
        asrSelection: { model: nextModel, device: nextDevice },
      });
      await vault.put(key!, "settings", {
        ai: settings,
        model: nextModel,
        device: nextDevice,
        language,
      });
      setModel(nextModel);
      setDevice(nextDevice);
      setStatus(
        `${nextModel === "tiny" ? "Tiny + CPU를 선택했습니다. 한국어 품질이 낮은 동작 확인용입니다." : "Small + CPU를 선택했습니다. Turbo보다 작은 모델이며 정확도·속도는 다를 수 있습니다."} 선택을 저장했습니다. 아래 전사 시작 버튼을 누르세요.`,
      );
    });
  const transcribe = () =>
    void run(async (signal) => {
      let n = active.current!;
      const unavailable = asrUnavailable(model, device, appleMobile);
      if (unavailable) throw Error(unavailable);
      let input: Parameters<typeof openAudio>[0];
      if (file) {
        const identity = await sourceFingerprint(file, signal, (p) =>
          setStatus(`원본 파일 확인 · ${Math.round(p * 100)}%`),
        );
        if (n.sourceId && n.sourceId !== identity)
          throw Error(
            "처음 전사한 파일과 다릅니다. 같은 원본을 선택하거나 새 기록을 만드세요.",
          );
        n = { ...n, sourceId: identity };
        input = file;
      } else if (n.recording?.parts) {
        input = recordedSource(key!, n.id, n.recording.sizes);
      } else throw Error("먼저 음성 파일을 선택하세요.");
      if (n.next && (n.model !== model || n.language !== language))
        throw Error(
          "이어 전사할 때는 처음 선택한 모델·언어를 유지하세요. 실행 방식은 CPU로 바꿀 수 있습니다.",
        );
      const audio = await openAudio(input);
      const stage = async (phase: NonNullable<Note["asrAttempt"]>["phase"]) => {
        signal.throwIfAborted();
        n = {
          ...n,
          asrAttempt: { phase, state: "running", at: Date.now() },
          updated: Date.now(),
        };
        await persist(n);
      };
      try {
        n = {
          ...n,
          duration: audio.duration,
          asrSelection: undefined,
          model,
          device,
          language,
          status: "paused",
          error: undefined,
        };
        await stage("download");
        setStatus(
          "1/3 모델 다운로드·검증 중 · 아직 전사를 시작하지 않았습니다.",
        );
        let initializing = false;
        const asr = new Asr((p) => {
          if (initializing) return;
          if (p.status === "progress")
            setStatus(
              "1/3 다운로드·검증 · " +
                (p.file || "") +
                " " +
                Math.round(p.progress || 0) +
                "%",
            );
          else if (p.status === "initiate")
            setStatus("모델 파일 확인 · " + p.file);
        });
        engine.current = asr;
        const loaded = await asr.load(model, device, async () => {
          initializing = true;
          await stage("initialize");
          setStatus(
            "2/3 다운로드 완료 · 모델을 메모리에 불러오는 중입니다. 아직 전사 완료가 아닙니다.",
          );
        });
        setReport((r) => [
          ...r,
          { stage: "model-load", model, device, ...loaded },
        ]);
        for (
          let index = n.next;
          index * CHUNK_SECONDS < audio.duration;
          index++
        ) {
          signal.throwIfAborted();
          await stage("decode");
          setStatus(
            `3/3 전사 ${index + 1}/${Math.ceil(audio.duration / CHUNK_SECONDS)} · 완료한 구간부터 자동 저장`,
          );
          const { pcm, start, end } = await audio.chunk(index, signal);
          let output: { text: string; ms: number };
          let energy = 0;
          for (const v of pcm) energy += v * v;
          if (energy / pcm.length < 1e-9) output = { text: "", ms: 0 };
          else {
            await stage("transcribe");
            output = await asr.transcribe(pcm, language);
          }
          signal.throwIfAborted();
          n = await checkpoint(key!, n, {
            index,
            start,
            end,
            text: output.text.trim(),
            ms: output.ms,
          });
          updateNote(n);
          setReport((r) => [
            ...r.slice(-49),
            {
              stage: "asr-chunk",
              index,
              seconds: end - start,
              ms: output.ms,
              model,
              device,
            },
          ]);
        }
        await persist({
          ...n,
          status: "done",
          error: undefined,
          asrAttempt: undefined,
        });
        setStatus(
          "전사를 마쳤습니다. 원문을 검토하고 자료를 더한 뒤 정리하세요.",
        );
      } catch (e) {
        if (n.asrAttempt) {
          n = {
            ...n,
            status: "paused",
            asrAttempt: {
              ...n.asrAttempt,
              state: signal.aborted ? "paused" : "error",
            },
            error: signal.aborted ? undefined : errorText(e),
          };
          await persist(n);
        }
        throw e;
      } finally {
        audio.close();
      }
    });
  const startRecording = () =>
    void run(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        let n = await create(
          "새 녹음 " + new Date().toLocaleString("ko-KR"),
          "audio",
        );
        const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
          (m) => MediaRecorder.isTypeSupported(m),
        );
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
        recorder.current = r;
        recordError.current = false;
        n = {
          ...n,
          recording: { mime: r.mimeType, parts: 0, sizes: [], complete: false },
        };
        await persist(n);
        setRecording(true);
        let writes = Promise.resolve();
        let backlog = 0;
        let storageFailed = false;
        await new Promise<void>((resolve, reject) => {
          r.ondataavailable = (e) => {
            if (!e.data.size) return;
            backlog++;
            if (backlog > 8 && r.state === "recording") {
              recordError.current = true;
              r.stop();
              setError(
                "기기 저장이 녹음을 따라가지 못해 중지했습니다. 저장된 부분은 보존됩니다.",
              );
            }
            writes = writes
              .then(async () => {
                if (storageFailed) return;
                const meta = n.recording!;
                await vault.putBlob(
                  keyRef.current!,
                  `recording:${n.id}:${meta.parts}`,
                  e.data,
                );
                n = {
                  ...n,
                  updated: Date.now(),
                  recording: {
                    ...meta,
                    parts: meta.parts + 1,
                    sizes: [...meta.sizes, e.data.size],
                  },
                };
                await persist(n);
                backlog--;
              })
              .catch((e) => {
                storageFailed = true;
                recordError.current = true;
                if (r.state !== "inactive") r.stop();
                notifyError(e);
              });
          };
          r.onerror = () => {
            recordError.current = true;
            setError("녹음 장치 오류입니다. 저장된 부분은 보존됩니다.");
            if (r.state !== "inactive") r.stop();
          };
          r.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            writes
              .then(async () => {
                await persist({
                  ...n,
                  recording: {
                    ...n.recording!,
                    complete: !recordError.current,
                  },
                });
                resolve();
              })
              .catch(reject);
          };
          r.start(5000);
          setStatus(
            "녹음 중 · 화면을 켜 두세요. 기기 잠금·전화·앱 전환으로 녹음이 중단될 수 있습니다.",
          );
        });
        if (recordError.current)
          throw Error("녹음이 중단되었습니다. 저장한 조각을 보존했습니다.");
        setStatus("녹음을 저장했습니다. 기기에서 전사를 시작할 수 있습니다.");
      } finally {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        recorder.current = undefined;
      }
    });
  const organize = () =>
    void run(async (signal) => {
      const n = active.current!;
      endpointURL(settings.endpoint);
      if (!settings.model)
        throw Error("설정에서 AI 연결과 모델을 먼저 입력하세요.");
      const source = (await segments(key!, n)).map((s) => s.text).join("\n\n");
      if (!source.trim())
        throw Error("먼저 전사문을 가져오거나 음성을 전사하세요.");
      const parts = splitSource(source),
        output: string[] = [];
      const fingerprint = vault.encode(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify({
              source,
              context: n.context,
              title: n.title,
              settings: { ...settings, key: undefined },
            }),
          ),
        ),
      );
      for (let i = 0; i < parts.length; i++) {
        signal.throwIfAborted();
        const cached = await vault.get<{ fingerprint: string; md: string }>(
          key!,
          `ai:${n.id}:${i}`,
        );
        const md =
          cached?.fingerprint === fingerprint
            ? cached.md
            : await organizePart(
                settings,
                parts[i],
                n.title,
                n.context,
                signal,
                (s) => setStatus(`정리 ${i + 1}/${parts.length} · ${s}`),
              );
        await vault.put(key!, `ai:${n.id}:${i}`, { fingerprint, md });
        output.push(md);
      }
      await persist({
        ...active.current!,
        md: output.join("\n\n"),
        aiParts: parts.length,
        error: undefined,
      });
      setStatus(
        parts.length === 1
          ? "원문 대조와 최종 편집을 마쳤습니다. 확인이 필요한 사항을 검토하세요."
          : "각 구간의 원문 대조와 최종 편집을 마쳤습니다. 긴 문서의 구간 사이 중복은 한 번 더 검토하세요.",
      );
    });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("복사했습니다.");
    } catch {
      setError("복사 권한이 없습니다. 파일 내보내기를 이용하세요.");
    }
  };
  const footer = (
    <footer>
      {VERSION} · {offline ? "앱 화면 오프라인 준비됨" : "앱 화면 준비 중"}
      <br />
      음성은 기기에서 처리합니다. AI 정리는 선택한 서버에 전사·맥락을
      전송합니다.
    </footer>
  );
  const updateNotice = update && (
    <section className="notice">
      <p>
        {recovery
          ? "복구 키 보관을 마친 뒤 업데이트할 수 있습니다."
          : "새 버전이 준비되었습니다."}
      </p>
      <button
        disabled={busy || !saved || !!recovery}
        onClick={() => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => location.reload(),
            { once: true },
          );
          update.postMessage("ACTIVATE");
        }}
      >
        {key ? "저장 후 업데이트" : "새 버전 열기"}
      </button>
    </section>
  );
  if (!key)
    return (
      <main className="locked">
        <header className="brand">
          <img src="./icon.svg" alt="" />
          <div>
            <h1>Achmage Yogurt</h1>
            <p>음성을 기록으로, 기록을 내 지식으로.</p>
          </div>
        </header>
        {updateNotice}
        <section className="card onboarding">
          {header === null && (
            <p className="setup-step">1 / 2 · 새 잠금 암호 정하기</p>
          )}
          <h2>
            {header === undefined
              ? "기록함 확인 중…"
              : header === null
                ? "처음이신가요? 여기서 시작하세요"
                : "기록함 잠금 해제"}
          </h2>
          <p>
            {header === null
              ? "회원가입 없이 시작합니다. 이 기기의 기록을 보호할 새 암호를 직접 정해 주세요. GitHub·Apple 계정 비밀번호를 입력하는 곳이 아닙니다."
              : "이 기기에서 기록함을 만들 때 정한 암호를 입력하세요."}
          </p>
          {header === null && (
            <p className="meta">
              새 암호 설정 → 복구 키 보관 → 녹음·파일 가져오기
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (header === null) {
                  const created = await vault.createVault(password);
                  await vault.setHeader(created.header);
                  setHeader(created.header);
                  setRecovery(created.recovery);
                  await enter(created.key);
                  setStatus("");
                  setTab("new");
                } else if (header)
                  await enter(
                    await vault.unlock(header, password, recoveryMode),
                  );
              });
            }}
          >
            <label htmlFor="vault-password">
              {recoveryMode
                ? "복구 키"
                : header === null
                  ? "새 잠금 암호"
                  : "잠금 암호"}
            </label>
            <input
              id="vault-password"
              aria-describedby="password-help"
              placeholder={
                recoveryMode
                  ? "보관한 복구 키를 붙여넣으세요"
                  : header === null
                    ? "기억할 수 있는 암호를 10자 이상 입력"
                    : "이 기기에서 정한 암호"
              }
              minLength={header === null && !recoveryMode ? 10 : undefined}
              autoCapitalize="none"
              spellCheck={false}
              autoComplete={
                header === null ? "new-password" : "current-password"
              }
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p id="password-help" className="meta">
              {recoveryMode
                ? "복구 키로도 기록함을 열 수 있습니다."
                : header === null
                  ? "10자 이상이면 됩니다. 다음에 이 기기의 기록함을 열 때도 이 암호를 씁니다."
                  : "암호가 기억나지 않으면 아래에서 복구 키 사용을 선택하세요."}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              입력한 {recoveryMode ? "복구 키" : "암호"} 보기
            </label>
            <button
              className="primary setup-next"
              disabled={busy || header === undefined}
            >
              {busy
                ? "기록함 여는 중…"
                : header === null
                  ? "이 암호로 시작하기"
                  : "잠금 해제"}
            </button>
          </form>
          {header === null && (
            <p className="meta">
              기록은 이 기기에 암호화해 저장됩니다. 다른 기기로 자동 동기화되지
              않습니다.
            </p>
          )}
          {header && (
            <label className="check">
              <input
                type="checkbox"
                checked={recoveryMode}
                onChange={(e) => setRecoveryMode(e.target.checked)}
              />
              복구 키 사용
            </label>
          )}
          <details>
            <summary>이미 백업 파일이 있나요?</summary>
            <p>
              처음 시작한다면 이 항목은 건너뛰세요. 백업이 있다면 위 입력란에
              백업을 만들 때 쓴 암호를 입력하세요. 현재 기기의 기록함을 백업
              내용으로 교체합니다. 앱에서 녹음한 음성도 복원합니다. 가져온 외부
              원본 파일은 다시 선택해야 합니다.
            </p>
            <input
              aria-label="복원할 백업"
              type="file"
              accept=".ayvault"
              onChange={(e) => setRestoreFile(e.target.files?.[0])}
            />
            <button
              disabled={!restoreFile || !password || busy}
              onClick={() => {
                if (
                  header &&
                  !confirm(
                    "현재 기록함을 백업으로 교체할까요? 기존 기록은 먼저 백업해 두세요.",
                  )
                )
                  return;
                void run(async () => {
                  const k = await vault.restoreFile(
                    restoreFile!,
                    password,
                    recoveryMode,
                  );
                  setHeader((await vault.getHeader())!);
                  await enter(k);
                });
              }}
            >
              위 암호·복구 키로 복원
            </button>
          </details>
        </section>
        {error && <p role="alert">{error}</p>}
        {footer}
      </main>
    );
  if (recovery)
    return (
      <main className="locked">
        {updateNotice}
        <section className="card onboarding">
          <p className="setup-step">2 / 2 · 복구 키 보관하기</p>
          <h1>이제 복구 키만 보관하면 됩니다</h1>
          <p>
            암호를 잊었을 때 필요한 키입니다. 암호 관리자 등 다른 안전한 곳에
            보관하세요. 이 키만으로 사라진 기기 데이터를 되살릴 수는 없으므로
            백업도 필요합니다.
          </p>
          <textarea readOnly aria-label="새 기록함 복구 키" value={recovery} />
          <button onClick={() => void copy(recovery)}>복구 키 복사</button>
          <p className="meta">
            복사한 키를 암호 관리자 등 안전한 곳에 붙여넣어 보관한 뒤, 아래
            버튼을 누르세요.
          </p>
          {status && <p role="status">{status}</p>}
          <button
            className="primary setup-next"
            onClick={() => {
              setRecovery("");
              setStatus(
                "준비가 끝났습니다. 아래에서 마이크로 녹음하거나 가지고 있는 파일을 선택하세요. AI 연결은 나중에 설정해도 됩니다.",
              );
            }}
          >
            보관했어요 · 녹음 시작 화면으로
          </button>
        </section>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <main>
      <header className="topbar">
        <button
          className="brand-link"
          disabled={busy}
          onClick={() => {
            setNote(undefined);
            active.current = undefined;
            setTab("records");
          }}
        >
          <img src="./icon.svg" alt="" />
          Achmage Yogurt
        </button>
        <button disabled={busy} onClick={() => void lock()}>
          잠그기
        </button>
      </header>
      <nav className="tabs">
        <button
          aria-current={tab === "records" ? "page" : undefined}
          disabled={busy}
          onClick={() => setTab("records")}
        >
          내 기록
        </button>
        <button
          aria-current={tab === "new" ? "page" : undefined}
          disabled={busy}
          onClick={() => setTab("new")}
        >
          새로 가져오기
        </button>
        <button
          aria-current={tab === "settings" ? "page" : undefined}
          disabled={busy}
          onClick={() => setTab("settings")}
        >
          설정
        </button>
      </nav>
      {legacy && (
        <section className="notice">
          <p>
            이전 모바일 시험의 초안이 남아 있습니다. 새 기록함으로 옮기면 이전의
            암호화되지 않은 사본을 지웁니다.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const text = localStorage.getItem("yogurt-mobile-lab-draft");
                if (text) await importText(text, "이전 모바일 시험 초안", "md");
                localStorage.removeItem("yogurt-mobile-lab-draft");
                setLegacy(false);
              })
            }
          >
            초안을 암호화해 이동
          </button>
        </section>
      )}
      {updateNotice}
      {(status || error) && (
        <section className={error ? "notice error" : "notice"}>
          <p role={error ? "alert" : "status"}>{error || status}</p>
          {busy && !recording && (
            <button
              onClick={() => {
                controller.current?.abort();
                engine.current?.close();
              }}
            >
              일시 중지
            </button>
          )}
          {recording && (
            <button
              className="primary"
              onClick={() => recorder.current?.stop()}
            >
              녹음 마치기
            </button>
          )}
          {!busy && (
            <button
              aria-label="알림 지우기"
              onClick={() => {
                setStatus("");
                setError("");
              }}
            >
              닫기
            </button>
          )}
        </section>
      )}
      {tab === "new" && (
        <div className="new-grid">
          <section className="card">
            <span className="eyebrow">LOCAL AUDIO</span>
            <h2>녹음·음성 가져오기</h2>
            <p>
              파일은 서버에 업로드하지 않습니다. 원본을 보관하면 전사 중단 후
              같은 파일로 이어갈 수 있습니다.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={startRecording}
            >
              마이크로 녹음 시작
            </button>
            <label className="file-button">
              음성·영상·전사문 파일
              <input
                disabled={busy}
                type="file"
                accept="audio/*,video/*,.txt,.md,.srt,.vtt,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </section>
          <section className="card">
            <span className="eyebrow">YOUTUBE</span>
            <h2>YouTube 자막 가져오기</h2>
            <p>
              영상 전체를 다시 전사하기 전에 자막을 읽습니다. 직접 접근이 막힌
              영상은 자막·전사 파일을 가져올 수 있습니다.
            </p>
            <label>
              영상 링크
              <input
                type="url"
                value={url}
                placeholder="https://www.youtube.com/watch?v=…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !url}
              onClick={() =>
                void run(async (signal) => {
                  setStatus("YouTube 자막 확인 중…");
                  const result = await getCaptions(url, signal);
                  let n = await create(result.title, "youtube");
                  n = { ...n, url: result.url };
                  for (const [index, t] of result.turns.entries())
                    n = await checkpoint(key, n, {
                      index,
                      start: t.startMs / 1000,
                      end: t.endMs / 1000,
                      text: t.text,
                    });
                  await persist({ ...n, status: "done" });
                  setStatus(
                    "자막을 가져왔습니다. " +
                      (result.automatic
                        ? "자동 생성 자막입니다."
                        : "제공된 자막입니다."),
                  );
                })
              }
            >
              자막 가져오기
            </button>
          </section>
          <section className="card">
            <h2>전사문 붙여넣기</h2>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="다른 녹음 앱의 전사문도 넣을 수 있습니다."
            />
            <button
              disabled={busy || !paste.trim()}
              onClick={() =>
                void run(async () => {
                  await importText(paste, "가져온 전사문", "txt");
                  setPaste("");
                })
              }
            >
              기록 만들기
            </button>
          </section>
        </div>
      )}
      {tab === "records" && !note && (
        <section>
          <div className="section-title">
            <h1>내 기록</h1>
            <button
              className="primary"
              disabled={busy}
              onClick={() => setTab("new")}
            >
              새 기록
            </button>
          </div>
          {!notes.length && (
            <section className="empty">
              <h2>첫 기록을 시작하세요</h2>
              <p>짧은 녹음이나 기존 전사문부터 가져와 보세요.</p>
              <button onClick={() => setTab("new")}>녹음·파일·YouTube</button>
            </section>
          )}
          <div className="record-list">
            {notes.map((n) => (
              <button
                key={n.id}
                className="record-card"
                disabled={busy}
                onClick={() => void choose(n)}
              >
                <span>
                  {n.kind === "youtube"
                    ? "YouTube"
                    : n.kind === "audio"
                      ? "녹음·음성"
                      : "전사문"}
                </span>
                <strong>{n.title}</strong>
                <small>
                  {new Date(n.updated).toLocaleString("ko-KR")} ·{" "}
                  {n.md
                    ? "정리됨"
                    : n.status === "paused"
                      ? "전사 미완료 · 저장 " + n.next + "구간"
                      : n.next
                        ? "전사 " + n.next + "구간"
                        : "준비 중"}
                  {n.error ? " · 확인 필요" : ""}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {tab === "records" && note && (
        <article>
          <button
            disabled={busy}
            className="back"
            onClick={() => {
              setNote(undefined);
              active.current = undefined;
            }}
          >
            ← 전체 기록
          </button>
          <input
            className="title-input"
            aria-label="기록 제목"
            disabled={busy}
            value={note.title}
            onChange={(e) => edit({ title: e.target.value })}
          />
          <div className="meta">
            {note.kind === "youtube"
              ? "YouTube 영상"
              : note.kind === "audio"
                ? "녹음·음성"
                : "가져온 전사문"}{" "}
            · {saved ? "암호화 저장됨" : "저장 중 / 상태 확인"}
            {note.url && (
              <>
                {" "}
                ·{" "}
                <a href={note.url} target="_blank" rel="noreferrer">
                  원본 열기
                </a>
              </>
            )}
          </div>
          {note.kind === "audio" && (
            <section className="card">
              <h2>기기에서 전사</h2>
              {note.status === "paused" && !busy && (
                <section className="notice">
                  <div>
                    <strong>전사가 완료되지 않았습니다</strong>
                    <p>
                      {note.asrAttempt
                        ? `마지막 저장 단계: ${asrPhase[note.asrAttempt.phase]}`
                        : "이전 전사가 완료되기 전에 중단되었습니다."}{" "}
                      · 완료한 구간 {note.next}개
                    </p>
                    <p>
                      {note.recording?.parts
                        ? "녹음은 이 기기에 남아 있습니다. 다시 녹음할 필요 없이 이어서 전사할 수 있습니다."
                        : "가져왔던 원본 파일을 다시 선택하면 완료 구간 다음부터 이어갑니다."}
                    </p>
                    {note.asrAttempt?.state === "running" && (
                      <p>
                        페이지가 다시 열리며 작업이 중단된 것으로 보입니다.
                        정확한 종료 원인은 아직 확인되지 않았습니다.
                      </p>
                    )}
                    {note.error && <p role="alert">{note.error}</p>}
                    <button
                      onClick={() =>
                        void copy(
                          JSON.stringify(
                            {
                              version: VERSION,
                              userAgent: navigator.userAgent,
                              model: note.model,
                              device: note.device,
                              attempt: note.asrAttempt,
                              nextSelection: note.asrSelection,
                              completedChunks: note.next,
                              duration: note.duration,
                            },
                            null,
                            2,
                          ),
                        )
                      }
                    >
                      중단 진단 복사
                    </button>
                  </div>
                </section>
              )}
              <p>
                {MODELS[model].label} · 첫 다운로드 {MODELS[model].download}
                <br />
                {MODELS[model].hint}
                <br />
                실행 방식:{" "}
                {device === "wasm" ? "CPU (WASM)" : "GPU (WebGPU · 실험)"}
              </p>
              {asrUnavailable(model, device, appleMobile) &&
                note.status !== "done" && (
                  <section className="notice" role="status">
                    <div>
                      <strong>Turbo를 다시 실행하지 않습니다</strong>
                      <p>{asrUnavailable(model, device, appleMobile)}</p>
                      <p>
                        기존 녹음은 유지됩니다. 모델 변경은 아래 버튼을 눌렀을
                        때만 적용됩니다.
                      </p>
                      {note.next > 0 && (
                        <p>
                          이미 전사한 구간이 있어 이 기록의 모델을 바꿀 수
                          없습니다. 새 기록에 원본을 가져와 전사하세요.
                        </p>
                      )}
                    </div>
                  </section>
                )}
              {appleMobile && (
                <p className="meta">
                  iPhone에서는 CPU를 기본으로 사용합니다. GPU 지원 표시만으로
                  전사 안정성이 보장되지는 않습니다. 다운로드 용량과 실행 중
                  메모리 사용량은 다릅니다.
                </p>
              )}
              {note.status !== "done" && !busy && (
                <div className="controls">
                  {note.next === 0 && model === "turbo" && (
                    <button
                      className="primary"
                      onClick={() => selectASRProfile("small", "wasm")}
                    >
                      Small + CPU로 전환
                    </button>
                  )}
                  {model !== "turbo" && device === "webgpu" && (
                    <button onClick={() => selectASRProfile(model, "wasm")}>
                      같은 모델 · CPU로 전환
                    </button>
                  )}
                  {note.next === 0 &&
                    (model !== "tiny" || device !== "wasm") && (
                      <button onClick={() => selectASRProfile("tiny", "wasm")}>
                        가벼운 동작 확인 · Tiny + CPU
                      </button>
                    )}
                </div>
              )}
              {!note.recording && note.status !== "done" && (
                <label>
                  원본 파일{note.next > 0 ? " 다시 선택 (이어 전사)" : ""}
                  <input
                    disabled={busy}
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => setFile(e.target.files?.[0])}
                  />
                </label>
              )}
              {file && <p>{file.name}</p>}
              {note.recording && (
                <p>
                  이 기기에 녹음 {note.recording.parts}개 조각 저장됨
                  {!note.recording.complete
                    ? " · 중단된 녹음: 원본 복구 가능 여부를 확인하세요."
                    : ""}
                </p>
              )}
              <div className="controls">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (!file && !note.recording) ||
                    note.status === "done" ||
                    !!asrUnavailable(model, device, appleMobile)
                  }
                  onClick={transcribe}
                >
                  {note.status === "done"
                    ? "전사 완료"
                    : note.next
                      ? "이어 전사하기"
                      : "기기에서 전사 시작"}
                </button>
                <button disabled={busy} onClick={() => setTab("settings")}>
                  모델 설정
                </button>
              </div>
              {note.duration && (
                <p>
                  전체 {Math.floor(Math.round(note.duration) / 60)}분{" "}
                  {Math.round(note.duration) % 60}초 · 저장한 구간 {note.next}/
                  {Math.ceil(note.duration / CHUNK_SECONDS)}
                </p>
              )}
              <small>
                작업 중에는 화면을 켜 두세요. 화면 잠금 후 계속 실행되는 것은
                보장되지 않습니다.
              </small>
            </section>
          )}
          <details className="card" open={!note.md}>
            <summary>정리에 필요한 맥락·확인 답변</summary>
            <p>
              누구와 나눈 이야기인지, 발표 자료나 정확한 용어, 이전 정리의 확인
              질문에 대한 답을 넣어 주세요.
            </p>
            <textarea
              disabled={busy}
              value={note.context}
              onChange={(e) => edit({ context: e.target.value })}
              placeholder="예: 강의 주제, 참석자, 모호한 이름의 정확한 표기…"
            />
            <label>
              참고 텍스트 첨부 (TXT·MD)
              <input
                disabled={busy}
                type="file"
                multiple
                accept=".txt,.md"
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  void run(async () => {
                    let text = active.current!.context;
                    for (const f of files) {
                      if (f.size > 2 * 1024 * 1024)
                        throw Error(
                          "참고 텍스트는 파일당 2 MB 이하로 선택하세요.",
                        );
                      text +=
                        "\n\n[참고 자료: " + f.name + "]\n" + (await f.text());
                    }
                    await persist({ ...active.current!, context: text });
                  });
                }}
              />
            </label>
            <small>
              이 버전은 입력한 자료를 대조합니다. Gmail·볼트·웹 검색 연결은
              포함하지 않습니다.
            </small>
          </details>
          <section className="organize-bar">
            <div>
              <strong>
                {note.kind === "youtube" ? "이 영상 정리하기" : "기록 정리하기"}
              </strong>
              <p>
                {settings.endpoint && settings.model
                  ? `${settings.model} · ${hostLabel(settings.endpoint)}`
                  : "설정에서 AI 연결을 입력하세요."}
              </p>
              <small>
                시작하면 원문과 참고 텍스트를 해당 AI 서버로 보냅니다. API
                이용료가 발생할 수 있습니다.
              </small>
            </div>
            <button
              className="primary"
              disabled={busy || !note.next}
              onClick={organize}
            >
              자료를 대조해 정리
            </button>
          </section>
          <div className="controls">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setRaw(
                    (await segments(key, note)).map((s) => s.text).join("\n\n"),
                  );
                  setShowRaw((x) => !x);
                })
              }
            >
              {showRaw ? "전사문 닫기" : "전사 원문 보기"}
            </button>
            <button
              disabled={busy || !note.md}
              onClick={() => void copy(note.md)}
            >
              MD 복사
            </button>
            <button
              disabled={busy || !note.md}
              onClick={() => download("record.md", note.md, "text/markdown")}
            >
              MD 내보내기
            </button>
          </div>
          {showRaw && (
            <section className="card">
              <h2>전사 원문</h2>
              <pre>{raw || "아직 전사한 내용이 없습니다."}</pre>
              <button
                onClick={() => download("transcript.txt", raw, "text/plain")}
              >
                전사문 내보내기
              </button>
            </section>
          )}
          {note.md ? (
            <Editor
              key={note.id}
              markdown={note.md}
              label="기록 편집기"
              testId="mobile-editor"
              onChange={(text) => edit({ md: text })}
              streaming={busy}
            />
          ) : (
            <section className="empty">
              <p>
                정리한 문서가 여기에 표시됩니다.
                <br />
                문단을 눌러 수정하고, 다이어그램의 &lt;/&gt;로 코드를 편집할 수
                있습니다.
              </p>
            </section>
          )}
          <details className="card">
            <summary>암호화 공유·기록 관리</summary>
            <p>
              문서 파일과 키를 모두 가진 사람은 읽을 수 있습니다. 계정이나 특정
              기기에 한정한 공유가 아닙니다. 제목·본문·맥락·전사문을 함께
              암호화합니다. 원본 음성은 제외합니다.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await vault.encryptedDocument({
                    title: note.title,
                    md: note.md,
                    context: note.context,
                    segments: await segments(key, note),
                  });
                  download("document.aynote", result.file);
                  setShareKey(result.key);
                })
              }
            >
              암호화 문서 내보내기
            </button>
            {shareKey && (
              <label>
                이 파일 전용 복호화 키<textarea readOnly value={shareKey} />
                <button onClick={() => void copy(shareKey)}>
                  공유 키 복사
                </button>
              </label>
            )}
            <button
              disabled={busy}
              onClick={() => {
                if (!confirm("이 기기에서 이 기록과 녹음 조각을 삭제할까요?"))
                  return;
                void run(async () => {
                  await deleteNote(key, note);
                  setNotes((old) => old.filter((n) => n.id !== note.id));
                  active.current = undefined;
                  setNote(undefined);
                  setStatus("기록을 삭제했습니다.");
                });
              }}
            >
              기록 삭제
            </button>
          </details>
        </article>
      )}
      {tab === "settings" && (
        <div className="settings">
          <h1>설정</h1>
          <section className="card">
            <h2>로컬 음성 모델</h2>
            <label>
              전사 모델
              <select
                aria-label="전사 모델"
                disabled={busy}
                value={model}
                onChange={(e) => setModel(e.target.value as ModelId)}
              >
                {Object.entries(MODELS).map(([id, m]) => (
                  <option
                    key={id}
                    value={id}
                    disabled={appleMobile && id === "turbo"}
                  >
                    {m.label}
                    {appleMobile && id === "turbo"
                      ? " · iPhone/iPad 사용 중지"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {MODELS[model].download} · {MODELS[model].hint}
            </p>
            {asrUnavailable(model, device, appleMobile) && (
              <p role="status">{asrUnavailable(model, device, appleMobile)}</p>
            )}
            <label>
              실행 방식
              <select
                aria-label="실행 방식"
                value={device}
                onChange={(e) => setDevice(e.target.value as typeof device)}
              >
                <option value="webgpu">WebGPU (GPU)</option>
                <option value="wasm">WASM (CPU · 느릴 수 있음)</option>
              </select>
            </label>
            <label>
              언어
              <select
                aria-label="언어"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="korean">한국어 중심 · 영어 단어 포함</option>
                <option value="auto">자동 감지</option>
                <option value="english">영어</option>
              </select>
            </label>
            <p>
              모델은 Hugging Face에서 다운로드해 브라우저에 캐시합니다. 앱
              설치와 모델 다운로드는 별개입니다. 기기 저장 공간이 정리되면 다시
              다운로드할 수 있습니다.
            </p>
            <details>
              <summary>모델 파일 직접 가져오기</summary>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await caches.delete(modelCacheName);
                    setStatus(
                      "Yogurt 모델 캐시를 비웠습니다. 기록과 녹음은 그대로 있습니다.",
                    );
                  })
                }
              >
                모델 캐시 비우기
              </button>
              <p>
                선택한 모델의 encoder와 merged decoder ONNX 파일을 넣을 수
                있습니다. 정확한 버전과 SHA-256을 확인한 뒤 저장합니다.
                설정·토크나이저는 첫 실행 때 소량 다운로드합니다.
              </p>
              <input
                aria-label="모델 ONNX 파일"
                type="file"
                multiple
                accept=".onnx"
                disabled={busy}
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  void run(async () => {
                    await importWeights(model, files, setStatus);
                    setStatus("모델 파일을 검증해 저장했습니다.");
                  });
                }}
              />
            </details>
          </section>
          <section className="card">
            <h2>AI 정리 연결</h2>
            <p>
              사용 중인 OpenAI 호환 API나 개인 서버를 연결합니다. 데스크톱
              CLI·ChatGPT·Claude 앱의 구독 로그인은 자동으로 이어지지 않습니다.
              서버가 이 웹앱 주소의 CORS 요청을 허용해야 합니다.
            </p>
            <label>
              Chat Completions 전체 URL
              <input
                type="url"
                value={settings.endpoint}
                placeholder="https://…/v1/chat/completions"
                onChange={(e) =>
                  setSettings({ ...settings, endpoint: e.target.value })
                }
              />
            </label>
            <label>
              모델 ID
              <input
                value={settings.model}
                placeholder="서버에서 지원하는 모델 ID"
                onChange={(e) =>
                  setSettings({ ...settings, model: e.target.value })
                }
              />
            </label>
            <label>
              API 키 (이 기기에 암호화 저장)
              <input
                autoComplete="off"
                type="password"
                value={settings.key}
                onChange={(e) =>
                  setSettings({ ...settings, key: e.target.value })
                }
              />
            </label>
            <label>
              추론 강도
              <select
                value={settings.reasoning}
                onChange={(e) =>
                  setSettings({ ...settings, reasoning: e.target.value })
                }
              >
                <option value="">서버 기본값</option>
                {["low", "medium", "high", "xhigh"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              최대 출력 토큰
              <input
                type="number"
                min={4096}
                max={32000}
                value={settings.maxOutput}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxOutput: Number(e.target.value),
                  })
                }
              />
            </label>
          </section>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (settings.endpoint) endpointURL(settings.endpoint);
                if (settings.maxOutput < 4096 || settings.maxOutput > 32000)
                  throw Error("출력 토큰은 4096–32000 사이로 입력하세요.");
                await vault.put(key, "settings", {
                  ai: settings,
                  model,
                  device,
                  language,
                });
                setStatus("설정을 암호화해 저장했습니다.");
              })
            }
          >
            모델·AI 설정 저장
          </button>
          <section className="card">
            <h2>백업·다른 기기에서 열기</h2>
            <p>
              기기 데이터 삭제에 대비해 백업하세요. 문서·전사·AI 설정을 암호화한
              파일입니다. 잠금 암호 또는 복구 키가 필요합니다. 앱에서 녹음한
              음성도 포함합니다. 가져온 외부 원본 파일은 별도로 보관하세요.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setStatus("암호화 백업을 파일로 만들고 있습니다…");
                  const backup = await vault.backupFile(key);
                  download("achmage-yogurt.ayvault", backup.file);
                  setTimeout(
                    () => void backup.cleanup().catch(() => {}),
                    60000,
                  );
                  setStatus(
                    "암호화 백업 파일을 내보냈습니다. 앱 내 녹음도 포함합니다.",
                  );
                })
              }
            >
              기록함 백업
            </button>
            <details>
              <summary>암호화 공유 문서 열기</summary>
              <label>
                받은 문서 키
                <input
                  type="password"
                  value={shareKey}
                  onChange={(e) => setShareKey(e.target.value)}
                />
              </label>
              <input
                type="file"
                aria-label="암호화 문서 가져오기"
                accept=".aynote"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void run(async () => {
                      if (f.size > 50 * 1024 * 1024)
                        throw Error("공유 파일이 너무 큽니다.");
                      const d = await vault.openDocument(
                        await f.text(),
                        shareKey,
                      );
                      if (
                        typeof d.title !== "string" ||
                        typeof d.md !== "string" ||
                        typeof d.context !== "string" ||
                        !Array.isArray(d.segments)
                      )
                        throw Error("문서 내용 형식이 다릅니다.");
                      let n = await create(d.title, "text");
                      for (const [index, s] of d.segments.entries()) {
                        if (
                          typeof s.text !== "string" ||
                          !Number.isFinite(s.start) ||
                          !Number.isFinite(s.end)
                        )
                          throw Error("전사 구간 형식이 다릅니다.");
                        n = await checkpoint(key, n, {
                          index,
                          text: s.text,
                          start: s.start,
                          end: s.end,
                        });
                      }
                      await persist({
                        ...n,
                        md: d.md,
                        context: d.context,
                        status: "done",
                      });
                      setShareKey("");
                      setStatus("공유 문서를 내 기록함에 저장했습니다.");
                    });
                }}
              />
            </details>
          </section>
          <section className="card">
            <h2>홈 화면에 설치</h2>
            <p>
              iPhone Safari에서 공유 → 홈 화면에 추가를 선택하세요. 무료이며
              7일마다 다시 인증할 필요가 없습니다. 이 웹앱 주소의 설치본과
              Safari 탭은 저장소가 다를 수 있으므로 이동할 때 백업으로
              확인하세요.
            </p>
            <button
              onClick={() => document.documentElement.classList.toggle("dark")}
            >
              밝게 / 어둡게
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const usage = await navigator.storage.estimate();
                  const adapter = await (
                    navigator as any
                  ).gpu?.requestAdapter();
                  setStatus(
                    `WebGPU ${adapter ? "지원" : "미지원"} · f16 ${adapter?.features.has("shader-f16") ? "지원" : "미지원"} · 기기 저장 사용량 ${Math.round((usage.usage || 0) / 1048576)} MB`,
                  );
                  setReport((r) => [
                    ...r,
                    {
                      stage: "capabilities",
                      gpu: !!adapter,
                      f16: adapter?.features.has("shader-f16") ?? false,
                      storage: usage,
                      standalone: matchMedia("(display-mode: standalone)")
                        .matches,
                    },
                  ]);
                })
              }
            >
              기기·저장 상태 확인
            </button>
            <button
              onClick={() =>
                void copy(
                  JSON.stringify(
                    {
                      version: VERSION,
                      userAgent: navigator.userAgent,
                      results: report,
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              성능 결과 복사 (본문 제외)
            </button>
          </section>
        </div>
      )}
      {footer}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
