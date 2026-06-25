import fs from "node:fs";
import path from "node:path";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} 不是合法 JSON: ${error.message}`);
  }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT || 3000),
  provider: process.env.AI_PROVIDER || "mock",
  apiUrl: process.env.AI_API_URL || "",
  apiKey: process.env.AI_API_KEY || "",
  apiImageField: process.env.AI_API_IMAGE_FIELD || "image",
  apiTimeoutMs: Number(process.env.AI_API_TIMEOUT_MS || 120000),
  apiHeaders: parseJsonEnv("AI_API_HEADERS", {}),
  apiExtraFields: parseJsonEnv("AI_API_EXTRA_FIELDS", {}),
  responseBase64Path: process.env.AI_RESPONSE_BASE64_PATH || "",
  responseUrlPath: process.env.AI_RESPONSE_URL_PATH || "",
  openAiCompatBaseUrl: process.env.OPENAI_COMPAT_BASE_URL || "",
  openAiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY || "",
  openAiCompatModel: process.env.OPENAI_COMPAT_MODEL || "gpt-image-2",
  openAiCompatMode: process.env.OPENAI_COMPAT_MODE || "images-edits",
  openAiCompatImagesEditPath: process.env.OPENAI_COMPAT_IMAGES_EDIT_PATH || "/v1/images/edits",
  openAiCompatResponsesPath: process.env.OPENAI_COMPAT_RESPONSES_PATH || "/v1/responses",
  openAiCompatFilesPath: process.env.OPENAI_COMPAT_FILES_PATH || "/v1/files",
  openAiCompatQuality: process.env.OPENAI_COMPAT_QUALITY || "high",
  openAiCompatOutputFormat: process.env.OPENAI_COMPAT_OUTPUT_FORMAT || "png",
  openAiCompatBackground: process.env.OPENAI_COMPAT_BACKGROUND || "auto",
  openAiCompatPromptPrefix: process.env.OPENAI_COMPAT_PROMPT_PREFIX || ""
};
