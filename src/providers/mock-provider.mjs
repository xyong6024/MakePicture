import { bufferToDataUrl } from "../utils.mjs";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function transformWithMockProvider({
  inputBuffer,
  inputMimeType,
  targetWidth,
  targetHeight,
  mode,
  targetLanguage,
  prompt,
  originalWidth,
  originalHeight,
  fileName
}) {
  const href = bufferToDataUrl(inputBuffer, inputMimeType);
  const outputMode = mode || "smart-expand";
  const title = `${fileName} -> ${targetWidth}x${targetHeight}`;
  const description = prompt || "Mock provider output";
  const languageLabel = targetLanguage && targetLanguage !== "source" ? targetLanguage : "original";
  const labelWidth = Math.max(96, Math.min(320, targetWidth - 32));
  const labelY = Math.max(28, targetHeight - 29);
  const labelBoxY = Math.max(8, targetHeight - 52);

  let foregroundPreserveAspectRatio = "xMidYMid meet";
  let foregroundOpacity = 1;
  let overlay = `<rect width="100%" height="100%" fill="#070b16" fill-opacity="0.18" />`;

  if (outputMode === "center-crop") {
    foregroundPreserveAspectRatio = "xMidYMid slice";
    overlay = "";
  }

  if (outputMode === "passthrough") {
    foregroundOpacity = 0.94;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(description)}</desc>
  <defs>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="28" />
    </filter>
    <linearGradient id="shade" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.24" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#0f172a" />
  <image href="${href}" x="0" y="0" width="${targetWidth}" height="${targetHeight}" preserveAspectRatio="xMidYMid slice" filter="url(#blur)" opacity="0.92" />
  <rect width="100%" height="100%" fill="url(#shade)" opacity="0.55" />
  ${overlay}
  <image href="${href}" x="0" y="0" width="${targetWidth}" height="${targetHeight}" preserveAspectRatio="${foregroundPreserveAspectRatio}" opacity="${foregroundOpacity}" />
  <g>
    <rect x="16" y="${labelBoxY}" rx="12" ry="12" width="${labelWidth}" height="36" fill="#0f172a" fill-opacity="0.78" />
    <text x="30" y="${labelY}" fill="#f8fafc" font-size="16" font-family="Segoe UI, Arial, sans-serif">
      ${escapeXml(`${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight} / ${languageLabel}`)}
    </text>
  </g>
</svg>`;

  return {
    outputBuffer: Buffer.from(svg, "utf8"),
    mimeType: "image/svg+xml",
    extension: ".svg",
    providerMeta: {
      provider: "mock",
      strategy: outputMode,
      targetLanguage: targetLanguage || "source",
      note: "This output uses a zero-distortion SVG mock for workflow verification."
    }
  };
}
