(async () => {
  const config = await chrome.storage.local.get({
    autoSaveEnabled: false,
    autoSaveDelaySeconds: 10,
  });
  if (!config.autoSaveEnabled) {
    return;
  }

  const delay = Math.max(0, Number(config.autoSaveDelaySeconds) || 0) * 1000;
  setTimeout(() => {
    const videoSources = Array.from(
      document.querySelectorAll("video[src], video source[src]"),
    )
      .map((element) => element.currentSrc || element.src)
      .filter(Boolean);

    chrome.runtime.sendMessage({
      type: "auto-save-candidate",
      pageUrl: window.location.href,
      videoSources,
    });
  }, delay);
})();
