// Copics offscreen OCR worker
let workerPromise = null;
let activeLanguage = null;
let requestQueue = Promise.resolve();
const availableLanguageCache = new Map();

const getErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
};

const MIN_REGION_WIDTH = 80;
const MIN_REGION_HEIGHT = 24;
const CODE_CHAR_WHITELIST = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_{}[]()<>.,:;\'"`~!?@#$%^&*-+=/\\\\| ';

const getWorker = async (language) => {
  if (!self.Tesseract || !self.Tesseract.createWorker) {
    throw new Error('Tesseract.js not loaded in offscreen document');
  }

  if (!workerPromise) {
    workerPromise = self.Tesseract.createWorker({
      workerPath: chrome.runtime.getURL('tesseract-worker.min.js'),
      corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
      langPath: chrome.runtime.getURL(''),
      workerBlobURL: false,
      gzip: true
    }).catch((error) => {
      workerPromise = null;
      activeLanguage = null;
      throw error;
    });
  }

  const worker = await workerPromise;
  if (activeLanguage !== language) {
    await worker.loadLanguage(language);
    await worker.initialize(language);
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6',
      user_defined_dpi: '300'
    });
    activeLanguage = language;
  }

  return worker;
};

const isLanguageAvailable = async (language) => {
  if (availableLanguageCache.has(language)) {
    return availableLanguageCache.get(language);
  }

  const available = await fetch(chrome.runtime.getURL(`${language}.traineddata.gz`))
    .then((response) => response.ok)
    .catch(() => false);

  availableLanguageCache.set(language, available);
  return available;
};

const resolveLanguage = async (language) => {
  const requested = String(language || 'eng')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const resolved = [];
  for (const part of requested) {
    if (await isLanguageAvailable(part)) {
      resolved.push(part);
    }
  }

  if (!resolved.length) {
    resolved.push('eng');
  }

  return resolved.join('+');
};

const percentileBounds = (hist, total, lowPct, highPct) => {
  const lowCount = Math.round(total * lowPct);
  const highCount = Math.round(total * highPct);
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= lowCount) {
      low = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 255; i >= 0; i--) {
    cumulative += hist[i];
    if (cumulative >= (total - highCount)) {
      high = i;
      break;
    }
  }

  return { low, high };
};

const otsuThreshold = (hist, total) => {
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * hist[i];
  }

  let sumB = 0;
  let weightBackground = 0;
  let weightForeground = 0;
  let maxVariance = 0;
  let threshold = 127;

  for (let i = 0; i < 256; i++) {
    weightBackground += hist[i];
    if (!weightBackground) continue;

    weightForeground = total - weightBackground;
    if (!weightForeground) break;

    sumB += i * hist[i];
    const meanBackground = sumB / weightBackground;
    const meanForeground = (sum - sumB) / weightForeground;
    const betweenVariance = weightBackground * weightForeground * (meanBackground - meanForeground) * (meanBackground - meanForeground);

    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      threshold = i;
    }
  }

  return threshold;
};

const measureLuminance = (ctx, w, h) => {
  const image = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < image.length; i += 16) {
    sum += image[i];
    samples++;
  }
  return samples ? sum / samples : 255;
};

const cropUniformMargins = (canvas, options = {}) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.getImageData(0, 0, w, h).data;
  const threshold = options.threshold || 14;
  const lightBgCutoff = options.lightBgCutoff || 235;
  const darkBgCutoff = options.darkBgCutoff || 20;
  const sampleStride = Math.max(1, Math.floor(Math.min(w, h) / 250));
  const rowStats = [];
  const colStats = [];

  for (let y = 0; y < h; y++) {
    let min = 255;
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let x = 0; x < w; x += sampleStride) {
      const i = (y * w + x) * 4;
      const v = image[i];
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      count++;
    }
    rowStats.push({ min, max, avg: count ? sum / count : 255 });
  }

  for (let x = 0; x < w; x++) {
    let min = 255;
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let y = 0; y < h; y += sampleStride) {
      const i = (y * w + x) * 4;
      const v = image[i];
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      count++;
    }
    colStats.push({ min, max, avg: count ? sum / count : 255 });
  }

  const isUniform = (stats) => {
    const spread = stats.max - stats.min;
    return spread <= threshold && (stats.avg >= lightBgCutoff || stats.avg <= darkBgCutoff);
  };

  let top = 0;
  while (top < h - 1 && isUniform(rowStats[top])) top++;
  let bottom = h - 1;
  while (bottom > top && isUniform(rowStats[bottom])) bottom--;
  let left = 0;
  while (left < w - 1 && isUniform(colStats[left])) left++;
  let right = w - 1;
  while (right > left && isUniform(colStats[right])) right--;

  const croppedW = Math.max(1, right - left + 1);
  const croppedH = Math.max(1, bottom - top + 1);
  if (croppedW < MIN_REGION_WIDTH || croppedH < MIN_REGION_HEIGHT) {
    return canvas;
  }
  if (croppedW >= w * 0.92 && croppedH >= h * 0.92) {
    return canvas;
  }

  const out = document.createElement('canvas');
  out.width = croppedW;
  out.height = croppedH;
  out.getContext('2d').drawImage(canvas, left, top, croppedW, croppedH, 0, 0, croppedW, croppedH);
  return out;
};

const applySharpen = (ctx, w, h, amount) => {
  const source = ctx.getImageData(0, 0, w, h);
  const data = source.data;
  const output = new Uint8ClampedArray(data);
  const strength = Math.max(0, Math.min(1, typeof amount === 'number' ? amount : 0.75));
  const index = (x, y, channel) => ((y * w + x) * 4 + channel);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let channel = 0; channel < 3; channel++) {
        const center = data[index(x, y, channel)];
        const top = data[index(x, y - 1, channel)];
        const bottom = data[index(x, y + 1, channel)];
        const left = data[index(x - 1, y, channel)];
        const right = data[index(x + 1, y, channel)];
        const value = center * (1 + 4 * strength) - strength * (top + bottom + left + right);
        output[index(x, y, channel)] = Math.max(0, Math.min(255, value));
      }
      output[index(x, y, 3)] = data[index(x, y, 3)];
    }
  }

  source.data.set(output);
  ctx.putImageData(source, 0, 0);
};

const preprocessCanvas = (ctx, w, h, options = {}) => {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const histogram = new Array(256).fill(0);
  const gamma = typeof options.gamma === 'number' ? options.gamma : 1;
  const invert = !!options.invert;

  for (let i = 0; i < data.length; i += 4) {
    let gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    if (gamma !== 1) {
      gray = Math.round(255 * Math.pow(gray / 255, gamma));
    }
    if (invert) {
      gray = 255 - gray;
    }
    data[i] = data[i + 1] = data[i + 2] = gray;
    histogram[gray]++;
  }

  if (options.mode === 'contrast' || options.mode === 'strong-contrast') {
    const lower = options.mode === 'strong-contrast' ? 0.01 : 0.02;
    const upper = options.mode === 'strong-contrast' ? 0.995 : 0.98;
    const bounds = percentileBounds(histogram, w * h, lower, upper);
    const range = Math.max(1, bounds.high - bounds.low);
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.max(0, Math.min(255, Math.round((data[i] - bounds.low) * 255 / range)));
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }

  if (options.mode === 'binary' || options.mode === 'adaptive-binary') {
    const thresholdBase = otsuThreshold(histogram, w * h);
    const threshold = options.mode === 'adaptive-binary'
      ? Math.max(0, Math.min(255, thresholdBase + (typeof options.thresholdOffset === 'number' ? options.thresholdOffset : -12)))
      : thresholdBase;
    let white = 0;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] >= threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = value;
      if (value === 255) {
        white++;
      } else {
        black++;
      }
    }
    if (white < black) {
      for (let i = 0; i < data.length; i += 4) {
        const value = data[i] === 255 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = value;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
};

const renderVariant = (sourceCanvas, options = {}) => {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const cropLeftRatio = Math.max(0, Math.min(0.4, options.cropLeftRatio || 0));
  const cropTopRatio = Math.max(0, Math.min(0.25, options.cropTopRatio || 0));
  const cropRightRatio = Math.max(0, Math.min(0.25, options.cropRightRatio || 0));
  const cropBottomRatio = Math.max(0, Math.min(0.25, options.cropBottomRatio || 0));
  const sx = Math.min(srcW - 1, Math.round(srcW * cropLeftRatio));
  const sy = Math.min(srcH - 1, Math.round(srcH * cropTopRatio));
  const sw = Math.max(1, srcW - sx - Math.round(srcW * cropRightRatio));
  const sh = Math.max(1, srcH - sy - Math.round(srcH * cropBottomRatio));
  if (sw < MIN_REGION_WIDTH || sh < MIN_REGION_HEIGHT) {
    return sourceCanvas;
  }
  const desiredMinWidth = options.minWidth || 1800;
  const desiredMinHeight = options.minHeight || 700;
  const scaleX = desiredMinWidth / sw;
  const scaleY = desiredMinHeight / sh;
  const requestedScale = typeof options.scale === 'number' ? options.scale : 1;
  const scale = Math.max(1, Math.min(options.maxScale || 3.2, requestedScale, scaleX, scaleY, Math.max(scaleX, scaleY)));
  const dstW = Math.max(1, Math.round(sw * scale));
  const dstH = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, dstW, dstH);
  preprocessCanvas(ctx, dstW, dstH, options);
  applySharpen(ctx, dstW, dstH, typeof options.sharpen === 'number' ? options.sharpen : 0.7);
  return canvas;
};

const cropByRatios = (sourceCanvas, ratios = {}) => {
  const left = Math.max(0, Math.round(sourceCanvas.width * (ratios.left || 0)));
  const top = Math.max(0, Math.round(sourceCanvas.height * (ratios.top || 0)));
  const right = Math.max(left + MIN_REGION_WIDTH, Math.round(sourceCanvas.width * (1 - (ratios.right || 0))));
  const bottom = Math.max(top + MIN_REGION_HEIGHT, Math.round(sourceCanvas.height * (1 - (ratios.bottom || 0))));
  return extractCanvasRegion(sourceCanvas, {
    left,
    top,
    width: right - left,
    height: bottom - top
  }) || sourceCanvas;
};

const detectLineBands = (sourceCanvas, isDarkTheme) => {
  const detection = renderVariant(sourceCanvas, {
    scale: 1.8,
    minWidth: 1700,
    minHeight: 700,
    maxScale: 2,
    invert: isDarkTheme,
    mode: 'adaptive-binary',
    thresholdOffset: isDarkTheme ? -18 : -10,
    sharpen: 0.84
  });
  const ctx = detection.getContext('2d', { willReadFrequently: true });
  const w = detection.width;
  const h = detection.height;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const rowInk = new Array(h).fill(0);

  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (pixels[i] < 110) {
        ink++;
      }
    }
    rowInk[y] = ink;
  }

  const threshold = Math.max(10, w * 0.02);
  const minGap = Math.max(2, Math.round(h / 120));
  const bands = [];
  let start = -1;
  let gap = 0;

  for (let y = 0; y < h; y++) {
    if (rowInk[y] >= threshold) {
      if (start === -1) start = y;
      gap = 0;
    } else if (start !== -1) {
      gap++;
      if (gap > minGap) {
        const end = y - gap;
        if (end - start >= 6) {
          bands.push({ top: start, bottom: end });
        }
        start = -1;
        gap = 0;
      }
    }
  }
  if (start !== -1) {
    const end = h - 1;
    if (end - start >= 6) {
      bands.push({ top: start, bottom: end });
    }
  }

  return bands
    .slice(0, 40)
    .map((band) => ({
      top: Math.max(0, Math.round(band.top / h * sourceCanvas.height) - 4),
      bottom: Math.min(sourceCanvas.height - 1, Math.round(band.bottom / h * sourceCanvas.height) + 4)
    }))
    .filter((band) => band.bottom - band.top + 1 >= MIN_REGION_HEIGHT);
};

const detectGutterSplit = (sourceCanvas, isDarkTheme) => {
  const detection = renderVariant(sourceCanvas, {
    scale: 1.6,
    minWidth: 1500,
    minHeight: 520,
    maxScale: 1.8,
    invert: isDarkTheme,
    mode: 'adaptive-binary',
    thresholdOffset: isDarkTheme ? -18 : -10,
    sharpen: 0.85
  });
  const ctx = detection.getContext('2d', { willReadFrequently: true });
  const w = detection.width;
  const h = detection.height;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const colInk = new Array(w).fill(0);

  for (let x = 0; x < w; x++) {
    let ink = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (pixels[i] < 110) {
        ink++;
      }
    }
    colInk[x] = ink;
  }

  const smooth = colInk.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - 3); i <= Math.min(w - 1, index + 3); i++) {
      sum += colInk[i];
      count++;
    }
    return count ? sum / count : 0;
  });

  const start = Math.round(w * 0.06);
  const end = Math.round(w * 0.24);
  let bestIndex = Math.round(w * 0.12);
  let bestValue = Infinity;
  for (let x = start; x <= end; x++) {
    const value = smooth[x];
    if (value < bestValue) {
      bestValue = value;
      bestIndex = x;
    }
  }

  const split = Math.round(bestIndex / w * sourceCanvas.width);
  return Math.max(36, Math.min(Math.round(sourceCanvas.width * 0.22), split));
};

const extractCanvasRegion = (sourceCanvas, region) => {
  const left = Math.max(0, Math.round(region.left || 0));
  const top = Math.max(0, Math.round(region.top || 0));
  const width = Math.max(1, Math.round(region.width || sourceCanvas.width));
  const height = Math.max(1, Math.round(region.height || sourceCanvas.height));
  const safeWidth = Math.min(width, sourceCanvas.width - left);
  const safeHeight = Math.min(height, sourceCanvas.height - top);
  if (safeWidth < MIN_REGION_WIDTH || safeHeight < MIN_REGION_HEIGHT) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  canvas.getContext('2d').drawImage(sourceCanvas, left, top, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
  return canvas;
};

const dataUrlToCanvas = (dataUrl) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
    resolve(cropUniformMargins(canvas));
  };
  img.onerror = () => reject(new Error('Failed to decode OCR image'));
  img.src = dataUrl;
});

const detectTextRegion = (sourceCanvas, isDarkTheme) => {
  const detection = renderVariant(sourceCanvas, {
    scale: 1.4,
    minWidth: 1400,
    minHeight: 520,
    maxScale: 1.6,
    invert: isDarkTheme,
    mode: 'adaptive-binary',
    thresholdOffset: isDarkTheme ? -18 : -10,
    sharpen: 0.8
  });
  const ctx = detection.getContext('2d', { willReadFrequently: true });
  const w = detection.width;
  const h = detection.height;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const rowInk = new Array(h).fill(0);
  const colInk = new Array(w).fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (pixels[i] < 90) {
        rowInk[y]++;
        colInk[x]++;
      }
    }
  }

  const smooth = (values, radius) => values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(values.length - 1, index + radius); i++) {
      sum += values[i];
      count++;
    }
    return count ? sum / count : 0;
  });

  const rows = smooth(rowInk, Math.max(2, Math.round(h / 120)));
  const cols = smooth(colInk, Math.max(2, Math.round(w / 160)));
  const rowMax = Math.max(...rows, 0);
  const colMax = Math.max(...cols, 0);
  const rowThreshold = Math.max(8, rowMax * 0.16);
  const colThreshold = Math.max(6, colMax * 0.12);

  let top = rows.findIndex((value) => value >= rowThreshold);
  let bottom = rows.length - 1 - [...rows].reverse().findIndex((value) => value >= rowThreshold);
  let left = cols.findIndex((value) => value >= colThreshold);
  let right = cols.length - 1 - [...cols].reverse().findIndex((value) => value >= colThreshold);

  if (top < 0 || left < 0 || bottom <= top || right <= left) {
    return sourceCanvas;
  }

  const marginX = Math.round(w * 0.03);
  const marginY = Math.round(h * 0.05);
  left = Math.max(0, left - marginX);
  right = Math.min(w - 1, right + marginX);
  top = Math.max(0, top - marginY);
  bottom = Math.min(h - 1, bottom + marginY);

  const sx = Math.round(left / w * sourceCanvas.width);
  const sy = Math.round(top / h * sourceCanvas.height);
  const sw = Math.max(1, Math.round((right - left + 1) / w * sourceCanvas.width));
  const sh = Math.max(1, Math.round((bottom - top + 1) / h * sourceCanvas.height));

  if (sw < sourceCanvas.width * 0.25 || sh < sourceCanvas.height * 0.12) {
    return sourceCanvas;
  }

  const focused = document.createElement('canvas');
  focused.width = sw;
  focused.height = sh;
  focused.getContext('2d').drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const trimmed = cropUniformMargins(focused);
  if (trimmed.width < MIN_REGION_WIDTH || trimmed.height < MIN_REGION_HEIGHT) {
    return sourceCanvas;
  }
  return trimmed;
};

const buildPreprocessVariants = async (dataUrl, ocrMode = 'screen') => {
  const sourceCanvas = await dataUrlToCanvas(dataUrl);
  const sampleCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const avgLuminance = measureLuminance(sampleCtx, sourceCanvas.width, sourceCanvas.height);
  const isDarkTheme = avgLuminance < 145;
  const isSelectionMode = ocrMode === 'selection';
  const isWideIdeShot = !isSelectionMode && sourceCanvas.width > 1000 && sourceCanvas.width / sourceCanvas.height > 1.45;
  const editorSeedCanvas = isWideIdeShot
    ? cropByRatios(sourceCanvas, { left: 0.14, top: 0.055, right: 0.02, bottom: 0.03 })
    : sourceCanvas;
  const focusedCanvas = isSelectionMode ? cropUniformMargins(editorSeedCanvas) : detectTextRegion(editorSeedCanvas, isDarkTheme);
  const variants = isSelectionMode
    ? [
        { label: 'sel-base', source: focusedCanvas, options: { scale: 3.2, minWidth: 2200, minHeight: 900, sharpen: 0.78 } },
        { label: 'sel-contrast', source: focusedCanvas, options: { scale: 3.5, minWidth: 2400, minHeight: 960, invert: isDarkTheme, mode: 'contrast', gamma: 0.86, sharpen: 0.9 } },
        { label: 'sel-binary', source: focusedCanvas, options: { scale: 3.7, minWidth: 2500, minHeight: 980, invert: isDarkTheme, mode: 'adaptive-binary', thresholdOffset: isDarkTheme ? -20 : -10, sharpen: 0.95 } }
      ]
    : [
        { label: 'base', source: focusedCanvas, options: { scale: 2.2, minWidth: 1900, minHeight: 760, sharpen: 0.65 } },
        { label: 'contrast', source: focusedCanvas, options: { scale: 2.4, minWidth: 2100, minHeight: 820, mode: 'contrast', sharpen: 0.75 } },
        { label: 'strong', source: focusedCanvas, options: { scale: 2.6, minWidth: 2200, minHeight: 860, mode: 'strong-contrast', gamma: 0.92, sharpen: 0.8 } }
      ];

  if (!isSelectionMode && isDarkTheme) {
    variants.push(
      { label: 'invert-contrast', source: focusedCanvas, options: { scale: 2.6, minWidth: 2200, minHeight: 860, invert: true, mode: 'contrast', gamma: 0.9, sharpen: 0.82 } },
      { label: 'invert-binary', source: focusedCanvas, options: { scale: 2.8, minWidth: 2300, minHeight: 900, invert: true, mode: 'adaptive-binary', thresholdOffset: -16, sharpen: 0.88 } },
      { label: 'invert-gutterless', source: focusedCanvas, options: { scale: 2.8, minWidth: 2300, minHeight: 900, invert: true, mode: 'contrast', cropLeftRatio: 0.12, sharpen: 0.84 } }
    );
  } else if (!isSelectionMode) {
    variants.push(
      { label: 'binary', source: focusedCanvas, options: { scale: 2.5, minWidth: 2100, minHeight: 840, mode: 'adaptive-binary', thresholdOffset: -8, sharpen: 0.82 } },
      { label: 'gutterless', source: focusedCanvas, options: { scale: 2.5, minWidth: 2100, minHeight: 840, mode: 'contrast', cropLeftRatio: 0.12, sharpen: 0.8 } }
    );
  }

  return {
    sourceCanvas,
    editorSeedCanvas,
    focusedCanvas,
    isDarkTheme,
    ocrMode,
    variants: variants.map((variant) => ({
    label: variant.label,
    image: renderVariant(variant.source || focusedCanvas, variant.options).toDataURL('image/png')
    }))
  };
};

const normalizeOcrText = (raw) => {
  if (!raw) return '';

  const cleaned = String(raw)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([([{]) +/g, '$1')
    .replace(/ +([)\]}])/g, '$1')
    .replace(/ +([,.;:!?%=:])/g, '$1')
    .replace(/([=:+\-*/<>])(?=\S)/g, '$1 ')
    .replace(/\b([A-Za-z_]\w*)\s+\(/g, '$1(')
    .replace(/\b([A-Za-z_]\w*)\s+\[/g, '$1[')
    .replace(/\b([A-Za-z_]\w*)\s+\{/g, '$1{')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line, index, lines) => !(line.trim() === '' && lines[index - 1] === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (
    /Image too small to scale/i.test(cleaned) ||
    /Line cannot be recognized/i.test(cleaned) ||
    /function\s+[A-Za-z0-9_]+\s*\(/i.test(cleaned) ||
    /var\s+[A-Za-z0-9_]+\s*=/.test(cleaned) ||
    /null!==|readline\(\)|wasm|instantiate|RuntimeError|CompileError/.test(cleaned)
  ) {
    return '';
  }

  return cleaned;
};

const normalizeLineNumber = (raw) => {
  const clean = normalizeOcrText(raw).replace(/\D+/g, '');
  return /^\d{1,4}$/.test(clean) ? clean : '';
};

const normalizeCodeLine = (raw) => {
  const clean = normalizeOcrText(raw);
  if (!clean) return '';
  let text = clean
    .replace(/[|]/g, '')
    .replace(/^[`'‘’",.]+/, '')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/\s*#\s*/g, '# ')
    .replace(/\s{2,}/g, ' ')
    .replace(/f"\s+/g, 'f"')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .trim();

  // Repair common OCR misses around f-strings on dark IDE themes.
  if (/print\s*\(\s*f"/.test(text)) {
    text = text.replace(/\bI([A-Za-z_]\w*)\b/g, '{$1}');
    text = text.replace(/\b([A-Za-z_]\w*)\b(?="\)\s*$)/, '{$1}');
    if (!/\{[^}]+\}/.test(text)) {
      text = text.replace(/(is )([A-Za-z_]\w*)(?="\)\s*$)/, '$1{$2}');
    }
  }

  return text;
};

const countMatches = (text, pattern) => (text.match(pattern) || []).length;

const computeBalanceBonus = (text) => {
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ['\'', '\'']
  ];
  let score = 0;
  for (const [open, close] of pairs) {
    const delta = Math.abs(countMatches(text, new RegExp(`\\${open}`, 'g')) - countMatches(text, new RegExp(`\\${close}`, 'g')));
    score -= delta * 2;
  }
  return score;
};

const scoreOcrCandidate = (text, confidence, label) => {
  const clean = normalizeOcrText(text);
  if (!clean) return -Infinity;

  const lineCount = clean.split('\n').filter(Boolean).length;
  const chars = clean.length;
  const letters = countMatches(clean, /[A-Za-z]/g);
  const digits = countMatches(clean, /\d/g);
  const codePunctuation = countMatches(clean, /[=(){}[\].,:;'"_+\-*/<>#]/g);
  const replacementLike = countMatches(clean, /[�]/g);
  const suspicious = countMatches(clean, /[|]/g);
  const gutterLines = clean.split('\n').filter((line) => /^\d+\s+\S/.test(line)).length;
  const density = chars ? (letters + digits + codePunctuation) / chars : 0;
  const balanceBonus = computeBalanceBonus(clean);
  const labelBonus = label.includes('gutterless') ? 3 : 0;

  return (
    confidence * 1.3 +
    chars * 0.18 +
    Math.min(lineCount, 12) * 2.5 +
    codePunctuation * 0.7 +
    density * 14 +
    balanceBonus +
    labelBonus -
    replacementLike * 14 -
    suspicious * 3 -
    gutterLines * 5
  );
};

const scoreLineText = (text, confidence) => {
  const clean = normalizeOcrText(text);
  if (!clean) return -Infinity;
  const hasLineNumber = /^\d+\s+\S/.test(clean);
  const braces = countMatches(clean, /[{}[\]()]/g);
  const codePunctuation = countMatches(clean, /[=(){}[\].,:;'"_+\-*/<>#]/g);
  const letters = countMatches(clean, /[A-Za-z]/g);
  const digits = countMatches(clean, /\d/g);
  const suspicious = countMatches(clean, /[|]/g);
  const codeKeywords = countMatches(clean, /\b(print|float|price|students|quantity|num|if|for|while|def|class|return)\b/gi);
  return confidence * 1.6 + clean.length * 0.2 + braces * 4 + codePunctuation * 1.2 + (letters + digits) * 0.08 + codeKeywords * 3 + (hasLineNumber ? 6 : 0) - suspicious * 4;
};

const isLikelyUiText = (text) => {
  return /\b(version control|project|external libraries|scratches|consoles|pythonproject|current file|terminal|services|problems|notification|library root|crlf|utf-8|4 spaces)\b/i.test(text);
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const restoreSelectionLineNumbers = (entries) => {
  if (!entries.length) return [];

  const centers = entries.map((entry) => (entry.top + entry.bottom) / 2);
  const diffs = [];
  for (let i = 1; i < centers.length; i++) {
    const diff = centers[i] - centers[i - 1];
    if (diff > 2) diffs.push(diff);
  }
  const pitch = Math.max(1, median(diffs) || 1);

  let offset = 0;
  const offsets = [0];
  for (let i = 1; i < centers.length; i++) {
    const step = Math.max(1, Math.round((centers[i] - centers[i - 1]) / pitch));
    offset += step;
    offsets.push(offset);
  }

  const anchors = entries
    .map((entry, index) => ({
      index,
      offset: offsets[index],
      raw: entry.lineNumber ? parseInt(entry.lineNumber, 10) : null
    }))
    .filter((entry) => Number.isFinite(entry.raw));

  if (!anchors.length) {
    return entries.map((entry) => entry.codeText);
  }

  const baseCandidates = [];
  for (const anchor of anchors) {
    const variants = anchor.raw < 10 ? [anchor.raw, anchor.raw + 10, anchor.raw + 20] : [anchor.raw];
    for (const variant of variants) {
      baseCandidates.push(variant - anchor.offset);
    }
  }

  let bestBase = baseCandidates[0];
  let bestScore = -Infinity;
  for (const base of baseCandidates) {
    if (base < 1) continue;
    let score = 0;
    for (const anchor of anchors) {
      const predicted = base + anchor.offset;
      const variants = anchor.raw < 10 ? [anchor.raw, anchor.raw + 10, anchor.raw + 20] : [anchor.raw];
      const error = Math.min(...variants.map((variant) => Math.abs(variant - predicted)));
      score -= error * 4;
      if (predicted >= 10) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  return entries.map((entry, index) => {
    const lineNumber = String(bestBase + offsets[index]);
    return `${lineNumber} ${entry.codeText}`.trim();
  });
};

const recognizeLineByLine = async (worker, focusedCanvas, isDarkTheme, ocrMode = 'screen') => {
  const bands = detectLineBands(focusedCanvas, isDarkTheme);
  if (!bands.length || bands.length > 30) {
    return '';
  }
  const gutterWidth = detectGutterSplit(focusedCanvas, isDarkTheme);

  const recognizedEntries = [];
  for (const band of bands) {
    const lineHeight = band.bottom - band.top + 1;
    const gutterCanvas = extractCanvasRegion(focusedCanvas, {
      left: 0,
      top: band.top,
      width: gutterWidth,
      height: lineHeight
    });
    const codeCanvas = extractCanvasRegion(focusedCanvas, {
      left: Math.max(0, gutterWidth - 6),
      top: band.top,
      width: focusedCanvas.width - Math.max(0, gutterWidth - 6),
      height: lineHeight
    });
    if (!codeCanvas) {
      continue;
    }

    let lineNumber = '';
    if (gutterCanvas) {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789',
        user_defined_dpi: '300'
      });
      const gutterVariants = [
        renderVariant(gutterCanvas, { scale: 4.6, minWidth: 360, minHeight: 180, invert: isDarkTheme, mode: 'contrast', gamma: 0.82, sharpen: 0.95 }),
        renderVariant(gutterCanvas, { scale: 5, minWidth: 420, minHeight: 180, invert: isDarkTheme, mode: 'adaptive-binary', thresholdOffset: isDarkTheme ? -22 : -12, sharpen: 0.98 })
      ];
      let bestDigits = '';
      let bestDigitScore = -Infinity;
      for (const variant of gutterVariants) {
        try {
          const { data } = await worker.recognize(variant.toDataURL('image/png'));
          const digits = normalizeLineNumber(data.text || '');
          if (!digits) continue;
          const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
          const score = confidence + digits.length * 5;
          if (score > bestDigitScore) {
            bestDigitScore = score;
            bestDigits = digits;
          }
        } catch (_) {
          continue;
        }
      }
      lineNumber = bestDigits;
    }

    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: CODE_CHAR_WHITELIST,
      user_defined_dpi: '300'
    });
    const codeVariants = ocrMode === 'selection'
      ? [
          renderVariant(codeCanvas, { scale: 4.6, minWidth: 2500, minHeight: 180, invert: isDarkTheme, mode: 'contrast', gamma: 0.8, sharpen: 0.98 }),
          renderVariant(codeCanvas, { scale: 4.9, minWidth: 2600, minHeight: 180, invert: isDarkTheme, mode: 'strong-contrast', gamma: 0.76, sharpen: 1 }),
          renderVariant(codeCanvas, { scale: 5, minWidth: 2700, minHeight: 180, invert: isDarkTheme, mode: 'adaptive-binary', thresholdOffset: isDarkTheme ? -22 : -12, sharpen: 1 })
        ]
      : [
          renderVariant(codeCanvas, { scale: 4.2, minWidth: 2200, minHeight: 180, invert: isDarkTheme, mode: 'contrast', gamma: 0.84, sharpen: 0.94 }),
          renderVariant(codeCanvas, { scale: 4.5, minWidth: 2400, minHeight: 180, invert: isDarkTheme, mode: 'strong-contrast', gamma: 0.8, sharpen: 0.98 }),
          renderVariant(codeCanvas, { scale: 4.6, minWidth: 2400, minHeight: 180, invert: isDarkTheme, mode: 'adaptive-binary', thresholdOffset: isDarkTheme ? -18 : -10, sharpen: 0.98 })
        ];

    let bestCode = '';
    let bestScore = -Infinity;
    for (const variant of codeVariants) {
      try {
        const { data } = await worker.recognize(variant.toDataURL('image/png'));
        const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
        const normalized = normalizeCodeLine(data.text || '');
        if (!normalized || isLikelyUiText(normalized)) {
          continue;
        }
        const score = scoreLineText(normalized, confidence) + countMatches(normalized, /[{}[\]()]/g) * 4;
        if (score > bestScore) {
          bestScore = score;
          bestCode = normalized;
        }
      } catch (_) {
        continue;
      }
    }

    if (bestCode && !isLikelyUiText(bestCode)) {
      recognizedEntries.push({
        top: band.top,
        bottom: band.bottom,
        lineNumber,
        codeText: bestCode
      });
    }
  }

  if (!recognizedEntries.length) {
    return '';
  }

  const lines = ocrMode === 'selection'
    ? restoreSelectionLineNumbers(recognizedEntries)
    : recognizedEntries.map((entry) => entry.lineNumber ? `${entry.lineNumber} ${entry.codeText}` : entry.codeText);

  return normalizeOcrText(lines.join('\n'));
};

const recognizeBestVariant = async (imageData, language, ocrMode = 'screen') => {
  const resolvedLanguage = await resolveLanguage(language);
  const worker = await getWorker(resolvedLanguage);
  const prepared = await buildPreprocessVariants(imageData, ocrMode);
  const { focusedCanvas, isDarkTheme, variants } = prepared;
  let best = { score: -Infinity, text: '' };

  const lineByLineText = await recognizeLineByLine(worker, focusedCanvas, isDarkTheme, ocrMode).catch(() => '');
  if (lineByLineText) {
    const lineScore = scoreOcrCandidate(lineByLineText, 85, 'line-by-line');
    best = { score: lineScore, text: lineByLineText };
  }

  await worker.setParameters({
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: CODE_CHAR_WHITELIST,
    user_defined_dpi: '300'
  });

  for (const variant of variants) {
    try {
      const { data } = await worker.recognize(variant.image);
      const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
      const candidateText = data.text || '';
      const normalized = normalizeOcrText(candidateText);
      if (!normalized) {
        continue;
      }
      const score = scoreOcrCandidate(normalized, confidence, variant.label);
      if (score > best.score) {
        best = { score, text: normalized };
      }
    } catch (_) {
      continue;
    }
  }

  if (!best.text) {
    throw new Error('No readable text detected in the selected region');
  }

  return best.text;
};

const enqueueRequest = (task) => {
  const next = requestQueue.then(task, task);
  requestQueue = next.then(() => undefined, () => undefined);
  return next;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'offscreenOCR') return;

  enqueueRequest(async () => {
    if (!message.imageData) {
      throw new Error('No image data');
    }
    return recognizeBestVariant(message.imageData, message.ocrLanguage || 'eng', message.ocrMode || 'screen');
  })
    .then((text) => sendResponse({ text: text || '' }))
    .catch((error) => sendResponse({ error: getErrorMessage(error) }));

  return true;
});
