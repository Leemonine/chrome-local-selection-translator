(() => {
  "use strict";

  const DEFAULTS = {
    closeOnOutsideClick: true,
    sourceLanguage: "auto",
    targetLanguage: "zh-Hans",
    historyEnabled: false
  };
  const HISTORY_KEY = "translationHistory";
  const MAX_HISTORY_RECORDS = 200;
  const MAX_TEXT_LENGTH = 6000;

  function publish(settings) {
    document.dispatchEvent(new CustomEvent("local-selection-translator:setting", {
      detail: settings
    }));
  }

  chrome.storage.local.get(DEFAULTS).then((settings) => {
    publish(settings);
  }).catch(() => publish(DEFAULTS));

  document.addEventListener("local-selection-translator:set-setting", (event) => {
    const detail = event.detail || {};
    const changes = {};
    if (typeof detail.closeOnOutsideClick === "boolean") changes.closeOnOutsideClick = detail.closeOnOutsideClick;
    if (typeof detail.sourceLanguage === "string") changes.sourceLanguage = detail.sourceLanguage;
    if (typeof detail.targetLanguage === "string") changes.targetLanguage = detail.targetLanguage;
    if (typeof detail.historyEnabled === "boolean") changes.historyEnabled = detail.historyEnabled;
    if (!Object.keys(changes).length) return;
    chrome.storage.local.set(changes).then(() => chrome.storage.local.get(DEFAULTS)).then(publish);
  });

  document.addEventListener("local-selection-translator:save-history", async (event) => {
    const detail = event.detail || {};
    const sourceText = String(detail.sourceText || "").trim().slice(0, MAX_TEXT_LENGTH);
    const translatedText = String(detail.translatedText || "").trim().slice(0, MAX_TEXT_LENGTH);
    if (!sourceText || !translatedText) return;
    const settings = await chrome.storage.local.get({ historyEnabled: false, [HISTORY_KEY]: [] });
    if (!settings.historyEnabled) return;
    const current = Array.isArray(settings[HISTORY_KEY]) ? settings[HISTORY_KEY] : [];
    const sourceLanguage = String(detail.sourceLanguage || "auto").slice(0, 32);
    const targetLanguage = String(detail.targetLanguage || "zh-Hans").slice(0, 32);
    const duplicateKey = `${sourceLanguage}\u0000${targetLanguage}\u0000${sourceText}\u0000${translatedText}`;
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sourceText,
      translatedText,
      sourceLanguage,
      targetLanguage,
      createdAt: Date.now()
    };
    const next = [record, ...current.filter((item) => {
      const itemKey = `${item?.sourceLanguage || "auto"}\u0000${item?.targetLanguage || "zh-Hans"}\u0000${item?.sourceText || ""}\u0000${item?.translatedText || ""}`;
      return itemKey !== duplicateKey;
    })].slice(0, MAX_HISTORY_RECORDS);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
  });

  document.addEventListener("local-selection-translator:request-setting", () => {
    chrome.storage.local.get(DEFAULTS).then(publish);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") chrome.storage.local.get(DEFAULTS).then(publish);
  });
})();
