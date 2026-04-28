// Copics - Simple Background Script
chrome.runtime.onInstalled.addListener(() => {
    console.log('[Copics] Extension installed');
});

const OFFSCREEN_PATH = 'offscreen.html';
const DEFAULT_OCR_LANGUAGE = 'eng';

const ensureOffscreenDocument = async () => {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [offscreenUrl]
        });
        if (contexts && contexts.length > 0) return;
    }
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'Run local OCR outside page CSP restrictions'
    });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Copics] Background message:', message.action);
    
    if (message.action === 'getSettings') {
        chrome.storage.sync.get({ ocrLanguage: DEFAULT_OCR_LANGUAGE }, (items) => {
            sendResponse({ ocrLanguage: items.ocrLanguage || DEFAULT_OCR_LANGUAGE });
        });
        return true;
    }
    
    if (message.action === 'localOcrRequest') {
        (async () => {
            try {
                await ensureOffscreenDocument();
                const settings = await chrome.storage.sync.get({ ocrLanguage: DEFAULT_OCR_LANGUAGE });
                const res = await chrome.runtime.sendMessage({
                    action: 'offscreenOCR',
                    imageData: message.imageData,
                    ocrLanguage: settings.ocrLanguage || DEFAULT_OCR_LANGUAGE,
                    ocrMode: message.ocrMode || 'screen'
                });
                if (res && !res.error) {
                    sendResponse({ ok: true, text: res.text || '' });
                } else {
                    sendResponse({ ok: false, error: (res && res.error) || 'Offscreen OCR failed' });
                }
            } catch (err) {
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
        })();
        return true;
    }

    if (message.action === 'captureSelection' && sender.tab) {
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'selectionCapture',
                dataUrl,
                rect: message.rect,
                dpr: message.dpr
            });
        });
        return true;
    }

});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle_ocr') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'showOCRButtons' });
            }
        });
    }
});
