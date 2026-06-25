import { config } from "../config.mjs";
import { extensionFromMime, findFirstMatchingValue } from "../utils.mjs";

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
}

function buildAuthHeaders() {
  const headers = {};

  if (config.openAiCompatApiKey) {
    headers.Authorization = `Bearer ${config.openAiCompatApiKey}`;
  }

  return headers;
}

function buildResizePrompt({
  prompt,
  targetWidth,
  targetHeight,
  mode,
  targetLanguage,
  originalWidth,
  originalHeight,
  fileName
}) {
  const prefix = config.openAiCompatPromptPrefix?.trim();
  const userPrompt = prompt?.trim();
  const hasLanguageRewrite = targetLanguage && targetLanguage !== "source";
  const languageNameMap = {
    "zh-CN": "Simplified Chinese",
    en: "English",
    de: "German",
    fr: "French",
    ru: "Russian"
  };
  const targetLanguageName = languageNameMap[targetLanguage] || targetLanguage;

  const parts = [
    prefix,
    "You are editing an existing image to fit a specific target size.",
    `Target size: ${targetWidth}x${targetHeight}.`,
    `Original size: ${originalWidth || "unknown"}x${originalHeight || "unknown"}.`,
    `Source file name: ${fileName}.`,
    "Keep the main subject natural and coherent.",
    "Do not distort faces, bodies, products, logos, or text.",
    "Recompose or extend the scene when needed so the final image feels intentionally designed for the target aspect ratio.",
    "Preserve visual quality and important subject details.",
    "Return one final edited image."
  ];

  if (mode === "center-crop") {
    parts.push("Use a center-crop composition approach and prefer trimming edge areas instead of inventing large new surroundings.");
  }

  if (mode === "passthrough") {
    parts.push("Minimize creative changes and keep the original composition and styling as close as possible.");
  }

  if (mode === "smart-expand" || !mode) {
    parts.push("When the aspect ratio changes significantly, intelligently expand or recompose the scene instead of stretching the image.");
  }

  if (hasLanguageRewrite) {
    parts.push(`Detect any visible text in the image and rewrite it in ${targetLanguageName}.`);
    parts.push("Translate the text naturally instead of copying the source language.");
    parts.push("Preserve the layout intent, hierarchy, readability, and approximate placement of the original text.");
    parts.push("If there is no visible text, keep the image content natural and do not invent unnecessary typography.");
  }

  if (userPrompt) {
    parts.push(`Additional instruction: ${userPrompt}`);
  }

  return parts.filter(Boolean).join("\n");
}

async function loadBinaryFromUrl(url) {
  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        signal
      }),
    config.apiTimeoutMs
  );

  if (!response.ok) {
    throw new Error(`下载中转站图片结果失败: ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get("content-type") || "application/octet-stream";

  return {
    outputBuffer: Buffer.from(await response.arrayBuffer()),
    mimeType,
    extension: extensionFromMime(mimeType)
  };
}

async function parseImageResponse(response, input) {
  const responseType = response.headers.get("content-type") || "";

  if (responseType.startsWith("image/")) {
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    return {
      outputBuffer,
      mimeType: responseType,
      extension: extensionFromMime(responseType),
      providerMeta: {
        provider: "openai-compatible",
        apiMode: "binary-image",
        targetLanguage: input.targetLanguage || "source"
      }
    };
  }

  const payload = await response.json();
  const base64Payload = findFirstMatchingValue(payload, [
    "data.0.b64_json",
    "data.0.base64",
    "imageBase64",
    "result.imageBase64",
    "output.0.result"
  ]);
  const urlPayload = findFirstMatchingValue(payload, [
    "data.0.url",
    "imageUrl",
    "result.imageUrl",
    "output.0.url",
    "url"
  ]);

  if (base64Payload) {
    return {
      outputBuffer: Buffer.from(base64Payload, "base64"),
      mimeType: "image/png",
      extension: ".png",
      providerMeta: {
        provider: "openai-compatible",
        apiMode: "json-base64",
        targetLanguage: input.targetLanguage || "source"
      }
    };
  }

  if (urlPayload) {
    const urlResult = await loadBinaryFromUrl(urlPayload);
    return {
      ...urlResult,
      providerMeta: {
        provider: "openai-compatible",
        apiMode: "json-url",
        targetLanguage: input.targetLanguage || "source",
        sourceUrl: urlPayload
      }
    };
  }

  throw new Error("OpenAI-compatible 图片接口调用成功，但没有识别到可用的图片返回内容");
}

async function callImagesEditsApi(input) {
  const endpoint = joinUrl(config.openAiCompatBaseUrl, config.openAiCompatImagesEditPath);
  const form = new FormData();
  const prompt = buildResizePrompt(input);
  const file = new File([input.inputBuffer], input.inputFileName, { type: input.inputMimeType });

  form.set("model", config.openAiCompatModel);
  form.set("image", file);
  form.set("prompt", prompt);
  form.set("size", `${input.targetWidth}x${input.targetHeight}`);
  form.set("quality", config.openAiCompatQuality);
  form.set("background", config.openAiCompatBackground);
  form.set("output_format", config.openAiCompatOutputFormat);

  const response = await withTimeout(
    (signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: form,
        signal
      }),
    config.apiTimeoutMs
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI-compatible images/edits 调用失败: ${response.status} ${response.statusText} ${errorText}`.trim());
  }

  return parseImageResponse(response, input);
}

async function uploadFileToGateway(input) {
  const endpoint = joinUrl(config.openAiCompatBaseUrl, config.openAiCompatFilesPath);
  const form = new FormData();
  const file = new File([input.inputBuffer], input.inputFileName, { type: input.inputMimeType });

  form.set("purpose", "vision");
  form.set("file", file);

  const response = await withTimeout(
    (signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: form,
        signal
      }),
    config.apiTimeoutMs
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI-compatible files 上传失败: ${response.status} ${response.statusText} ${errorText}`.trim());
  }

  const payload = await response.json();

  if (!payload?.id) {
    throw new Error("OpenAI-compatible files 上传成功，但返回中没有 file id");
  }

  return payload.id;
}

function extractResponseImageBase64(payload) {
  const directBase64 = findFirstMatchingValue(payload, [
    "output.0.result",
    "output.1.result",
    "output.2.result",
    "data.0.b64_json"
  ]);

  if (directBase64) {
    return directBase64;
  }

  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (item?.type === "image_generation_call" && item?.result) {
        return item.result;
      }
    }
  }

  return undefined;
}

async function callResponsesApi(input) {
  const fileId = await uploadFileToGateway(input);
  const endpoint = joinUrl(config.openAiCompatBaseUrl, config.openAiCompatResponsesPath);
  const prompt = buildResizePrompt(input);

  const body = {
    model: config.openAiCompatModel,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          {
            type: "input_image",
            file_id: fileId
          }
        ]
      }
    ],
    tools: [
      {
        type: "image_generation",
        size: `${input.targetWidth}x${input.targetHeight}`,
        quality: config.openAiCompatQuality,
        output_format: config.openAiCompatOutputFormat,
        background: config.openAiCompatBackground
      }
    ]
  };

  const response = await withTimeout(
    (signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders()
        },
        body: JSON.stringify(body),
        signal
      }),
    config.apiTimeoutMs
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI-compatible responses 调用失败: ${response.status} ${response.statusText} ${errorText}`.trim());
  }

  const payload = await response.json();
  const base64Payload = extractResponseImageBase64(payload);

  if (!base64Payload) {
    throw new Error("OpenAI-compatible responses 调用成功，但没有识别到生成图片结果");
  }

  return {
    outputBuffer: Buffer.from(base64Payload, "base64"),
    mimeType: "image/png",
    extension: ".png",
      providerMeta: {
        provider: "openai-compatible",
        apiMode: "responses",
        model: config.openAiCompatModel,
        targetLanguage: input.targetLanguage || "source"
      }
    };
  }

export async function transformWithOpenAiCompatibleProvider(input) {
  if (!config.openAiCompatBaseUrl) {
    throw new Error("AI_PROVIDER=openai-compatible 时必须配置 OPENAI_COMPAT_BASE_URL");
  }

  if (!config.openAiCompatModel) {
    throw new Error("AI_PROVIDER=openai-compatible 时必须配置 OPENAI_COMPAT_MODEL");
  }

  if (config.openAiCompatMode === "responses") {
    return callResponsesApi(input);
  }

  return callImagesEditsApi(input);
}
