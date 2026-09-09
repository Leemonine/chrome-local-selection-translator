(() => {
  "use strict";

  const MAX_TEXT_LENGTH = 6000;
  const host = document.createElement("div");
  host.id = "chrome-local-selection-translator";
  host.setAttribute("aria-live", "polite");
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .button, .panel { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #172033; }
    .button { position: fixed; z-index: 2147483647; display: none; width: 30px; height: 30px; border: 0; border-radius: 15px; background: #2463eb; color: #fff; cursor: pointer; font-size: 14px; font-weight: 700; line-height: 30px; text-align: center; box-shadow: 0 3px 12px rgba(20, 50, 120, .28); }
    .button:hover { background: #174ec6; }
    .panel { position: absolute; z-index: 2147483647; display: none; flex-direction: column; width: 400px; min-width: 240px; min-height: 72px; max-width: calc(100vw - 24px); overflow: hidden; resize: both; padding: 14px 40px 12px 14px; border: 1px solid #d8deea; border-radius: 10px; background: #fff; color: #172033; font-size: 14px; line-height: 1.55; box-shadow: 0 9px 30px rgba(20, 33, 61, .22); }
    .message { flex: 1 1 auto; min-height: 0; overflow: auto; white-space: pre-wrap; }
    .panel[data-state="error"] { color: #9a1b1b; }
    .panel[data-state="hint"] { color: #4b5568; }
    .close { position: absolute; top: 6px; right: 7px; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #596579; cursor: pointer; font-size: 20px; line-height: 24px; }
    .close:hover { background: #eef2f7; color: #172033; }
    .settings { flex: 0 0 auto; margin-top: 10px; padding-top: 8px; border-top: 1px solid #edf0f5; color: #596579; font-size: 12px; line-height: 1.35; }
    .setting { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
    .setting + .setting { margin-top: 6px; }
    .setting input { width: 14px; height: 14px; margin: 0; accent-color: #2463eb; cursor: pointer; }
    .setting select { min-width: 108px; padding: 2px 4px; border: 1px solid #cfd6e3; border-radius: 4px; background: #fff; color: #344156; font: inherit; }
  `;

  const button = document.createElement("button");
  button.className = "button";
  button.type = "button";
  button.textContent = "译";
  button.title = "翻译选中文本";
  button.setAttribute("aria-label", "翻译选中文本");

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  const closeButton = document.createElement("button");
  closeButton.className = "close";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.title = "关闭";
  closeButton.setAttribute("aria-label", "关闭翻译结果");
  const message = document.createElement("div");
  message.className = "message";
  const settings = document.createElement("div");
  settings.className = "settings";
  const setting = document.createElement("label");
  setting.className = "setting";
  const settingCheckbox = document.createElement("input");
  settingCheckbox.type = "checkbox";
  settingCheckbox.checked = true;
  const settingText = document.createElement("span");
  settingText.textContent = "点击页面其他位置时自动关闭";
  setting.append(settingCheckbox, settingText);
  const languageSetting = document.createElement("label");
  languageSetting.className = "setting";
  const languageText = document.createElement("span");
  languageText.textContent = "原文语言";
  const languageSelect = document.createElement("select");
  [
    ["auto", "自动识别"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"],
    ["de", "德语"], ["fr", "法语"], ["es", "西班牙语"], ["it", "意大利语"],
    ["pt", "葡萄牙语"], ["ru", "俄语"]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    languageSelect.appendChild(option);
  });
  languageSetting.append(languageText, languageSelect);
  settings.append(setting, languageSetting);
  panel.append(closeButton, message, settings);
  shadow.append(style, button, panel);

  let selectedParts = [];
  let selectedText = "";
  let selectionRect = null;
  let closeOnOutsideClick = true;
  let translationRequest = 0;
  let dismissedRequest = 0;
  let sourceLanguage = "auto";
  let initialPanelWidth = 400;
  let resizingPanel = false;

  function hideButton() {
    button.style.display = "none";
  }

  function closePanel() {
    panel.style.display = "none";
  }

  function updateCloseSetting(value) {
    closeOnOutsideClick = Boolean(value);
    settingCheckbox.checked = closeOnOutsideClick;
  }

  function applyInitialPanelSize() {
    const maxWidth = Math.max(240, window.innerWidth - 24);
    panel.style.width = `${Math.max(240, Math.min(initialPanelWidth, maxWidth))}px`;
    panel.style.height = "auto";
    panel.style.maxHeight = `${Math.max(72, window.innerHeight - 24)}px`;
  }

  // Keep only the actual line breaks returned by the browser selection. This
  // preserves the source's paragraph spacing without adding extra empty lines.
  function getSelectedParts(text) {
    return text.replace(/\r\n?/g, "\n").split(/(\n+)/).map((part) => {
      if (part.startsWith("\n")) return { type: "break", value: part };
      return { type: "text", value: part.replace(/[\t\f\v ]+/g, " ").trim() };
    }).filter((part) => part.type === "break" || part.value);
  }

  function showPanel(text, state = "") {
    message.textContent = text;
    panel.dataset.state = state;
    const wasHidden = panel.style.display === "none";
    panel.style.display = "flex";
    if (wasHidden) applyInitialPanelSize();
    const margin = 12;
    const desiredLeft = selectionRect ? window.scrollX + selectionRect.left : window.scrollX + margin;
    const desiredTop = selectionRect ? window.scrollY + selectionRect.bottom + 10 : window.scrollY + margin;
    if (wasHidden) {
      const width = panel.getBoundingClientRect().width;
      const height = panel.getBoundingClientRect().height;
      panel.style.left = `${Math.max(window.scrollX + margin, Math.min(desiredLeft, window.scrollX + window.innerWidth - width - margin))}px`;
      panel.style.top = `${Math.max(window.scrollY + margin, Math.min(desiredTop, window.scrollY + window.innerHeight - height - margin))}px`;
    }
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (!text) {
      hideButton();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const limitedText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
    selectedText = limitedText;
    selectedParts = getSelectedParts(limitedText);
    selectionRect = rect;
    initialPanelWidth = Math.max(240, Math.min(Math.ceil(rect.width), Math.min(720, window.innerWidth - 24)));
    button.style.display = "block";
    const left = Math.max(8, Math.min(rect.right + 6, window.innerWidth - 38));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 38));
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function detectSourceLanguage(text) {
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return "ja";
    if (/[\uac00-\ud7af]/.test(text)) return "ko";
    if (/[\u0400-\u04ff]/.test(text)) return "ru";
    if (/[\u3400-\u9fff]/.test(text)) return "zh-Hans";
    return "en";
  }

  async function getTranslatorOptions(detectedLanguage) {
    if (!globalThis.Translator || typeof globalThis.Translator.create !== "function") {
      throw new Error("UNAVAILABLE_API");
    }
    const candidates = ["zh-Hans", "zh"];
    for (const targetLanguage of candidates) {
      try {
        const options = { sourceLanguage: detectedLanguage, targetLanguage };
        const availability = await globalThis.Translator.availability(options);
        if (availability !== "unavailable") return { options, availability };
      } catch (_) {
        // Try the browser's alternate Chinese language tag.
      }
    }
    throw new Error("UNSUPPORTED_LANGUAGE");
  }

  async function translateSelection() {
    const translatableParts = selectedParts.filter((part) => part.type === "text");
    if (!translatableParts.length) return;
    hideButton();
    closePanel();
    const requestId = ++translationRequest;
    try {
      const detectedLanguage = sourceLanguage === "auto" ? detectSourceLanguage(selectedText) : sourceLanguage;
      if (detectedLanguage === "zh" || detectedLanguage === "zh-Hans") {
        showPanel(selectedParts.map((part) => part.value).join(""), "");
        return;
      }
      const { options, availability } = await getTranslatorOptions(detectedLanguage);
      if (availability === "downloadable" || availability === "downloading") {
        showPanel("正在准备 Chrome 本地英译中文模型。首次使用可能需要下载，完成后会自动翻译…", "hint");
      } else {
        showPanel("正在使用 Chrome 本地翻译…", "hint");
      }
      const translator = await globalThis.Translator.create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = typeof event.loaded === "number" ? ` ${Math.round(event.loaded * 100)}%` : "";
            if (dismissedRequest !== requestId) showPanel(`正在下载 Chrome 本地翻译模型…${progress}`, "hint");
          });
        }
      });
      const translatedParts = [];
      let translatedCount = 0;
      for (const part of selectedParts) {
        if (part.type === "break") {
          translatedParts.push(part.value);
          continue;
        }
        translatedCount += 1;
        if (translatableParts.length > 1) showPanel(`正在翻译第 ${translatedCount}/${translatableParts.length} 段…`, "hint");
        translatedParts.push(await translator.translate(part.value));
      }
      if (dismissedRequest !== requestId) {
        showPanel(translatedParts.join("") || "未获得翻译结果，请缩短选中文本后重试。");
      }
      translator.destroy?.();
    } catch (error) {
      const code = error && error.message;
      if (code === "UNAVAILABLE_API") {
        if (dismissedRequest !== requestId) showPanel("此 Chrome 未提供 Translator API。请更新 Chrome，并在 chrome://flags 中确认 Built-in AI / Translator API 未被禁用。", "error");
      } else if (code === "UNSUPPORTED_LANGUAGE") {
        if (dismissedRequest !== requestId) showPanel("此 Chrome 当前不支持所选语言到简体中文的本地翻译模型。请更换原文语言、更新 Chrome 后重试。", "error");
      } else {
        if (dismissedRequest !== requestId) showPanel("本地翻译未完成。首次下载模型时请保持网络可用，然后重试；若仍失败，请更新 Chrome。", "error");
      }
      console.warn("Local selection translator:", error);
    }
  }

  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", translateSelection);
  closeButton.addEventListener("click", closePanel);
  settingCheckbox.addEventListener("change", () => {
    updateCloseSetting(settingCheckbox.checked);
    document.dispatchEvent(new CustomEvent("local-selection-translator:set-setting", {
      detail: { closeOnOutsideClick }
    }));
  });
  languageSelect.addEventListener("change", () => {
    sourceLanguage = languageSelect.value;
    document.dispatchEvent(new CustomEvent("local-selection-translator:set-setting", {
      detail: { sourceLanguage }
    }));
  });
  document.addEventListener("local-selection-translator:setting", (event) => {
    const settings = event.detail || {};
    if (typeof settings.closeOnOutsideClick === "boolean") updateCloseSetting(settings.closeOnOutsideClick);
    if (typeof settings.sourceLanguage === "string" && languageSelect.querySelector(`option[value="${settings.sourceLanguage}"]`)) {
      sourceLanguage = settings.sourceLanguage;
      languageSelect.value = sourceLanguage;
    }
  });
  document.dispatchEvent(new CustomEvent("local-selection-translator:request-setting"));
  panel.addEventListener("pointerdown", (event) => {
    const rect = panel.getBoundingClientRect();
    resizingPanel = event.clientX >= rect.right - 28 && event.clientY >= rect.bottom - 28;
  });
  document.addEventListener("pointerup", () => {
    if (!resizingPanel) return;
    resizingPanel = false;
  }, true);
  document.addEventListener("mouseup", () => requestAnimationFrame(captureSelection), true);
  document.addEventListener("keyup", () => requestAnimationFrame(captureSelection), true);
  document.addEventListener("mousedown", (event) => {
    if (!host.contains(event.target)) {
      hideButton();
      if (closeOnOutsideClick) {
        dismissedRequest = translationRequest;
        closePanel();
      }
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideButton();
      closePanel();
    }
  }, true);
})();
