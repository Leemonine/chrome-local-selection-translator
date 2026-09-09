(() => {
  "use strict";

  const DEFAULTS = {
    closeOnOutsideClick: true,
    sourceLanguage: "auto"
  };

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
    if (!Object.keys(changes).length) return;
    chrome.storage.local.set(changes).then(() => chrome.storage.local.get(DEFAULTS)).then(publish);
  });

  document.addEventListener("local-selection-translator:request-setting", () => {
    chrome.storage.local.get(DEFAULTS).then(publish);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") chrome.storage.local.get(DEFAULTS).then(publish);
  });
})();
