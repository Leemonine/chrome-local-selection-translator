(() => {
  "use strict";

  const HISTORY_KEY = "translationHistory";
  const LANGUAGE_LABELS = {
    "zh": "简体中文", "zh-Hans": "简体中文", "en": "英语", "ja": "日语", "ko": "韩语",
    "de": "德语", "fr": "法语", "es": "西班牙语", "it": "意大利语", "pt": "葡萄牙语", "ru": "俄语"
  };
  const closeOnOutsideClick = document.querySelector("#close-on-outside-click");
  const sourceLanguage = document.querySelector("#source-language");
  const targetLanguage = document.querySelector("#target-language");
  const swapLanguages = document.querySelector("#swap-languages");
  const enabled = document.querySelector("#history-enabled");
  const search = document.querySelector("#search");
  const clearButton = document.querySelector("#clear");
  const summary = document.querySelector("#summary");
  const empty = document.querySelector("#empty");
  const list = document.querySelector("#history-list");
  let history = [];
  let clearArmed = false;
  let clearTimer = 0;

  function sameLanguage(left, right) {
    const normalize = (value) => String(value || "").toLowerCase().split("-")[0];
    return normalize(left) === normalize(right);
  }

  async function saveSettings(changes) {
    await chrome.storage.local.set(changes);
  }

  function languageLabel(value) {
    return LANGUAGE_LABELS[value] || value || "未知";
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制";
    } catch (_) {
      button.textContent = "失败";
    }
    setTimeout(() => { button.textContent = "复制"; }, 1000);
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = query ? history.filter((item) => {
      return `${item.sourceText || ""}\n${item.translatedText || ""}\n${languageLabel(item.sourceLanguage)}\n${languageLabel(item.targetLanguage)}`
        .toLocaleLowerCase().includes(query);
    }) : history;
    list.replaceChildren();
    empty.hidden = filtered.length > 0;
    clearButton.disabled = history.length === 0;
    summary.textContent = `${enabled.checked ? "历史记录已开启" : "历史记录已关闭"}，显示 ${filtered.length}/${history.length} 条，最多保存 200 条。`;

    filtered.forEach((item) => {
      const card = document.createElement("article");
      card.className = "entry";
      const head = document.createElement("div");
      head.className = "entry-head";
      const meta = document.createElement("span");
      meta.textContent = `${languageLabel(item.sourceLanguage)} → ${languageLabel(item.targetLanguage)} · ${new Date(item.createdAt || 0).toLocaleString()}`;
      const actions = document.createElement("div");
      actions.className = "entry-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "复制";
      copy.addEventListener("click", () => copyText(String(item.translatedText || ""), copy));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", async () => {
        history = history.filter((entry) => entry.id !== item.id);
        await chrome.storage.local.set({ [HISTORY_KEY]: history });
        render();
      });
      actions.append(copy, remove);
      head.append(meta, actions);
      const source = document.createElement("div");
      source.className = "source";
      source.textContent = String(item.sourceText || "");
      const translation = document.createElement("div");
      translation.className = "translation";
      translation.textContent = String(item.translatedText || "");
      card.append(head, source, translation);
      list.appendChild(card);
    });
  }

  async function load() {
    const stored = await chrome.storage.local.get({
      closeOnOutsideClick: true,
      sourceLanguage: "auto",
      targetLanguage: "zh-Hans",
      historyEnabled: false,
      [HISTORY_KEY]: []
    });
    closeOnOutsideClick.checked = stored.closeOnOutsideClick !== false;
    sourceLanguage.value = sourceLanguage.querySelector(`option[value="${stored.sourceLanguage}"]`) ? stored.sourceLanguage : "auto";
    targetLanguage.value = targetLanguage.querySelector(`option[value="${stored.targetLanguage}"]`) ? stored.targetLanguage : "zh-Hans";
    enabled.checked = stored.historyEnabled === true;
    history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    render();
  }

  closeOnOutsideClick.addEventListener("change", () => {
    saveSettings({ closeOnOutsideClick: closeOnOutsideClick.checked });
  });
  sourceLanguage.addEventListener("change", () => {
    saveSettings({ sourceLanguage: sourceLanguage.value });
  });
  targetLanguage.addEventListener("change", () => {
    if (sourceLanguage.value !== "auto" && sameLanguage(sourceLanguage.value, targetLanguage.value)) {
      sourceLanguage.value = "auto";
    }
    saveSettings({ sourceLanguage: sourceLanguage.value, targetLanguage: targetLanguage.value });
  });
  swapLanguages.addEventListener("click", () => {
    const previousSource = sourceLanguage.value;
    const previousTarget = targetLanguage.value;
    if (previousSource === "auto") {
      sourceLanguage.value = previousTarget;
      targetLanguage.value = sameLanguage(previousTarget, "zh-Hans") ? "en" : "zh-Hans";
    } else {
      sourceLanguage.value = previousTarget;
      targetLanguage.value = previousSource;
    }
    saveSettings({ sourceLanguage: sourceLanguage.value, targetLanguage: targetLanguage.value });
  });
  enabled.addEventListener("change", async () => {
    await chrome.storage.local.set({ historyEnabled: enabled.checked });
    render();
  });
  search.addEventListener("input", render);
  clearButton.addEventListener("click", async () => {
    if (!clearArmed) {
      clearArmed = true;
      clearButton.textContent = "再次点击确认";
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearArmed = false;
        clearButton.textContent = "全部清除";
      }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    history = [];
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
    clearButton.textContent = "全部清除";
    render();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (
      changes.closeOnOutsideClick || changes.sourceLanguage || changes.targetLanguage ||
      changes.historyEnabled || changes[HISTORY_KEY]
    )) load();
  });

  load();
})();
