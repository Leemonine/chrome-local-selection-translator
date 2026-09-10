(() => {
  "use strict";

  const LANGUAGE_OPTIONS = [
    ["zh-Hans", "简体中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"],
    ["de", "德语"], ["fr", "法语"], ["es", "西班牙语"], ["it", "意大利语"],
    ["pt", "葡萄牙语"], ["ru", "俄语"]
  ];
  const HISTORY_KEY = "translationHistory";
  const MAX_HISTORY_RECORDS = 200;

  const status = document.querySelector("#status");
  const result = document.querySelector("#result");
  const sourceText = document.querySelector("#source-text");
  const sourceLanguageSelect = document.querySelector("#source-language");
  const targetLanguageSelect = document.querySelector("#target-language");
  const swapButton = document.querySelector("#swap-languages");
  const retryButton = document.querySelector("#retry");
  const copyButton = document.querySelector("#copy");
  const historyCheckbox = document.querySelector("#save-history");
  let requestText = "";
  let translatedText = "";
  let translationRequest = 0;

  [["auto", "自动识别"], ...LANGUAGE_OPTIONS].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sourceLanguageSelect.appendChild(option);
  });
  LANGUAGE_OPTIONS.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    targetLanguageSelect.appendChild(option);
  });

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

  function splitText(text) {
    return text.replace(/\r\n?|\u2028|\u2029/g, "\n").split(/(\n+)/).map((part) => {
      // Context-menu selections often expose a paragraph boundary as one
      // newline. Render that boundary as a visible paragraph gap; preserve
      // larger runs exactly as received.
      if (part.startsWith("\n")) return { type: "break", value: part.length === 1 ? "\n\n" : part };
      return { type: "text", value: part.replace(/[\t\f\v ]+/g, " ").trim() };
    }).filter((part) => part.type === "break" || part.value);
  }

  function showStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
    status.hidden = false;
    result.hidden = true;
    copyButton.disabled = true;
  }

  function showResult(text) {
    translatedText = text;
    result.textContent = text;
    result.hidden = false;
    status.hidden = true;
    copyButton.disabled = !text;
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
      showStatus(availability === "available" ? "正在识别原文语言…" : "正在准备浏览器本地语言识别模型…");
      detector = await globalThis.LanguageDetector.create({
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (requestId !== translationRequest) return;
            const progress = typeof event.loaded === "number" ? ` ${Math.round(event.loaded * 100)}%` : "";
            showStatus(`正在下载浏览器本地语言识别模型…${progress}`);
          });
        }
      });
      const results = await detector.detect(text);
      const best = Array.isArray(results) ? results.find((item) => item?.detectedLanguage && item.detectedLanguage !== "und") : null;
      return best && Number(best.confidence) >= 0.35
        ? normalizeLanguageTag(best.detectedLanguage) || fallback
        : fallback;
    } catch (error) {
      console.warn("Language detection used the local fallback:", error);
      return fallback;
    } finally {
      detector?.destroy?.();
    }
  }

  function languageCandidates(language) {
    return normalizeLanguageTag(language) === "zh-Hans" ? ["zh-Hans", "zh"] : [language];
  }

  async function getTranslatorOptions(sourceLanguage, targetLanguage) {
    if (!globalThis.Translator || typeof globalThis.Translator.create !== "function") {
      throw new Error("UNAVAILABLE_API");
    }
    for (const sourceCandidate of languageCandidates(sourceLanguage)) {
      for (const targetCandidate of languageCandidates(targetLanguage)) {
        try {
          const options = { sourceLanguage: sourceCandidate, targetLanguage: targetCandidate };
          const availability = await globalThis.Translator.availability(options);
          if (availability !== "unavailable") return { options, availability };
        } catch (_) {
          // Try an alternate Chinese language tag where needed.
        }
      }
    }
    throw new Error("UNSUPPORTED_LANGUAGE");
  }

  async function saveHistory(sourceLanguage, targetLanguage, translation) {
    if (!historyCheckbox.checked || !translation) return;
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const duplicateKey = [requestText, translation, sourceLanguage, targetLanguage].join("\u0000");
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sourceText: requestText,
      translatedText: translation,
      sourceLanguage,
      targetLanguage,
      createdAt: Date.now()
    };
    const next = [entry, ...history.filter((item) => {
      return [item.sourceText, item.translatedText, item.sourceLanguage, item.targetLanguage].join("\u0000") !== duplicateKey;
    })].slice(0, MAX_HISTORY_RECORDS);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
  }

  async function translate() {
    const requestId = ++translationRequest;
    if (!requestText) {
      showStatus("没有取得选中文字。请回到 PDF 或网页，重新选择文字后使用右键翻译。", true);
      return;
    }

    const selectedSource = sourceLanguageSelect.value;
    const targetLanguage = targetLanguageSelect.value;
    await chrome.storage.local.set({ sourceLanguage: selectedSource, targetLanguage });

    try {
      const sourceLanguage = selectedSource === "auto"
        ? await detectSourceLanguage(requestText, requestId)
        : selectedSource;
      if (requestId !== translationRequest) return;
      if (sameLanguage(sourceLanguage, targetLanguage)) {
        showResult(requestText);
        return;
      }

      const { options, availability } = await getTranslatorOptions(sourceLanguage, targetLanguage);
      showStatus(availability === "available"
        ? "正在使用浏览器本地翻译…"
        : "正在准备浏览器本地翻译模型。首次使用可能需要下载…");

      const translator = await globalThis.Translator.create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (requestId !== translationRequest) return;
            const progress = typeof event.loaded === "number" ? ` ${Math.round(event.loaded * 100)}%` : "";
            showStatus(`正在下载浏览器本地翻译模型…${progress}`);
          });
        }
      });

      const output = [];
      for (const part of splitText(requestText)) {
        output.push(part.type === "break" ? part.value : await translator.translate(part.value));
      }
      translator.destroy?.();
      if (requestId !== translationRequest) return;
      const translation = output.join("");
      showResult(translation);
      await saveHistory(sourceLanguage, targetLanguage, translation);
    } catch (error) {
      if (requestId !== translationRequest) return;
      if (error?.message === "UNAVAILABLE_API") {
        showStatus("此浏览器未提供 Translator API。请更新 Chrome 或 Edge，并确认内置翻译功能没有被禁用。", true);
      } else if (error?.message === "UNSUPPORTED_LANGUAGE") {
        showStatus("当前浏览器不支持所选原文语言和目标语言之间的本地翻译模型。请更换语言后重试。", true);
      } else if (error?.name === "NotAllowedError") {
        showStatus("首次准备语言模型需要一次窗口内操作。请点击上方“重新翻译”。");
      } else {
        showStatus("本地翻译失败。首次下载模型时请保持网络可用，然后重试。", true);
        console.warn("Context translation failed:", error);
      }
    }
  }

  retryButton.addEventListener("click", translate);
  sourceLanguageSelect.addEventListener("change", translate);
  targetLanguageSelect.addEventListener("change", () => {
    if (sourceLanguageSelect.value !== "auto" && sameLanguage(sourceLanguageSelect.value, targetLanguageSelect.value)) {
      sourceLanguageSelect.value = "auto";
    }
    translate();
  });
  swapButton.addEventListener("click", () => {
    const source = sourceLanguageSelect.value;
    const target = targetLanguageSelect.value;
    if (source === "auto") {
      sourceLanguageSelect.value = target;
      targetLanguageSelect.value = sameLanguage(target, "zh-Hans") ? "en" : "zh-Hans";
    } else {
      sourceLanguageSelect.value = target;
      targetLanguageSelect.value = source;
    }
    translate();
  });
  historyCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ historyEnabled: historyCheckbox.checked });
  });
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(translatedText);
      copyButton.textContent = "已复制";
    } catch (_) {
      copyButton.textContent = "复制失败";
    }
    setTimeout(() => { copyButton.textContent = "复制译文"; }, 1200);
  });
  document.querySelector("#close").addEventListener("click", () => window.close());

  async function initialize() {
    const [sessionData, settings] = await Promise.all([
      chrome.storage.session.get("contextTranslationRequest"),
      chrome.storage.local.get({ sourceLanguage: "auto", targetLanguage: "zh-Hans", historyEnabled: false })
    ]);
    requestText = String(sessionData.contextTranslationRequest?.text || "");
    sourceText.textContent = requestText;
    sourceLanguageSelect.value = sourceLanguageSelect.querySelector(`option[value="${settings.sourceLanguage}"]`)
      ? settings.sourceLanguage
      : "auto";
    targetLanguageSelect.value = targetLanguageSelect.querySelector(`option[value="${settings.targetLanguage}"]`)
      ? settings.targetLanguage
      : "zh-Hans";
    historyCheckbox.checked = settings.historyEnabled === true;
    await translate();
  }

  initialize();
})();
