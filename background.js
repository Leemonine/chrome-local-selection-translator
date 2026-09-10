(() => {
  "use strict";

  const MENU_ID = "local-selection-translator-translate";
  const MAX_TEXT_LENGTH = 6000;

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: "本地翻译选中文字",
        contexts: ["selection"]
      });
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID) return;
    const text = String(info.selectionText || "").trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) return;

    await chrome.storage.session.set({
      contextTranslationRequest: {
        text,
        createdAt: Date.now()
      }
    });

    await chrome.windows.create({
      url: chrome.runtime.getURL("translate.html"),
      type: "popup",
      width: 620,
      height: 460,
      focused: true
    });
  });
})();
