import { submitUrl, uploadImage } from "./api.js";
import { shouldAutoSave } from "./autosave.js";
import { getConfig } from "./config.js";
import { findDownloadableVideo } from "./detection.js";

const inFlightUrls = new Set();
let activeSubmissions = 0;
const reloadUpdatedExtensionAlarm = "reload-updated-extension";
const actionIcons = {
  idle: {
    16: "icons/icon-16.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  saving: {
    16: "icons/icon-saving-16.png",
    48: "icons/icon-saving-48.png",
    128: "icons/icon-saving-128.png",
  },
  saved: {
    16: "icons/icon-saved-16.png",
    48: "icons/icon-saved-48.png",
    128: "icons/icon-saved-128.png",
  },
  failed: {
    16: "icons/icon-failed-16.png",
    48: "icons/icon-failed-48.png",
    128: "icons/icon-failed-128.png",
  },
};
const actionTitles = {
  idle: "Hoarder",
  saving: "Hoarder: saving…",
  saved: "Hoarder: saved",
  failed: "Hoarder: save failed",
};
const actionBadgeFallbacks = {
  saving: { text: "…", color: "#F9A825" },
  saved: { text: "✓", color: "#2E7D32" },
  failed: { text: "!", color: "#C62828" },
};

async function setActionIcon(state, tabId) {
  const iconDetails = { path: actionIcons[state] };
  const titleDetails = { title: actionTitles[state] };
  if (Number.isInteger(tabId)) {
    iconDetails.tabId = tabId;
    titleDetails.tabId = tabId;
  }
  const updates = [
    chrome.action.setIcon(iconDetails),
    chrome.action.setTitle(titleDetails),
  ];
  if (state !== "idle") {
    updates.push(
      chrome.action.setBadgeText({
        text: "",
        ...(Number.isInteger(tabId) ? { tabId } : {}),
      }),
    );
  }
  const [iconResult] = await Promise.allSettled(updates);
  const fallback = actionBadgeFallbacks[state];
  if (iconResult.status === "rejected" && fallback) {
    await Promise.allSettled([
      chrome.action.setBadgeText({
        text: fallback.text,
        ...(Number.isInteger(tabId) ? { tabId } : {}),
      }),
      chrome.action.setBadgeBackgroundColor({
        color: fallback.color,
        ...(Number.isInteger(tabId) ? { tabId } : {}),
      }),
    ]);
  }
}

async function submitUrlWithActionState(url, tabId) {
  await setActionIcon("saving", tabId);
  activeSubmissions += 1;
  try {
    const result = await submitUrl(url);
    await setActionIcon(result.ok ? "saved" : "failed", tabId);
    return result;
  } catch (error) {
    await setActionIcon("failed", tabId);
    throw error;
  } finally {
    activeSubmissions -= 1;
  }
}

async function ensureReloadUpdatedExtensionAlarm() {
  const existing = await chrome.alarms.get(reloadUpdatedExtensionAlarm);
  if (!existing) {
    await chrome.alarms.create(reloadUpdatedExtensionAlarm, {
      periodInMinutes: 15,
    });
  }
}

ensureReloadUpdatedExtensionAlarm();
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== reloadUpdatedExtensionAlarm || activeSubmissions > 0) {
    return;
  }
  try {
    const manifestUrl = `${chrome.runtime.getURL("manifest.json")}?update_check=${Date.now()}`;
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const installedManifest = await response.json();
    if (installedManifest.version !== chrome.runtime.getManifest().version) {
      chrome.runtime.reload();
    }
  } catch {
    // The next alarm will retry after transient filesystem or browser errors.
  }
});

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
    const result = await uploadImage(blob, filename, {
      sourceUrl: info.srcUrl,
      pageUrl: tab.url || "",
      pageTitle: tab.title || "",
      tags,
    });
    const message = result.ok
      ? result.status === "duplicate"
        ? "Already in library"
        : "Saved to library"
      : `Save failed: ${result.error}`;
    showNotification(message);
  } catch (error) {
    showNotification(`Save failed: ${error.message}`);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "submit-url") {
    submitUrlWithActionState(message.url, message.tabId ?? sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "auto-save-candidate") {
    const candidate = findDownloadableVideo(
      message.pageUrl,
      message.videoSources,
    );
    autoSaveCandidate(candidate, null, sender.tab?.id);
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

  await setActionIcon("idle", tabId);
  const config = await getConfig();
  const candidate = findDownloadableVideo(tab.url);
  const canAutoSave = shouldAutoSave(config, candidate);
  await chrome.action.setBadgeText({ text: candidate ? "●" : "", tabId });
  if (candidate) {
    await chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
  }
  if (canAutoSave) {
    await autoSaveCandidate(candidate, config, tabId);
  }
});

async function autoSaveCandidate(candidate, knownConfig = null, tabId) {
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
    const result = await submitUrlWithActionState(candidate, tabId);
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
    const result = await submitUrlWithActionState(tab.url, tab.id);
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
