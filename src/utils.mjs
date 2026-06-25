import fs from "node:fs/promises";
import path from "node:path";

const mimeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg"
};

export function sanitizeBaseName(name) {
  const parsed = path.parse(name || "image");
  const safe = parsed.name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "image";
}

export function extensionFromMime(mimeType, fallback = ".bin") {
  return mimeExtensions[mimeType] || fallback;
}

export function mimeFromExtension(extension) {
  const normalized = extension.toLowerCase();
  const entry = Object.entries(mimeExtensions).find(([, ext]) => ext === normalized);
  return entry?.[0] || "application/octet-stream";
}

export function dataUrlToBuffer(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/u.exec(dataUrl || "");

  if (!match) {
    throw new Error("无效的 data URL");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

export function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function ensureDir(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
}

export async function writeBuffer(filePath, buffer) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, buffer);
}

export function getNestedValue(object, pathExpression) {
  if (!pathExpression) {
    return undefined;
  }

  return pathExpression
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => {
      if (current === undefined || current === null) {
        return undefined;
      }

      if (/^\d+$/u.test(key)) {
        return current[Number(key)];
      }

      return current[key];
    }, object);
}

export function findFirstMatchingValue(payload, candidates) {
  for (const pathExpression of candidates) {
    const value = getNestedValue(payload, pathExpression);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}
