import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_BASE_URL =
  "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_07_30";

const modelFiles = [
  { name: "adapter.ort", size: 1_319_664, crc32c: "kwQ+Bw==" },
  { name: "cross_kv.ort", size: 1_287_544, crc32c: "76wzFQ==" },
  { name: "decoder_kv.ort", size: 32_583_720, crc32c: "KJjeNw==" },
  { name: "encoder.ort", size: 7_675_440, crc32c: "UjAIpQ==" },
  { name: "frontend.ort", size: 8_324_920, crc32c: "AW9qsg==" },
  { name: "streaming_config.json", size: 509, crc32c: "HGL0Ug==" },
  { name: "tokenizer.bin", size: 249_974, crc32c: "B7s10Q==" },
];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const targetDirectory = join(
  scriptDirectory,
  "..",
  "public",
  "models",
  "tiny-streaming-en",
);
const whisperTargetDirectory = join(
  scriptDirectory,
  "..",
  "public",
  "models",
  "whisper-tiny-en-q5_1",
);

const whisperFiles = [
  {
    name: "main.js",
    url: "https://ggml.ai/whisper.cpp/main.js",
    size: 1_758_816,
    sha256: "3dd30e6e25c0eb8bb1408748c88835b5aeb53c79312c9ccfefaf04286befe762",
    sourceSize: 1_758_776,
    sourceSha256: "8ce297a0a4b2baaf8ffeb91347a2a2747d02357d081b2e31d538f360051c4e8e",
    patches: [
      {
        from: "else if(ENVIRONMENT_IS_WORKER){_scriptName=self.location.href}",
        to: "else if(ENVIRONMENT_IS_WORKER){_scriptName=globalThis.Module?.mainScriptUrlOrBlob||self.location.href}",
      },
    ],
  },
  {
    name: "ggml-tiny.en-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
    size: 32_166_155,
    sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
  },
];

const crc32cTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0x82f63b78 ^ (value >>> 1) : value >>> 1;
  }
  crc32cTable[index] = value >>> 0;
}

async function checksum(path) {
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(path)) {
    for (const byte of chunk) {
      crc = crc32cTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return output.toString("base64");
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function isValid(path, file) {
  try {
    const metadata = await stat(path);
    return metadata.size === file.size && (await checksum(path)) === file.crc32c;
  } catch {
    return false;
  }
}

async function isValidSha256(path, file) {
  try {
    const metadata = await stat(path);
    return metadata.size === file.size && (await sha256(path)) === file.sha256;
  } catch {
    return false;
  }
}

async function download(file) {
  const target = join(targetDirectory, file.name);
  if (await isValid(target, file)) {
    console.log(`[Moonshine] ${file.name} already verified`);
    return;
  }

  const temporary = `${target}.part`;
  await rm(temporary, { force: true });
  const response = await fetch(`${MODEL_BASE_URL}/${file.name}`);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download ${file.name}: ${response.status} ${response.statusText}`,
    );
  }

  const output = createWriteStream(temporary);
  try {
    for await (const chunk of response.body) {
      if (!output.write(chunk)) {
        await new Promise((resolve) => output.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.once("error", reject);
    });

    if (!(await isValid(temporary, file))) {
      throw new Error(`Size or CRC32C mismatch for ${file.name}`);
    }
    await rename(temporary, target);
    console.log(`[Moonshine] downloaded and verified ${file.name}`);
  } catch (error) {
    output.destroy();
    await rm(temporary, { force: true });
    throw error;
  }
}

async function downloadVerifiedAsset(file, directory, label) {
  const target = join(directory, file.name);
  if (await isValidSha256(target, file)) {
    console.log(`[${label}] ${file.name} already verified`);
    return;
  }

  const temporary = `${target}.part`;
  await rm(temporary, { force: true });
  const response = await fetch(file.url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download ${file.name}: ${response.status} ${response.statusText}`,
    );
  }

  const output = createWriteStream(temporary);
  try {
    for await (const chunk of response.body) {
      if (!output.write(chunk)) {
        await new Promise((resolve) => output.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.once("error", reject);
    });

    if (file.patches) {
      if (!(await isValidSha256(temporary, {
        ...file,
        size: file.sourceSize,
        sha256: file.sourceSha256,
      }))) {
        throw new Error(`Source size or SHA256 mismatch for ${file.name}`);
      }
      await applyTextPatches(temporary, file.patches);
    }

    if (!(await isValidSha256(temporary, file))) {
      throw new Error(`Size or SHA256 mismatch for ${file.name}`);
    }
    await rename(temporary, target);
    console.log(`[${label}] downloaded and verified ${file.name}`);
  } catch (error) {
    output.destroy();
    await rm(temporary, { force: true });
    throw error;
  }
}

async function applyTextPatches(path, patches) {
  let text = await import("node:fs/promises").then((fs) =>
    fs.readFile(path, "utf8"),
  );
  for (const patch of patches) {
    if (text.includes(patch.to)) continue;
    if (!text.includes(patch.from)) {
      throw new Error(`Patch target not found in ${path}`);
    }
    text = text.replace(patch.from, patch.to);
  }
  await import("node:fs/promises").then((fs) => fs.writeFile(path, text));
}

await mkdir(targetDirectory, { recursive: true });
for (const file of modelFiles) {
  await download(file);
}

console.log("[Moonshine] Tiny Streaming model assets are ready");

await mkdir(whisperTargetDirectory, { recursive: true });
for (const file of whisperFiles) {
  await downloadVerifiedAsset(file, whisperTargetDirectory, "Whisper");
}

console.log("[Whisper] tiny.en Q5_1 model and runtime assets are ready");
