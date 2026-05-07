(function initContent() {
  const ARTICLE_SELECTOR = 'article[role="article"]';
  const TEXT_SELECTOR = '[data-testid="tweetText"]';
  const NAME_SELECTOR = '[data-testid="User-Name"]';
  const AVATAR_SELECTOR = '[data-testid="Tweet-User-Avatar"]';
  const NON_TEXT_SELECTORS = [
    '[data-testid="tweetPhoto"]',
    '[data-testid="card.wrapper"]',
    '[data-testid="videoComponent"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="previewInterstitial"]',
    '[data-testid="attachments"]',
    '[data-testid="tweet-media"]',
    '[data-testid="media-tweet-card"]',
    '[data-testid="socialContext"]',
    '[role="blockquote"]',
    'article[role="article"] article[role="article"]'
  ];
  const PROCESSED_ATTR = "data-xhb-processed";
  const MASKED_ATTR = "data-xhb-masked";
  const REVEALED_ATTR = "data-xhb-revealed";

  let settings = null;
  let observer = null;
  let refreshScheduled = false;
  const MASKED_LABEL = "垃圾评论已屏蔽";

  function setRevealState(article, revealed) {
    const overlay = article.querySelector(".xhb-overlay");
    const button = overlay?.querySelector(".xhb-overlay__button");
    const meta = overlay?.querySelector(".xhb-overlay__meta");

    if (revealed) {
      article.setAttribute(REVEALED_ATTR, "true");
      if (button) {
        button.textContent = "重新屏蔽";
      }
      if (meta) {
        meta.textContent = "已恢复查看";
      }
    } else {
      article.removeAttribute(REVEALED_ATTR);
      if (button) {
        button.textContent = "恢复查看";
      }
      if (meta) {
        meta.textContent = overlay?.dataset.maskLabel || MASKED_LABEL;
      }
    }
  }

  function findTextNode(article) {
    return article.querySelector(TEXT_SELECTOR);
  }

  function extractNodeText(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.tagName === "IMG") {
      return node.getAttribute("alt") || "";
    }

    if (node.tagName === "BR") {
      return "\n";
    }

    return Array.from(node.childNodes).map((child) => extractNodeText(child)).join("");
  }

  function getNodeText(node) {
    if (!node) {
      return "";
    }

    return extractNodeText(node) || node.innerText || node.textContent || "";
  }

  function getArticleText(article) {
    const textNode = findTextNode(article);
    if (!textNode) {
      return "";
    }

    return getNodeText(textNode);
  }

  function isPureTextArticle(article) {
    const textNode = findTextNode(article);
    if (!textNode) {
      return false;
    }

    return !NON_TEXT_SELECTORS.some((selector) => {
      const matched = article.querySelector(selector);
      return matched && !textNode.contains(matched);
    });
  }

  function getProfileData(article) {
    const nameNode = article.querySelector(NAME_SELECTOR);
    const rawText = getNodeText(nameNode);
    const normalized = rawText.replace(/\s+/g, " ").trim();
    const hasEmojiNode = Boolean(
      nameNode?.querySelector('img[alt], img[src*="emoji"], img[src*="twimg"], svg[aria-label*="emoji" i]')
    );

    if (!normalized) {
      return {
        displayName: "",
        handle: "",
        hasEmojiNode
      };
    }

    const handleMatch = normalized.match(/@([A-Za-z0-9_]+)/);
    const handle = handleMatch ? `@${handleMatch[1]}` : "";
    const displayName = handleMatch
      ? normalized.slice(0, handleMatch.index).trim()
      : normalized;

    return {
      displayName,
      handle,
      hasEmojiNode
    };
  }

  function ensureActionButton(article) {
    let action = article.querySelector(".xhb-manual-action");
    if (action) {
      return action;
    }

    action = document.createElement("button");
    action.type = "button";
    action.className = "xhb-manual-action";
    action.textContent = "屏蔽这条";
    action.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const text = getArticleText(article);
      if (!text) {
        return;
      }

      settings = await window.XHB.addCustomFullMatch(text);
      if (!settings) {
        return;
      }

      applyMask(article, {
        reason: "manual-block",
        cleanedText: window.XHB.sanitizeForRule(text)
      });
    });

    article.appendChild(action);
    return action;
  }

  function ensureRevealOverlay(article, matchResult) {
    let overlay = article.querySelector(".xhb-overlay");
    if (overlay) {
      const label = overlay.querySelector(".xhb-overlay__meta");
      if (label) {
        label.textContent = MASKED_LABEL;
      }
      overlay.dataset.maskLabel = label?.textContent || MASKED_LABEL;
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.className = "xhb-overlay";

    const meta = document.createElement("div");
    meta.className = "xhb-overlay__meta";
    meta.textContent = MASKED_LABEL;
    overlay.dataset.maskLabel = meta.textContent;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "xhb-overlay__button";
    button.textContent = "恢复查看";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const revealed = article.getAttribute(REVEALED_ATTR) === "true";
      setRevealState(article, !revealed);
    });

    overlay.append(meta, button);
    article.appendChild(overlay);
    return overlay;
  }

  function markSensitiveNodes(article) {
    article.querySelectorAll(".xhb-sensitive").forEach((node) => {
      node.classList.remove("xhb-sensitive");
    });

    const selectors = [TEXT_SELECTOR, NAME_SELECTOR, AVATAR_SELECTOR];
    selectors.forEach((selector) => {
      article.querySelectorAll(selector).forEach((node) => {
        node.classList.add("xhb-sensitive");
      });
    });

    if (!article.querySelector(".xhb-sensitive")) {
      Array.from(article.children).forEach((node) => {
        if (!node.classList.contains("xhb-overlay") && !node.classList.contains("xhb-manual-action")) {
          node.classList.add("xhb-sensitive");
        }
      });
    }
  }

  function applyMask(article, matchResult) {
    const isRevealed = article.getAttribute(REVEALED_ATTR) === "true";
    markSensitiveNodes(article);
    ensureRevealOverlay(article, matchResult);
    article.setAttribute(MASKED_ATTR, "true");
    setRevealState(article, isRevealed);
    article.dataset.xhbReason = matchResult.reason;
  }

  function clearMask(article) {
    article.removeAttribute(MASKED_ATTR);
    article.removeAttribute(REVEALED_ATTR);
    article.removeAttribute("data-xhb-reason");
    article.querySelector(".xhb-overlay")?.remove();
  }

  function processArticle(article) {
    if (!(article instanceof HTMLElement)) {
      return;
    }

    article.setAttribute(PROCESSED_ATTR, "true");
    ensureActionButton(article);

    const text = getArticleText(article);
    const profile = getProfileData(article);
    if (!text && !profile.displayName && !profile.handle && !profile.hasEmojiNode) {
      clearMask(article);
      return;
    }

    if (!isPureTextArticle(article)) {
      clearMask(article);
      return;
    }

    const result = window.XHB.matchTweet(text, settings, profile);
    if (result.matched) {
      applyMask(article, result);
    } else {
      clearMask(article);
    }
  }

  function scanPage() {
    if (!settings) {
      return;
    }

    document.querySelectorAll(ARTICLE_SELECTOR).forEach((article) => {
      processArticle(article);
    });
  }

  function scheduleRefresh() {
    if (refreshScheduled) {
      return;
    }

    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      scanPage();
    });
  }

  async function loadSettings() {
    settings = await window.XHB.getSettings();
    scheduleRefresh();
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length || mutation.removedNodes.length) {
          scheduleRefresh();
          break;
        }
        if (mutation.type === "characterData") {
          scheduleRefresh();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[window.XHB.STORAGE_KEY]) {
      return;
    }

    loadSettings();
  });

  loadSettings();
  startObserver();
})();
