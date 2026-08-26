import { submitUrl, uploadImage } from "./api.js";
import { shouldAutoSave } from "./autosave.js";
import { getConfig } from "./config.js";
import { findDownloadableVideo } from "./detection.js";

const inFlightUrls = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "save-to-archive",
    title: "Save image to archive",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "save-to-archive-tagged",
    title: "Save image to archive with tags…",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (
    info.menuItemId !== "save-to-archive" &&
    info.menuItemId !== "save-to-archive-tagged"
  ) {
    return;
  }

  try {
    let tags = "";
    if (info.menuItemId === "save-to-archive-tagged") {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => prompt("Enter tags (comma-separated):"),
      });
      tags = result?.result || "";
    }

    const response = await fetch(info.srcUrl);
    const blob = await response.blob();
    const filename =
      info.srcUrl.split("/").pop().split("?")[0] || "image.png";
    const ok = await uploadImage(blob, filename, {
      sourceUrl: info.srcUrl,
      pageTitle: tab.title || "",
      tags,
    });
    showNotification(ok ? "Saved!" : "Save failed");
  } catch (error) {
    showNotification(`Save failed: ${error.message}`);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "submit-url") {
    submitUrl(message.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "auto-save-candidate") {
    const candidate = findDownloadableVideo(
      message.pageUrl,
      message.videoSources,
    );
    autoSaveCandidate(candidate);
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "archive-page") {
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await archiveCurrentTab(tab);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const config = await getConfig();
  const candidate = findDownloadableVideo(tab.url);
  const canAutoSave = shouldAutoSave(config, candidate);
  await chrome.action.setBadgeText({ text: candidate ? "●" : "", tabId });
  if (candidate) {
    await chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
  }
  if (canAutoSave) {
    await autoSaveCandidate(candidate, config);
  }
});

async function autoSaveCandidate(candidate, knownConfig = null) {
  const config = knownConfig || (await getConfig());
  if (!shouldAutoSave(config, candidate)) {
    return;
  }

  const key = `${config.activeTargetId}|${candidate}`;
  if (inFlightUrls.has(key)) {
    return;
  }
  inFlightUrls.add(key);

  try {
    const result = await submitUrl(candidate);
    if (!result.ok) {
      inFlightUrls.delete(key);
      return;
    }
    if (!result.skipped) {
      showNotification("Video auto-saved");
    }
  } catch {
    inFlightUrls.delete(key);
  }
}

async function archiveCurrentTab(tab) {
  if (!tab.url) {
    return;
  }
  try {
    const result = await submitUrl(tab.url);
    showNotification(result.ok ? "Submitted!" : `Failed: ${result.error}`);
  } catch (error) {
    showNotification(`Submit failed: ${error.message}`);
  }
}

function showNotification(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Hoarder",
    message,
  });
}
