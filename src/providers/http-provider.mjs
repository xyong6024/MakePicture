import { config } from "../config.mjs";
import { extensionFromMime, findFirstMatchingValue } from "../utils.mjs";

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    wrapped: promise(controller.signal).finally(() => clearTimeout(timer))
  };
}

async function loadBinaryFromUrl(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`下载 AI 结果失败: ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const outputBuffer = Buffer.from(await response.arrayBuffer());

  return {
    outputBuffer,
    mimeType,
    extension: extensionFromMime(mimeType)
  };
}

function buildHeaders() {
  const headers = { ...config.apiHeaders };

  if (config.apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

export async function transformWithHttpProvider({
  inputBuffer,
  inputMimeType,
  inputFileName,
  targetWidth,
  targetHeight,
  mode,
  targetLanguage,
  prompt,
  originalWidth,
  originalHeight
}) {
  if (!config.apiUrl) {
    throw new Error("AI_PROVIDER=http 时必须配置 AI_API_URL");
  }

  const form = new FormData();
  const file = new File([inputBuffer], inputFileName, { type: inputMimeType });

  form.set(config.apiImageField, file);
  form.set("targetWidth", String(targetWidth));
  form.set("targetHeight", String(targetHeight));
  form.set("originalWidth", String(originalWidth));
  form.set("originalHeight", String(originalHeight));
  form.set("mode", mode || "smart-expand");
  form.set("targetLanguage", targetLanguage || "source");
  form.set("prompt", prompt || "");

  for (const [key, value] of Object.entries(config.apiExtraFields)) {
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  const { signal, wrapped } = withTimeout(
    (abortSignal) =>
      fetch(config.apiUrl, {
        method: "POST",
        headers: buildHeaders(),
        body: form,
        signal: abortSignal
      }),
    config.apiTimeoutMs
  );

  const response = await wrapped;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI 接口调用失败: ${response.status} ${response.statusText} ${errorText}`.trim());
  }

  const responseType = response.headers.get("content-type") || "";

  if (responseType.startsWith("image/")) {
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    return {
      outputBuffer,
      mimeType: responseType,
      extension: extensionFromMime(responseType),
      providerMeta: {
        provider: "http",
        responseType: "binary-image"
      }
    };
  }

  const payload = await response.json();

  const explicitBase64 = findFirstMatchingValue(payload, [config.responseBase64Path].filter(Boolean));
  const explicitUrl = findFirstMatchingValue(payload, [config.responseUrlPath].filter(Boolean));
  const base64Payload =
    explicitBase64 ||
    findFirstMatchingValue(payload, [
      "imageBase64",
      "result.imageBase64",
      "data.0.b64_json",
      "data.0.base64",
      "output.b64_json"
    ]);

  if (base64Payload) {
    const outputBuffer = Buffer.from(base64Payload, "base64");
    return {
      outputBuffer,
      mimeType: "image/png",
      extension: ".png",
      providerMeta: {
        provider: "http",
        responseType: "json-base64"
      }
    };
  }

  const urlPayload =
    explicitUrl ||
    findFirstMatchingValue(payload, [
      "imageUrl",
      "result.imageUrl",
      "data.0.url",
      "output.url",
      "url"
    ]);

  if (urlPayload) {
    const result = await loadBinaryFromUrl(urlPayload);
    return {
      ...result,
      providerMeta: {
        provider: "http",
        responseType: "json-url",
        sourceUrl: urlPayload
      }
    };
  }

  throw new Error("AI 接口返回成功，但未识别到图片内容，请检查返回结构配置");
}
