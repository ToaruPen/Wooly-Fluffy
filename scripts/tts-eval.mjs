import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const DEFAULT_SERVER_URL = "http://127.0.0.1:3000";
const DEFAULT_ENGINE_URL = "http://127.0.0.1:10101";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TEXTS = [
  "やっほー、きょうもいっしょにあそぼう。",
  "いいね、それすごくたのしそう。",
  "わたしはりんごがだいすき。",
  "つぎはなにをしようか？",
  "それはちょっとむずかしいけど、がんばってみるね。",
  "ありがとう、うれしいな。",
  "だいじょうぶ、ゆっくりでいいよ。",
  "またあとでおはなししようね。",
];

const printHelp = () => {
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  node scripts/tts-eval.mjs [options]\n\n`);
  process.stdout.write(`Modes:\n`);
  process.stdout.write(`  - kiosk mode (default): call /api/v1/kiosk/tts\n`);
  process.stdout.write(`  - engine mode: set --engine-url and optional --speaker-ids\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(
    `  --server-url <url>       Kiosk API base URL (default: ${DEFAULT_SERVER_URL})\n`,
  );
  process.stdout.write(
    `  --engine-url <url>       VOICEVOX-compatible engine URL (default: unset)\n`,
  );
  process.stdout.write(`  --speaker-ids <ids>      Comma-separated ids, e.g. 2,888753760\n`);
  process.stdout.write(`  --texts-file <path>      UTF-8 text file (one utterance per line)\n`);
  process.stdout.write(
    `  --out-dir <path>         Output directory (default: var/tts-eval/<timestamp>)\n`,
  );
  process.stdout.write(
    `  --timeout-ms <number>    Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})\n`,
  );
  process.stdout.write(`  --list-speakers          List speakers from engine and exit\n`);
  process.stdout.write(`  --help                   Show this help\n`);
};

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parseInteger = (value, name) => {
  if (!/^-?\d+$/.test(value)) {
    die(`Invalid ${name}: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    die(`Invalid ${name}: ${value}`);
  }
  return parsed;
};

const parseSpeakerIds = (value) => {
  const ids = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => parseInteger(v, "speaker id"));
  if (ids.length === 0) {
    die("--speaker-ids is empty");
  }
  return [...new Set(ids)];
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    serverUrl: DEFAULT_SERVER_URL,
    engineUrl: "",
    speakerIds: [],
    textsFile: "",
    outDir: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    listSpeakers: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--list-speakers") {
      parsed.listSpeakers = true;
      continue;
    }

    const next = args[i + 1];
    if (!next) {
      die(`Missing value for ${arg}`);
    }

    if (arg === "--server-url") {
      parsed.serverUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--engine-url") {
      parsed.engineUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--speaker-ids") {
      parsed.speakerIds = parseSpeakerIds(next);
      i += 1;
      continue;
    }
    if (arg === "--texts-file") {
      parsed.textsFile = next;
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      parsed.outDir = next;
      i += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseInteger(next, "timeout-ms");
      i += 1;
      continue;
    }

    die(`Unknown argument: ${arg}`);
  }

  return parsed;
};

const normalizeBaseUrl = (url) => url.replace(/\/+$/, "");

const withTimeoutFetch = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchJson = async (url, init, timeoutMs) => {
  const res = await withTimeoutFetch(url, init, timeoutMs);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} ${body.slice(0, 200)}`);
  }
  return await res.json();
};

const fetchWav = async (url, init, timeoutMs) => {
  const res = await withTimeoutFetch(url, init, timeoutMs);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} ${body.slice(0, 200)}`);
  }
  const wav = Buffer.from(await res.arrayBuffer());
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`Invalid WAV response from ${url}`);
  }
  return wav;
};

const readTexts = async (textsFile) => {
  if (!textsFile) {
    return DEFAULT_TEXTS;
  }
  const raw = await fs.readFile(textsFile, "utf8");
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    die(`No usable texts in ${textsFile}`);
  }
  return lines;
};

const timestampForPath = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/u, "Z");

const wavDurationSeconds = (wav) => {
  if (wav.length < 44) {
    return null;
  }
  let cursor = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (cursor + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", cursor, cursor + 4);
    const chunkSize = wav.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && dataStart + 16 <= wav.length) {
      byteRate = wav.readUInt32LE(dataStart + 8);
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    cursor += 8 + chunkSize + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataSize <= 0) {
    return null;
  }
  return Number((dataSize / byteRate).toFixed(3));
};

const listSpeakers = async (engineUrl, timeoutMs) => {
  const speakers = await fetchJson(
    `${normalizeBaseUrl(engineUrl)}/speakers`,
    { method: "GET" },
    timeoutMs,
  );
  if (!Array.isArray(speakers)) {
    throw new Error("Invalid /speakers response");
  }
  process.stdout.write(`speakers: ${speakers.length}\n`);
  for (const speaker of speakers) {
    const speakerName = String(speaker?.name ?? "unknown");
    const styles = Array.isArray(speaker?.styles) ? speaker.styles : [];
    for (const style of styles) {
      const styleName = String(style?.name ?? "unknown");
      const styleId = Number(style?.id ?? NaN);
      if (Number.isFinite(styleId)) {
        process.stdout.write(`- ${speakerName} / ${styleName}: ${styleId}\n`);
      }
    }
  }
};

const defaultSpeakerId = async (engineUrl, timeoutMs) => {
  const speakers = await fetchJson(
    `${normalizeBaseUrl(engineUrl)}/speakers`,
    { method: "GET" },
    timeoutMs,
  );
  if (!Array.isArray(speakers) || speakers.length === 0) {
    throw new Error("No speakers found from engine");
  }
  const firstStyles = Array.isArray(speakers[0]?.styles) ? speakers[0].styles : [];
  if (firstStyles.length === 0) {
    throw new Error("No styles found from engine");
  }
  const styleId = Number(firstStyles[0]?.id ?? NaN);
  if (!Number.isFinite(styleId)) {
    throw new Error("Invalid style id in /speakers response");
  }
  return styleId;
};

const synthesizeWithEngine = async ({ engineUrl, speakerId, text, timeoutMs }) => {
  const baseUrl = normalizeBaseUrl(engineUrl);
  const queryParams = new URLSearchParams({ text, speaker: String(speakerId) });
  const audioQuery = await fetchJson(
    `${baseUrl}/audio_query?${queryParams.toString()}`,
    { method: "POST" },
    timeoutMs,
  );
  const synthesisParams = new URLSearchParams({ speaker: String(speakerId) });
  return await fetchWav(
    `${baseUrl}/synthesis?${synthesisParams.toString()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(audioQuery),
    },
    timeoutMs,
  );
};

const synthesizeWithKiosk = async ({ serverUrl, text, timeoutMs }) => {
  const url = `${normalizeBaseUrl(serverUrl)}/api/v1/kiosk/tts`;
  return await fetchWav(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
    timeoutMs,
  );
};

const ensureDir = async (targetPath) => {
  await fs.mkdir(targetPath, { recursive: true });
};

const main = async () => {
  const args = parseArgs();
  const outDir = args.outDir || path.join("var", "tts-eval", timestampForPath());
  const texts = await readTexts(args.textsFile);

  if (args.listSpeakers) {
    const engineUrl = args.engineUrl || DEFAULT_ENGINE_URL;
    await listSpeakers(engineUrl, args.timeoutMs);
    return;
  }

  const useEngineMode = Boolean(args.engineUrl);
  const speakerIds = [];
  if (useEngineMode) {
    if (args.speakerIds.length > 0) {
      speakerIds.push(...args.speakerIds);
    } else {
      const selected = await defaultSpeakerId(args.engineUrl, args.timeoutMs);
      speakerIds.push(selected);
      process.stdout.write(`speaker_ids not provided, using first style id: ${selected}\n`);
    }
  }

  await ensureDir(outDir);

  const rows = [];
  let okCount = 0;
  let failCount = 0;

  if (useEngineMode) {
    for (const speakerId of speakerIds) {
      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i];
        const start = performance.now();
        const fileName = `engine-${speakerId}-${String(i + 1).padStart(2, "0")}.wav`;
        const filePath = path.join(outDir, fileName);
        try {
          const wav = await synthesizeWithEngine({
            engineUrl: args.engineUrl,
            speakerId,
            text,
            timeoutMs: args.timeoutMs,
          });
          await fs.writeFile(filePath, wav);
          const elapsedMs = Math.round(performance.now() - start);
          const durationSec = wavDurationSeconds(wav);
          rows.push({
            mode: "engine",
            speakerId,
            index: i + 1,
            text,
            file: fileName,
            bytes: wav.length,
            elapsedMs,
            durationSec,
            ok: true,
          });
          okCount += 1;
          process.stdout.write(
            `ok  speaker=${speakerId} #${i + 1} ${elapsedMs}ms -> ${fileName}\n`,
          );
        } catch (err) {
          const elapsedMs = Math.round(performance.now() - start);
          rows.push({
            mode: "engine",
            speakerId,
            index: i + 1,
            text,
            file: fileName,
            bytes: 0,
            elapsedMs,
            durationSec: null,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          failCount += 1;
          process.stderr.write(`ng  speaker=${speakerId} #${i + 1} ${elapsedMs}ms\n`);
        }
      }
    }
  } else {
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const start = performance.now();
      const fileName = `kiosk-${String(i + 1).padStart(2, "0")}.wav`;
      const filePath = path.join(outDir, fileName);
      try {
        const wav = await synthesizeWithKiosk({
          serverUrl: args.serverUrl,
          text,
          timeoutMs: args.timeoutMs,
        });
        await fs.writeFile(filePath, wav);
        const elapsedMs = Math.round(performance.now() - start);
        const durationSec = wavDurationSeconds(wav);
        rows.push({
          mode: "kiosk",
          speakerId: null,
          index: i + 1,
          text,
          file: fileName,
          bytes: wav.length,
          elapsedMs,
          durationSec,
          ok: true,
        });
        okCount += 1;
        process.stdout.write(`ok  kiosk #${i + 1} ${elapsedMs}ms -> ${fileName}\n`);
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - start);
        rows.push({
          mode: "kiosk",
          speakerId: null,
          index: i + 1,
          text,
          file: fileName,
          bytes: 0,
          elapsedMs,
          durationSec: null,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount += 1;
        process.stderr.write(`ng  kiosk #${i + 1} ${elapsedMs}ms\n`);
      }
    }
  }

  const okRows = rows.filter((row) => row.ok);
  const avgMs =
    okRows.length > 0
      ? Math.round(okRows.reduce((sum, row) => sum + row.elapsedMs, 0) / okRows.length)
      : null;
  const avgDurationSec =
    okRows.length > 0
      ? Number(
          (
            okRows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0) /
            okRows.filter((row) => row.durationSec !== null).length
          ).toFixed(3),
        )
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: useEngineMode ? "engine" : "kiosk",
    serverUrl: useEngineMode ? null : normalizeBaseUrl(args.serverUrl),
    engineUrl: useEngineMode ? normalizeBaseUrl(args.engineUrl) : null,
    speakerIds: useEngineMode ? speakerIds : [],
    timeoutMs: args.timeoutMs,
    outDir,
    total: rows.length,
    ok: okCount,
    failed: failCount,
    averageLatencyMs: avgMs,
    averageWavDurationSec: avgDurationSec,
    rows,
  };

  await fs.writeFile(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`\nreport: ${path.join(outDir, "report.json")}\n`);
  process.stdout.write(`ok=${okCount} failed=${failCount} avg_latency_ms=${avgMs ?? "n/a"}\n`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
};

await main();
