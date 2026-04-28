// Copics - YouTube OCR - Clean Version
(function() {
    'use strict';

    console.log('[Copics] Clean content script loaded');

    // Capture and extract text from video
    const captureAndExtractText = () => {
        const video = document.querySelector('video');
        if (!video) {
            alert('No video found!');
            return;
        }

        console.log('[Copics] Starting OCR process...');

        // Pause video briefly to get clear frame
        const wasPlaying = !video.paused;
        if (wasPlaying) {
            video.pause();
        }

        // Wait a moment for frame to update
        setTimeout(() => {
            // Create canvas for screenshot
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = video.videoWidth || video.offsetWidth;
            canvas.height = video.videoHeight || video.offsetHeight;
            
            // Draw current video frame
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convert to data URL (PNG keeps sharp text, we will downscale/compress before OCR)
            const imageUrl = canvas.toDataURL('image/png');
            console.log('[Copics] Screenshot captured');

            // Resume video if it was playing
            if (wasPlaying) {
                video.play();
            }

            // Create OCR modal
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white;
                padding: 30px;
                border-radius: 12px;
                max-width: 600px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            `;

            content.innerHTML = `
                <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">📸 Screenshot Captured</h3>
                <div style="margin: 0 0 20px 0;">
                    <img src="${imageUrl}" style="max-width: 100%; border-radius: 8px; border: 1px solid #ddd;" />
                </div>
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">Video frame ready for text extraction!</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="extract-text" style="
                        background: #2563eb;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">🔍 Extract Text</button>
                    <button id="close-modal" style="
                        background: #6b7280;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">Close</button>
                </div>
                <div id="result" style="margin-top: 20px; text-align: left; display: none;">
                    <h4 style="margin: 0 0 10px 0; color: #333;">📝 Extracted Text:</h4>
                    <textarea id="extracted-text" style="
                        width: 100%;
                        height: 200px;
                        padding: 10px;
                        border: 1px solid #ddd;
                        border-radius: 6px;
                        font-family: monospace;
                        font-size: 13px;
                        resize: vertical;
                    " placeholder="Text will appear here..."></textarea>
                    <button id="copy-text" style="
                        background: #10b981;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-top: 10px;
                    ">📋 Copy Text</button>
                </div>
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Extract text button
            const extractBtn = content.querySelector('#extract-text');
            const resultDiv = content.querySelector('#result');
            const textArea = content.querySelector('#extracted-text');
            const copyBtn = content.querySelector('#copy-text');
            const closeBtn = content.querySelector('#close-modal');

            extractBtn.onclick = async () => {
                console.log('[Copics] Starting OCR...');
                extractBtn.textContent = '⏳ Processing...';
                extractBtn.disabled = true;

                try {
                    const text = await performOCR(imageUrl);
                    
                    if (false) {
                        textArea.value = 'OCR was opened in the extension tab due to YouTube page security rules.';
                        resultDiv.style.display = 'block';
                        extractBtn.textContent = 'Opened In Extension Tab';
                        extractBtn.style.background = '#2563eb';
                    } else if (text) {
                        textArea.value = text;
                        resultDiv.style.display = 'block';
                        extractBtn.textContent = '✅ Text Extracted';
                        extractBtn.style.background = '#10b981';
                        console.log('[Copics] OCR completed:', text.substring(0, 100));
                    } else {
                        textArea.value = 'No text detected. Try a different frame or video.';
                        resultDiv.style.display = 'block';
                        extractBtn.textContent = '⚠️ No Text Found';
                    }
                } catch (error) {
                    console.error('[Copics] OCR error:', error);
                    textArea.value = 'OCR Error: ' + getErrorMessage(error) + '\n\nYou can right-click the screenshot to save it.';
                    resultDiv.style.display = 'block';
                    extractBtn.textContent = '❌ OCR Failed';
                    extractBtn.style.background = '#ef4444';
                } finally {
                    extractBtn.disabled = false;
                }
            };

            // Copy text button
            copyBtn.onclick = () => {
                textArea.select();
                document.execCommand('copy');
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy Text';
                }, 2000);
            };

            // Close button
            closeBtn.onclick = () => {
                modal.remove();
            };

            // Close on outside click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            };

            // Close on ESC key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);

            console.log('[Copics] OCR modal with screenshot displayed');
        }, 100);
    };

    // Simple text extraction - just return placeholder for now
    // Real OCR requires proper implementation
    const extractTextFromCanvas = (canvas) => {
        return "Text extraction from video frames requires OCR engine.\n\n" +
               "To implement real OCR, you need:\n" +
               "1. Tesseract.js with proper CSP handling\n" +
               "2. Proper image preprocessing\n" +
               "3. Reliable text normalization\n\n" +
               "Current screenshot is ready for manual OCR processing.";
    };

    const requestOffscreenOCR = async (imageData, ocrMode) => {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'localOcrRequest', imageData, ocrMode: ocrMode || 'screen' }, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!res || !res.ok) {
                    reject(new Error((res && res.error) || 'Local OCR request failed'));
                    return;
                }
                resolve(res.text || '');
            });
        });
    };

    // Local OCR only (no external API key needed)
    const performOCR = async (imageUrl, ocrMode) => {
        return requestOffscreenOCR(imageUrl, ocrMode);
    };
    
    // Helper: Base64 to Blob
    const base64ToBlob = (base64, type) => {
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type: type });
    };

    // Helper: Data URL to optimized Blob (downscale/compress to reduce OCR load)
    const dataUrlToOptimizedBlob = (dataUrl, options) => {
        const { maxWidth, maxHeight, mimeType, quality, preprocess } = options;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const srcW = img.naturalWidth || img.width;
                const srcH = img.naturalHeight || img.height;
                if (!srcW || !srcH) {
                    // Fallback to raw base64 if image is invalid
                    const base64Data = dataUrl.split(',')[1];
                    resolve(base64ToBlob(base64Data, mimeType || 'image/jpeg'));
                    return;
                }

                const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH);
                const dstW = Math.max(1, Math.round(srcW * scale));
                const dstH = Math.max(1, Math.round(srcH * scale));

                const canvas = document.createElement('canvas');
                canvas.width = dstW;
                canvas.height = dstH;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, dstW, dstH);

                if (preprocess) {
                    preprocessCanvas(ctx, dstW, dstH, preprocess);
                }
                // Small sharpen to improve code edges
                applySharpen(ctx, dstW, dstH, 0.6);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            const base64Data = dataUrl.split(',')[1];
                            resolve(base64ToBlob(base64Data, mimeType || 'image/jpeg'));
                        }
                    },
                    mimeType || 'image/jpeg',
                    typeof quality === 'number' ? quality : 0.8
                );
            };
            img.onerror = () => {
                const base64Data = dataUrl.split(',')[1];
                resolve(base64ToBlob(base64Data, mimeType || 'image/jpeg'));
            };
            img.src = dataUrl;
        });
    };
    const preprocessCanvas = (ctx, w, h, mode) => {
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const histogram = new Array(256).fill(0);

        // Grayscale + histogram
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            data[i] = data[i + 1] = data[i + 2] = gray;
            histogram[gray]++;
        }

        if (mode === 'contrast') {
            const bounds = percentileBounds(histogram, w * h, 0.02, 0.98);
            const range = Math.max(1, bounds.high - bounds.low);
            for (let i = 0; i < data.length; i += 4) {
                const v = Math.max(0, Math.min(255, Math.round((data[i] - bounds.low) * 255 / range)));
                data[i] = data[i + 1] = data[i + 2] = v;
            }
        }
        if (mode === 'binary') {
            const threshold = otsuThreshold(histogram, w * h);
            let white = 0;
            let black = 0;
            for (let i = 0; i < data.length; i += 4) {
                const v = data[i] >= threshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = v;
                if (v === 255) white++; else black++;
            }
            // Ensure background is white for better OCR
            if (white < black) {
                for (let i = 0; i < data.length; i += 4) {
                    const v = data[i] === 255 ? 0 : 255;
                    data[i] = data[i + 1] = data[i + 2] = v;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    };
    const percentileBounds = (hist, total, lowPct, highPct) => {
        const lowCount = Math.round(total * lowPct);
        const highCount = Math.round(total * highPct);
        let cum = 0;
        let low = 0;
        let high = 255;
        for (let i = 0; i < 256; i++) {
            cum += hist[i];
            if (cum >= lowCount) {
                low = i;
                break;
            }
        }
        cum = 0;
        for (let i = 255; i >= 0; i--) {
            cum += hist[i];
            if (cum >= (total - highCount)) {
                high = i;
                break;
            }
        }
        return { low, high };
    };
    const applySharpen = (ctx, w, h, amount) => {
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const out = new Uint8ClampedArray(data.length);
        const a = Math.max(0, Math.min(1, typeof amount === 'number' ? amount : 0.6));
        const idx = (x, y, c) => ((y * w + x) * 4 + c);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                for (let c = 0; c < 3; c++) {
                    const center = data[idx(x, y, c)];
                    const top = data[idx(x, y - 1, c)];
                    const bottom = data[idx(x, y + 1, c)];
                    const left = data[idx(x - 1, y, c)];
                    const right = data[idx(x + 1, y, c)];
                    let v = center * (1 + 4 * a) - a * (top + bottom + left + right);
                    v = v < 0 ? 0 : (v > 255 ? 255 : v);
                    out[idx(x, y, c)] = v;
                }
                out[idx(x, y, 3)] = data[idx(x, y, 3)];
            }
        }
        imgData.data.set(out);
        ctx.putImageData(imgData, 0, 0);
    };
    const otsuThreshold = (hist, total) => {
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0;
        let wB = 0;
        let wF = 0;
        let varMax = 0;
        let threshold = 127;

        for (let i = 0; i < 256; i++) {
            wB += hist[i];
            if (wB === 0) continue;
            wF = total - wB;
            if (wF === 0) break;
            sumB += i * hist[i];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > varMax) {
                varMax = varBetween;
                threshold = i;
            }
        }
        return threshold;
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Add OCR button to YouTube
    const addOCRButton = () => {
        const controls = document.querySelector('.ytp-right-controls');
        if (!controls || controls.dataset.copicsButton) {
            return;
        }

        const button = document.createElement('button');
        button.textContent = 'OCR';
        button.title = 'Extract text from video frame';
        button.style.cssText = `
            background: #ff0000 !important;
            color: white !important;
            border: none !important;
            padding: 8px 16px !important;
            border-radius: 4px !important;
            margin: 0 8px !important;
            font-size: 12px !important;
            font-weight: bold !important;
            cursor: pointer !important;
            z-index: 999999 !important;
        `;

        button.onclick = () => {
            console.log('[Copics] OCR button clicked successfully!');
            captureAndExtractText();
        };

        controls.appendChild(button);
        controls.dataset.copicsButton = 'true';
        console.log('[Copics] OCR button added successfully!');
    };

    // Wait for YouTube to load
    const init = () => {
        setTimeout(() => {
            addOCRButton();
        }, 2000);
    };

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Modal UI for OCR result
    const showOcrModal = (imageData, ocrMode) => {
        // Remove existing modal if any
        const existing = document.getElementById('copics-ocr-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'copics-ocr-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.75);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background: #ffffff;
            border-radius: 16px;
            max-width: 760px;
            width: 100%;
            padding: 18px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.35);
            text-align: center;
        `;

        card.innerHTML = `
            <h3 style="margin: 6px 0 12px 0; font-size: 18px; color: #111827;">Screenshot Captured</h3>
            <div style="margin: 0 0 12px 0;">
                <img id="copics-shot" src="${imageData}" style="max-width: 100%; border-radius: 12px; border: 1px solid #e5e7eb;" />
            </div>
            <p id="copics-status" style="margin: 0 0 14px 0; color: #6b7280; font-size: 13px;">Video frame ready for text extraction!</p>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="copics-extract" style="
                    background: #2563eb;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                ">Extract Text</button>
                <button id="copics-close" style="
                    background: #6b7280;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                ">Close</button>
            </div>
            <div id="copics-result" style="margin-top: 16px; text-align: left; display: none;">
                <textarea id="copics-text" style="
                    width: 100%;
                    height: 200px;
                    padding: 10px;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                    font-size: 12px;
                    resize: vertical;
                    box-sizing: border-box;
                " placeholder="Text will appear here..."></textarea>
                <button id="copics-copy" style="
                    background: #10b981;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                    margin-top: 10px;
                ">Copy Text</button>
            </div>
        `;

        modal.appendChild(card);
        document.body.appendChild(modal);

        const extractBtn = card.querySelector('#copics-extract');
        const closeBtn = card.querySelector('#copics-close');
        const status = card.querySelector('#copics-status');
        const resultDiv = card.querySelector('#copics-result');
        const textArea = card.querySelector('#copics-text');
        const copyBtn = card.querySelector('#copics-copy');

        extractBtn.onclick = async () => {
            extractBtn.textContent = 'Processing...';
            extractBtn.disabled = true;
            status.textContent = 'Running OCR...';
            try {
                const text = await performOCR(imageData, ocrMode || 'screen');
                if (false) {
                    textArea.value = 'OCR was opened in the extension tab due to YouTube page security rules.';
                    resultDiv.style.display = 'block';
                    status.textContent = 'Opened in extension tab';
                } else if (text && text.trim()) {
                    textArea.value = text.trim();
                    resultDiv.style.display = 'block';
                    status.textContent = 'Done';
                } else {
                    textArea.value = 'No text detected. Try a clearer frame.';
                    resultDiv.style.display = 'block';
                    status.textContent = 'No text found';
                }
            } catch (error) {
                textArea.value = 'OCR Error: ' + getErrorMessage(error);
                resultDiv.style.display = 'block';
                status.textContent = 'OCR failed';
            } finally {
                extractBtn.disabled = false;
                extractBtn.textContent = 'Extract Text';
            }
        };

        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            copyBtn.textContent = 'Copied';
            setTimeout(() => {
                copyBtn.textContent = 'Copy Text';
            }, 2000);
        };

        closeBtn.onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    };

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
    const normalizeOcrText = (raw) => {
        if (!raw) return '';
        const replacements = {
            '“': '"', '”': '"', '„': '"', '‟': '"',
            '‘': '\'', '’': '\'', '‚': '\'', '‛': '\'',
            '–': '-', '—': '-', '−': '-',
            '…': '...', '•': '*', '·': '.', '×': 'x', '÷': '/', '°': 'o'
        };
        let text = String(raw)
            .normalize('NFKC')
            .replace(/\r\n?/g, '\n')
            .replace(/[“”„‟‘’‚‛–—−…•·×÷°]/g, (m) => replacements[m] || m)
            .replace(/[\u00a0\u2007\u202f]/g, ' ')
            .replace(/[\u200b-\u200f\ufeff]/g, '')
            .replace(/[^\S\n]+/g, ' ')
            .replace(/[ \t]+\n/g, '\n');

        // Remove extra spaces around punctuation while keeping normal line breaks.
        text = text
            .replace(/ +([,.;:!?%])(?=\s|$)/g, '$1')
            .replace(/([([{]) +/g, '$1')
            .replace(/ +([)\]}])/g, '$1');

        // Drop control chars except newlines and tabs.
        text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

        // Keep paragraphs but avoid huge empty blocks.
        text = text
            .split('\n')
            .map((line) => line.replace(/[ \t]+$/g, ''))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return text;
    };
    const preprocessDataUrl = (dataUrl, options) => {
        const { maxWidth, maxHeight, mode } = options || {};
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const srcW = img.naturalWidth || img.width;
                const srcH = img.naturalHeight || img.height;
                const scale = Math.min(1, (maxWidth || srcW) / srcW, (maxHeight || srcH) / srcH);
                const dstW = Math.max(1, Math.round(srcW * scale));
                const dstH = Math.max(1, Math.round(srcH * scale));
                const canvas = document.createElement('canvas');
                canvas.width = dstW;
                canvas.height = dstH;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, dstW, dstH);
                if (mode) {
                    preprocessCanvas(ctx, dstW, dstH, mode);
                }
                applySharpen(ctx, dstW, dstH, 0.6);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    };
    const buildPreprocessVariants = async (dataUrl) => {
        const base = await preprocessDataUrl(dataUrl, {
            maxWidth: 1600,
            maxHeight: 900
        });
        const contrast = await preprocessDataUrl(dataUrl, {
            maxWidth: 1600,
            maxHeight: 900,
            mode: 'contrast'
        });
        const binary = await preprocessDataUrl(dataUrl, {
            maxWidth: 1600,
            maxHeight: 900,
            mode: 'binary'
        });
        return [base, contrast, binary];
    };
    const scoreOcrText = (text) => {
        if (!text) return -Infinity;
        const clean = text.replace(/\s+/g, ' ').trim();
        if (!clean) return -Infinity;
        const bad = (clean.match(/[\u0000-\u001f\u007f]/g) || []).length;
        const replacementLike = (clean.match(/[�]/g) || []).length;
        const alnum = (clean.match(/[A-Za-z0-9]/g) || []).length;
        const printable = (clean.match(/[^\s]/g) || []).length;
        const density = printable > 0 ? alnum / printable : 0;
        return clean.length - bad * 10 - replacementLike * 8 + density * 5;
    };

    const initAreaSelection = () => {
        const existing = document.getElementById('copics-selection-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'copics-selection-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.25);
            z-index: 999999;
            cursor: crosshair;
        `;

        const selectionBox = document.createElement('div');
        selectionBox.style.cssText = `
            position: absolute;
            border: 2px solid #2563eb;
            background: rgba(37, 99, 235, 0.2);
            display: none;
            pointer-events: none;
        `;

        overlay.appendChild(selectionBox);
        document.body.appendChild(overlay);

        let startX = 0;
        let startY = 0;
        let isDragging = false;

        overlay.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            selectionBox.style.display = 'block';
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
        });

        overlay.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const currentX = e.clientX;
            const currentY = e.clientY;

            const left = Math.min(startX, currentX);
            const top = Math.min(startY, currentY);
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);

            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
        });

        overlay.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;

            const endX = e.clientX;
            const endY = e.clientY;

            const left = Math.min(startX, endX);
            const top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);

            overlay.remove();

            if (width < 40 || height < 40) {
                return;
            }

            chrome.runtime.sendMessage({
                action: 'captureSelection',
                rect: { left, top, width, height },
                dpr: window.devicePixelRatio || 1
            });
        });

        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escHandler);
                overlay.remove();
            }
        });
    };

    const cropImageToSelection = (dataUrl, rect, dpr) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const sx = Math.max(0, Math.round(rect.left * dpr));
                const sy = Math.max(0, Math.round(rect.top * dpr));
                const sw = Math.max(1, Math.round(rect.width * dpr));
                const sh = Math.max(1, Math.round(rect.height * dpr));

                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('Screenshot decode failed'));
            img.src = dataUrl;
        });
    };

    // Message handler
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'showOCRButtons') {
            addOCRButton();
            sendResponse({ success: true });
        }
        if (message.action === 'showOcrModal' && message.imageData) {
            showOcrModal(message.imageData, message.ocrMode || 'screen');
            sendResponse({ success: true });
        }
        if (message.action === 'startAreaSelect') {
            initAreaSelection();
            sendResponse({ success: true });
        }
        if (message.action === 'selectionCapture' && message.dataUrl && message.rect) {
            cropImageToSelection(message.dataUrl, message.rect, message.dpr || 1)
                .then((cropped) => showOcrModal(cropped, 'selection'))
                .catch((err) => console.error('[Copics] Crop error:', err));
        }
    });

    // Expose for popup
    window.copicsExtension = { 
        initializeExtension: addOCRButton 
    };

})();
