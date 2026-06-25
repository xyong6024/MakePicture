const presets = [
  { label: "电商竖版", width: 900, height: 1600 },
  { label: "小红书竖图", width: 1080, height: 1350 },
  { label: "方图商品卡", width: 1080, height: 1080 },
  { label: "公众号横幅", width: 1200, height: 628 },
  { label: "视频封面", width: 1920, height: 1080 }
];

const state = {
  items: [],
  processing: false,
  downloading: false,
  selectedPreset: `${presets[0].width}x${presets[0].height}`,
  provider: "loading..."
};

const presetGrid = document.getElementById("presetGrid");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const modeSelect = document.getElementById("modeSelect");
const modeHelp = document.getElementById("modeHelp");
const languageSelect = document.getElementById("languageSelect");
const promptInput = document.getElementById("promptInput");
const fileInput = document.getElementById("fileInput");
const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const startButton = document.getElementById("startButton");
const downloadAllButton = document.getElementById("downloadAllButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("statusText");
const providerBadge = document.getElementById("providerBadge");
const queueItemTemplate = document.getElementById("queueItemTemplate");

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function createItemId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function formatStatus(status) {
  const map = {
    pending: "待处理",
    processing: "处理中",
    done: "已完成",
    error: "失败"
  };

  return map[status] || status;
}

function presetKey(width, height) {
  return `${width}x${height}`;
}

function getModeDescription(mode) {
  const map = {
    "smart-expand": "智能扩展：优先保留主体完整，必要时让 AI 自动补背景、补构图，适合大多数改尺寸场景。",
    "center-crop": "中心裁切：优先按目标比例裁掉边缘区域，适合主体本来就在中间的图片。",
    passthrough: "尽量保留原图：少改动原始画面，适合只想轻微调整、不希望 AI 发挥太多的场景。"
  };

  return map[mode] || "";
}

function updateModeHelp() {
  modeHelp.textContent = getModeDescription(modeSelect.value);
}

function formatLanguage(language) {
  const map = {
    source: "保持原语言",
    "zh-CN": "中文",
    en: "English",
    de: "Deutsch",
    fr: "Francais",
    ru: "Russkiy"
  };

  return map[language] || language;
}

function renderPresets() {
  presetGrid.innerHTML = "";

  for (const preset of presets) {
    const button = document.createElement("button");
    const key = presetKey(preset.width, preset.height);
    button.type = "button";
    button.className = `preset-card${state.selectedPreset === key ? " active" : ""}`;
    button.innerHTML = `<strong>${preset.width} × ${preset.height}</strong><span>${preset.label}</span>`;
    button.addEventListener("click", () => {
      state.selectedPreset = key;
      widthInput.value = preset.width;
      heightInput.value = preset.height;
      renderPresets();
    });
    presetGrid.appendChild(button);
  }
}

function updateSummary() {
  queueCount.textContent = `${state.items.length} 张`;
  const completedItems = state.items.filter((item) => item.status === "done" && item.result);
  downloadAllButton.disabled = state.downloading || completedItems.length === 0;

  if (!state.items.length) {
    statusText.textContent = "还没有加入图片。";
    return;
  }

  const doneCount = state.items.filter((item) => item.status === "done").length;
  const errorCount = state.items.filter((item) => item.status === "error").length;
  const processingCount = state.items.filter((item) => item.status === "processing").length;

  statusText.textContent = `共 ${state.items.length} 张，已完成 ${doneCount} 张，处理中 ${processingCount} 张，失败 ${errorCount} 张。`;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);

  return { dosTime, dosDate };
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = new Uint8Array(file.bytes);
    const crc32 = computeCrc32(dataBytes);
    const { dosTime, dosDate } = toDosDateTime(new Date());

    const localHeader = new ArrayBuffer(30);
    const localView = new DataView(localHeader);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new ArrayBuffer(46);
    const centralView = new DataView(centralHeader);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);

    centralParts.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const endRecord = new ArrayBuffer(22);
  const endView = new DataView(endRecord);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

function createZipFileName() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ];

  return `ai-smart-resize-results-${parts.join("")}.zip`;
}

async function downloadAllResults() {
  const completedItems = state.items.filter((item) => item.status === "done" && item.result?.outputUrl);

  if (!completedItems.length || state.downloading) {
    return;
  }

  state.downloading = true;
  updateSummary();
  statusText.textContent = `正在打包 ${completedItems.length} 张结果图...`;

  try {
    const files = [];

    for (const item of completedItems) {
      const response = await fetch(item.result.outputUrl);

      if (!response.ok) {
        throw new Error(`下载结果失败: ${item.result.outputFileName}`);
      }

      files.push({
        name: item.result.outputFileName,
        bytes: await response.arrayBuffer()
      });
    }

    const zipBlob = createZipBlob(files);
    const downloadUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = createZipFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    statusText.textContent = `已打包 ${completedItems.length} 张结果图。`;
  } catch (error) {
    statusText.textContent = error.message || "批量下载失败";
  } finally {
    state.downloading = false;
    updateSummary();
  }
}

function renderQueue() {
  queueList.innerHTML = "";

  if (!state.items.length) {
    queueList.innerHTML = `
      <div class="empty-state">
        <h3>把图片拖进来，或者点上面的选择框。</h3>
        <p>每张图都会显示原始尺寸、处理状态和最终结果。</p>
      </div>
    `;
    updateSummary();
    return;
  }

  for (const item of state.items) {
    const fragment = queueItemTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".queue-item");
    const thumb = fragment.querySelector(".thumb");
    const fileName = fragment.querySelector(".file-name");
    const statusChip = fragment.querySelector(".status-chip");
    const meta = fragment.querySelector(".meta");
    const progressFill = fragment.querySelector(".progress-fill");
    const resultBlock = fragment.querySelector(".result-block");

    thumb.src = item.previewUrl;
    thumb.alt = item.file.name;
    fileName.textContent = item.file.name;
    statusChip.textContent = formatStatus(item.status);
    statusChip.classList.add(`status-${item.status}`);

    meta.textContent = `原始尺寸 ${item.originalWidth} × ${item.originalHeight} | 目标尺寸 ${widthInput.value} × ${heightInput.value} | 输出语种 ${formatLanguage(languageSelect.value)}`;
    if (item.targetWidth && item.targetHeight) {
      meta.textContent = `原始尺寸 ${item.originalWidth} × ${item.originalHeight} | 目标尺寸 ${item.targetWidth} × ${item.targetHeight} | 输出语种 ${formatLanguage(item.targetLanguage || languageSelect.value)}`;
    }
    progressFill.style.width =
      item.status === "done" ? "100%" : item.status === "processing" ? "56%" : item.status === "error" ? "100%" : "10%";

    if (item.status === "done" && item.result) {
      const resultCard = document.createElement("div");
      resultCard.className = "result-card";
      resultCard.innerHTML = `
        <img src="${item.result.outputUrl}" alt="${item.file.name} result" />
        <div class="result-meta">
          <span>${item.result.width} × ${item.result.height} · ${item.result.provider}</span>
          <a class="download-link" href="${item.result.outputUrl}" download="${item.result.outputFileName}">下载结果</a>
        </div>
      `;
      resultBlock.appendChild(resultCard);
    }

    if (item.status === "error" && item.error) {
      const errorNode = document.createElement("p");
      errorNode.className = "meta";
      errorNode.textContent = item.error;
      resultBlock.appendChild(errorNode);
    }

    queueList.appendChild(card);
  }

  updateSummary();
}

function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        previewUrl,
        originalWidth: image.naturalWidth,
        originalHeight: image.naturalHeight
      });
    };
    image.onerror = () => reject(new Error(`无法读取图片: ${file.name}`));
    image.src = previewUrl;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  const nextItems = [];
  const errors = [];

  for (const file of files) {
    try {
      const meta = await readImageMeta(file);
      nextItems.push({
        id: createItemId(),
        file,
        previewUrl: meta.previewUrl,
        originalWidth: meta.originalWidth,
        originalHeight: meta.originalHeight,
        status: "pending",
        result: null,
        error: ""
      });
    } catch (error) {
      errors.push(error.message || file.name);
    }
  }

  if (nextItems.length) {
    state.items = [...state.items, ...nextItems];
    renderQueue();
  }

  if (errors.length) {
    statusText.textContent = `Some files could not be loaded: ${errors.join(", ")}`;
  }
}

async function fetchConfig() {
  try {
    const response = await fetch("/api/config");
    const payload = await response.json();
    state.provider = payload.provider;
    providerBadge.textContent = payload.model
      ? `Provider: ${payload.provider} / ${payload.model}`
      : `Provider: ${payload.provider}`;
  } catch (error) {
    providerBadge.textContent = "Provider: unavailable";
  }
}

async function processItem(item) {
  item.status = "processing";
  item.error = "";
  renderQueue();

  const payload = {
    fileName: item.file.name,
    dataUrl: await fileToDataUrl(item.file),
    targetWidth: Number(widthInput.value),
    targetHeight: Number(heightInput.value),
    mode: modeSelect.value,
    targetLanguage: languageSelect.value,
    prompt: promptInput.value.trim(),
    originalWidth: item.originalWidth,
    originalHeight: item.originalHeight
  };

  item.targetWidth = payload.targetWidth;
  item.targetHeight = payload.targetHeight;
  item.targetLanguage = payload.targetLanguage;

  const response = await fetch("/api/transform", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "处理失败");
  }

  item.status = "done";
  item.result = result;
  renderQueue();
}

async function startProcessing() {
  if (state.processing) {
    return;
  }

  if (!state.items.length) {
    statusText.textContent = "请先选择至少一张图片。";
    return;
  }

  state.processing = true;
  startButton.disabled = true;

  try {
    for (const item of state.items) {
      if (item.status === "done") {
        continue;
      }

      try {
        await processItem(item);
      } catch (error) {
        item.status = "error";
        item.error = error.message;
        renderQueue();
      }
    }
  } finally {
    state.processing = false;
    startButton.disabled = false;
    updateSummary();
  }
}

function clearItems() {
  for (const item of state.items) {
    URL.revokeObjectURL(item.previewUrl);
  }

  state.items = [];
  renderQueue();
}

fileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);

  if (!files.length) {
    return;
  }

  try {
    await addFiles(files);
  } catch (error) {
    statusText.textContent = error.message || "Failed to add selected files.";
  } finally {
    fileInput.value = "";
  }
});

clearButton.addEventListener("click", clearItems);
downloadAllButton.addEventListener("click", downloadAllResults);
startButton.addEventListener("click", startProcessing);
modeSelect.addEventListener("change", updateModeHelp);

widthInput.addEventListener("input", () => {
  state.selectedPreset = presetKey(Number(widthInput.value), Number(heightInput.value));
  renderPresets();
  renderQueue();
});

heightInput.addEventListener("input", () => {
  state.selectedPreset = presetKey(Number(widthInput.value), Number(heightInput.value));
  renderPresets();
  renderQueue();
});

renderPresets();
renderQueue();
updateModeHelp();
fetchConfig();
