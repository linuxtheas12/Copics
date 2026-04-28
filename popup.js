// Copics popup
console.log('[Copics] Popup loaded');

const selectAreaBtn = document.getElementById('selectAreaBtn');
const refreshBtn = document.getElementById('refreshBtn');

selectAreaBtn.addEventListener('click', async () => {
    try {
        selectAreaBtn.disabled = true;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
            selectAreaBtn.disabled = false;
            return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelect' }, async () => {
            if (!chrome.runtime.lastError) return;
            console.warn('[Copics] No receiver for message:', chrome.runtime.lastError.message);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelect' }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Copics] Still no receiver:', chrome.runtime.lastError.message);
                    }
                });
            } catch (e) {
                console.error('[Copics] Inject failed:', e);
            }
        });
    } catch (error) {
        console.error('[Copics] Selection error:', error);
    } finally {
        selectAreaBtn.disabled = false;
    }
});

refreshBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
        chrome.tabs.reload(tab.id);
    }
});
