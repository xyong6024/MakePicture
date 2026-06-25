import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { transformWithOpenAiCompatibleProvider } from "./providers/openai-compatible-provider.mjs";
import { transformWithMockProvider } from "./providers/mock-provider.mjs";
import { transformWithHttpProvider } from "./providers/http-provider.mjs";
import {
  dataUrlToBuffer,
  ensureDir,
  extensionFromMime,
  mimeFromExtension,
  sanitizeBaseName,
  writeBuffer
} from "./utils.mjs";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const uploadsDir = path.join(rootDir, "work", "uploads");
const generatedDir = path.join(rootDir, "outputs", "generated");

const staticMimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function sendJson(response, statusCode, payload) {
  const json = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json)
  });
  response.end(json);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 40 * 1024 * 1024) {
      throw new Error("请求体过大，请减少单张图片大小");
    }

    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveFile(response, absoluteFilePath) {
  const extension = path.extname(absoluteFilePath).toLowerCase();
  const contentType = staticMimeTypes[extension] || mimeFromExtension(extension);
  const fileBuffer = await fsp.readFile(absoluteFilePath);

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileBuffer.length
  });
  response.end(fileBuffer);
}

async function serveStaticFrom(baseDir, requestPath, response) {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath.replace(/^\/+/, "");
  const absoluteFilePath = path.normalize(path.join(baseDir, relativePath));

  if (!absoluteFilePath.startsWith(baseDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const fileStats = await fsp.stat(absoluteFilePath).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    sendText(response, 404, "Not Found");
    return;
  }

  await serveFile(response, absoluteFilePath);
}

async function selectProvider() {
  if (config.provider === "openai-compatible") {
    return transformWithOpenAiCompatibleProvider;
  }

  if (config.provider === "http") {
    return transformWithHttpProvider;
  }

  return transformWithMockProvider;
}

async function handleTransform(response, payload) {
  const {
    fileName,
    dataUrl,
    targetWidth,
    targetHeight,
    mode,
    targetLanguage,
    prompt,
    originalWidth,
    originalHeight
  } = payload;

  if (!fileName || !dataUrl || !targetWidth || !targetHeight) {
    sendJson(response, 400, {
      error: "缺少必要字段: fileName, dataUrl, targetWidth, targetHeight"
    });
    return;
  }

  const width = Number(targetWidth);
  const height = Number(targetHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    sendJson(response, 400, { error: "目标尺寸无效" });
    return;
  }

  const { buffer: inputBuffer, mimeType: inputMimeType } = dataUrlToBuffer(dataUrl);
  const safeBaseName = sanitizeBaseName(fileName);
  const uploadExtension = extensionFromMime(inputMimeType, path.extname(fileName) || ".bin");
  const jobId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${safeBaseName}-${jobId}${uploadExtension}`);

  await writeBuffer(uploadPath, inputBuffer);

  const provider = await selectProvider();
  const result = await provider({
    inputBuffer,
    inputMimeType,
    inputFileName: path.basename(uploadPath),
    targetWidth: width,
    targetHeight: height,
    mode,
    targetLanguage,
    prompt,
    originalWidth: Number(originalWidth) || 0,
    originalHeight: Number(originalHeight) || 0,
    fileName
  });

  const outputPath = path.join(generatedDir, `${safeBaseName}-${jobId}${result.extension}`);
  await writeBuffer(outputPath, result.outputBuffer);

  sendJson(response, 200, {
    id: jobId,
    fileName,
    outputFileName: path.basename(outputPath),
    outputUrl: `/outputs/generated/${path.basename(outputPath)}`,
    mimeType: result.mimeType,
    width,
    height,
    targetLanguage: targetLanguage || "source",
    provider: config.provider,
    providerMeta: result.providerMeta || {}
  });
}

async function bootstrap() {
  await ensureDir(publicDir);
  await ensureDir(uploadsDir);
  await ensureDir(generatedDir);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          provider: config.provider,
          now: new Date().toISOString()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, {
          provider: config.provider,
          supportsLiveApi: config.provider === "http" || config.provider === "openai-compatible",
          apiConfigured:
            config.provider === "openai-compatible"
              ? Boolean(config.openAiCompatBaseUrl && config.openAiCompatModel)
              : Boolean(config.apiUrl),
          model: config.provider === "openai-compatible" ? config.openAiCompatModel : null
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/transform") {
        const payload = await readJsonBody(request);
        await handleTransform(response, payload);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/outputs/")) {
        await serveStaticFrom(rootDir, url.pathname, response);
        return;
      }

      if (request.method === "GET") {
        const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
        await serveStaticFrom(publicDir, requestPath, response);
        return;
      }

      sendText(response, 404, "Not Found");
    } catch (error) {
      sendJson(response, 500, {
        error: error.message || "服务器内部错误"
      });
    }
  });

  server.listen(config.port, () => {
    console.log(`AI smart resizer running at http://localhost:${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
