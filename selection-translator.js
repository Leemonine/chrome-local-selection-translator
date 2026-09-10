(() => {
  "use strict";

  const MAX_TEXT_LENGTH = 6000;
  const SUPPORTED_LANGUAGES = new Set(["zh-Hans", "en", "ja", "ko", "de", "fr", "es", "it", "pt", "ru"]);
  const host = document.createElement("div");
  host.id = "chrome-local-selection-translator";
  host.setAttribute("aria-live", "polite");
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .button, .panel { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #1d1d1f; }
    .button { position: fixed; z-index: 2147483647; display: none; width: 30px; height: 30px; border: 0; border-radius: 15px; background: #fa243c; color: #fff; cursor: pointer; font-size: 14px; font-weight: 700; line-height: 30px; text-align: center; box-shadow: 0 3px 12px rgba(0, 0, 0, .22); }
    .button:hover { background: #d91e35; }
    .panel { position: absolute; z-index: 2147483647; display: none; flex-direction: column; width: 400px; min-width: 280px; min-height: 72px; max-width: calc(100vw - 24px); overflow: hidden; resize: both; padding: 38px 14px 12px; border: 1px solid #d2d2d7; border-radius: 10px; background: #fff; color: #1d1d1f; font-size: 14px; line-height: 1.55; box-shadow: 0 9px 30px rgba(0, 0, 0, .20); }
    .message { flex: 1 1 auto; min-height: 0; overflow: auto; white-space: pre-wrap; }
    .panel[data-state="error"] { color: #9a1b1b; }
    .panel[data-state="hint"] { color: #6e6e73; }
    .panel-actions { position: absolute; top: 6px; right: 7px; display: flex; align-items: center; gap: 2px; }
    .panel-action { height: 26px; padding: 0 7px; border: 0; border-radius: 6px; background: transparent; color: #6e6e73; cursor: pointer; font: inherit; font-size: 12px; line-height: 26px; }
    .panel-action:hover:not(:disabled) { background: #f2f2f7; color: #1d1d1f; }
    .panel-action:disabled { cursor: default; opacity: .4; }
    .close { width: 26px; padding: 0; font-size: 20px; line-height: 24px; }
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
  const panelActions = document.createElement("div");
  panelActions.className = "panel-actions";
  const copyButton = document.createElement("button");
  copyButton.className = "panel-action";
  copyButton.type = "button";
  copyButton.textContent = "复制";
  copyButton.disabled = true;
  copyButton.title = "复制译文";
  const closeButton = document.createElement("button");
  closeButton.className = "panel-action close";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.title = "关闭";
  closeButton.setAttribute("aria-label", "关闭翻译结果");
  panelActions.append(copyButton, closeButton);
  const message = document.createElement("div");
  message.className = "message";
  panel.append(panelActions, message);
  shadow.append(style, button, panel);

  let selectedParts = [];
  let selectedText = "";
  let selectionRect = null;
  let closeOnOutsideClick = true;
  let translationRequest = 0;
  let dismissedRequest = 0;
  let sourceLanguage = "auto";
  let targetLanguage = "zh-Hans";
  let historyEnabled = false;
  let translatedText = "";
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
  }

  function applyInitialPanelSize() {
    const maxWidth = Math.max(280, window.innerWidth - 24);
    panel.style.width = `${Math.max(280, Math.min(initialPanelWidth, maxWidth))}px`;
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
    translatedText = state ? "" : text;
    copyButton.disabled = !translatedText;
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

  async function copyTranslatedText() {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
    } catch (_) {
      const temporary = document.createElement("textarea");
      temporary.value = translatedText;
      temporary.style.cssText = "position:fixed;left:-9999px;top:0";
      shadow.appendChild(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }
    copyButton.textContent = "已复制";
    setTimeout(() => { copyButton.textContent = "复制"; }, 1200);
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
    initialPanelWidth = Math.max(280, Math.min(Math.ceil(rect.width), Math.min(720, window.innerWidth - 24)));
    button.style.display = "block";
    const left = Math.max(8, Math.min(rect.right + 6, window.innerWidth - 38));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 38));
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function fallbackSourceLanguage(text) {
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return "ja";
    if (/[\uac00-\ud7af]/.test(text)) return "ko";
    if (/[\u0400-\u04ff]/.test(text)) return "ru";
    if (/[\u3400-\u9fff]/.test(text)) return "zh-Hans";
    return "en";
  }

  function normalizeLanguageTag(language) {
    const value = String(language || "").trim();
    if (!value) return "";
    const primary = value.toLowerCase().split("-")[0];
    return primary === "zh" ? "zh-Hans" : primary;
  }

  function sameLanguage(left, right) {
    return normalizeLanguageTag(left) === normalizeLanguageTag(right);
  }

  async function detectSourceLanguage(text, requestId) {
    const fallback = fallbackSourceLanguage(text);
    if (text.trim().length < 12 || !globalThis.LanguageDetector || typeof globalThis.LanguageDetector.create !== "function") {
      return fallback;
    }
    let detector;
    try {
      const availability = typeof globalThis.LanguageDetector.availability === "function"
        ? await globalThis.LanguageDetector.availability()
        : "available";
      if (availability === "unavailable") return fallback;
      if (availability === "downloadable" || availability === "downloading") {
        if (requestId === translationRequest && dismissedRequest !== requestId) showPanel("正在准备浏览器本地语言识别模型…", "hint");
      } else if (requestId === translationRequest && dismissedRequest !== requestId) {
        showPanel("正在识别原文语言…", "hint");
      }
      detector = await globalThis.LanguageDetector.create({
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = typeof event.loaded === "number" ? ` ${Math.round(event.loaded * 100)}%` : "";
            if (requestId === translationRequest && dismissedRequest !== requestId) showPanel(`正在下载浏览器本地语言识别模型…${progress}`, "hint");
          });
        }
      });
      const results = await detector.detect(text);
      const best = Array.isArray(results) ? results.find((item) => item?.detectedLanguage && item.detectedLanguage !== "und") : null;
      return best && Number(best.confidence) >= 0.35
        ? normalizeLanguageTag(best.detectedLanguage) || fallback
        : fallback;
    } catch (error) {
      console.warn("Local language detection fell back to script detection:", error);
      return fallback;
    } finally {
      detector?.destroy?.();
    }
  }

  function languageCandidates(language) {
    return normalizeLanguageTag(language) === "zh-Hans" ? ["zh-Hans", "zh"] : [language];
  }

  async function getTranslatorOptions(detectedLanguage, requestedTargetLanguage) {
    if (!globalThis.Translator || typeof globalThis.Translator.create !== "function") {
      throw new Error("UNAVAILABLE_API");
    }
    for (const sourceCandidate of languageCandidates(detectedLanguage)) {
      for (const targetCandidate of languageCandidates(requestedTargetLanguage)) {
        try {
          const options = { sourceLanguage: sourceCandidate, targetLanguage: targetCandidate };
          const availability = await globalThis.Translator.availability(options);
          if (availability !== "unavailable") return { options, availability };
        } catch (_) {
          // Try the browser's alternate language tag where one exists.
        }
      }
    }
    throw new Error("UNSUPPORTED_LANGUAGE");
  }

  function saveHistory(sourceTextValue, translatedTextValue, source, target) {
    if (!historyEnabled || !translatedTextValue) return;
    document.dispatchEvent(new CustomEvent("local-selection-translator:save-history", {
      detail: {
        sourceText: sourceTextValue,
        translatedText: translatedTextValue,
        sourceLanguage: source,
        targetLanguage: target
      }
    }));
  }

  async function translateSelection() {
    const translatableParts = selectedParts.filter((part) => part.type === "text");
    if (!translatableParts.length) return;
    hideButton();
    closePanel();
    const requestId = ++translationRequest;
    try {
      const detectedLanguage = sourceLanguage === "auto"
        ? await detectSourceLanguage(selectedText, requestId)
        : sourceLanguage;
      if (sameLanguage(detectedLanguage, targetLanguage)) {
        showPanel(selectedParts.map((part) => part.value).join(""), "");
        return;
      }
      const { options, availability } = await getTranslatorOptions(detectedLanguage, targetLanguage);
      if (availability === "downloadable" || availability === "downloading") {
        showPanel("正在准备浏览器本地翻译模型。首次使用可能需要下载，完成后会自动翻译…", "hint");
      } else {
        showPanel("正在使用浏览器本地翻译…", "hint");
      }
      const translator = await globalThis.Translator.create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = typeof event.loaded === "number" ? ` ${Math.round(event.loaded * 100)}%` : "";
            if (requestId === translationRequest && dismissedRequest !== requestId) showPanel(`正在下载浏览器本地翻译模型…${progress}`, "hint");
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
      if (requestId === translationRequest && dismissedRequest !== requestId) {
        const finalTranslation = translatedParts.join("") || "";
        showPanel(finalTranslation || "未获得翻译结果，请缩短选中文本后重试。", finalTranslation ? "" : "error");
        if (finalTranslation) saveHistory(selectedText, finalTranslation, detectedLanguage, targetLanguage);
      }
      translator.destroy?.();
    } catch (error) {
      const code = error && error.message;
      if (code === "UNAVAILABLE_API") {
        if (requestId === translationRequest && dismissedRequest !== requestId) showPanel("此浏览器未提供 Translator API。请更新 Chrome 或 Edge，并确认内置翻译功能未被禁用。", "error");
      } else if (code === "UNSUPPORTED_LANGUAGE") {
        if (requestId === translationRequest && dismissedRequest !== requestId) showPanel("此浏览器当前不支持所选原文语言和目标语言之间的本地翻译模型。请更换语言或更新浏览器后重试。", "error");
      } else {
        if (requestId === translationRequest && dismissedRequest !== requestId) showPanel("本地翻译未完成。首次下载模型时请保持网络可用，然后重试；若仍失败，请更新浏览器。", "error");
      }
      console.warn("Local selection translator:", error);
    }
  }

  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", translateSelection);
  copyButton.addEventListener("click", copyTranslatedText);
  closeButton.addEventListener("click", () => {
    dismissedRequest = translationRequest;
    closePanel();
  });
  document.addEventListener("local-selection-translator:setting", (event) => {
    const settings = event.detail || {};
    if (typeof settings.closeOnOutsideClick === "boolean") updateCloseSetting(settings.closeOnOutsideClick);
    if (settings.sourceLanguage === "auto" || SUPPORTED_LANGUAGES.has(settings.sourceLanguage)) {
      sourceLanguage = settings.sourceLanguage;
    }
    if (SUPPORTED_LANGUAGES.has(settings.targetLanguage)) {
      targetLanguage = settings.targetLanguage;
    }
    if (typeof settings.historyEnabled === "boolean") {
      historyEnabled = settings.historyEnabled;
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
