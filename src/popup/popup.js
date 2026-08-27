import {
  createTarget,
  getActiveTarget,
  getConfig,
  getTargetDashboardUrl,
  getTargetService,
  saveConfig,
} from "../config.js";
import { normalizeQueueHistory } from "../queue.js";

document.addEventListener("DOMContentLoaded", async () => {
  let config = await getConfig();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const destination = document.getElementById("destination");
  const pageStatus = document.getElementById("page-status");
  const archiveButton = document.getElementById("archive-btn");
  const manualStatus = document.getElementById("manual-status");
  const dashboardLink = document.getElementById("open-dashboard");
  const queueSummary = document.getElementById("queue-summary");
  const queueList = document.getElementById("queue-list");
  let queueRequestId = 0;

  function queueDetail(item, active) {
    if (!active) {
      return item.status === "failed" ? item.message || "Failed" : "Saved";
    }
    const label = item.status === "pending" ? "Queued" : item.status;
    return item.progress > 0 ? `${label} · ${item.progress}%` : label;
  }

  function appendQueueItem(item, active) {
    const row = document.createElement("div");
    row.className = `queue-item ${item.status}`;

    const icon = document.createElement("span");
    icon.className = "queue-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = active ? "↓" : item.status === "failed" ? "!" : "✓";

    const text = document.createElement("div");
    const title = document.createElement("span");
    title.className = "queue-title";
    title.textContent = item.title;
    title.title = item.title;
    const detail = document.createElement("span");
    detail.className = "queue-detail";
    detail.textContent = queueDetail(item, active);
    detail.title = detail.textContent;
    text.append(title, detail);
    row.append(icon, text);
    queueList.append(row);
  }

  function renderQueue(queue) {
    queueList.replaceChildren();
    const total = queue.active.length + queue.recent.length;
    queueSummary.textContent = queue.active.length
      ? `${queue.active.length} active · ${queue.recent.length} recent`
      : `${queue.recent.length} recent`;
    if (!total) {
      const empty = document.createElement("p");
      empty.className = "queue-empty";
      empty.textContent = "No downloads yet";
      queueList.append(empty);
      return;
    }
    for (const item of queue.active) appendQueueItem(item, true);
    for (const item of queue.recent) appendQueueItem(item, false);
  }

  async function refreshQueue() {
    const requestId = ++queueRequestId;
    const target = getActiveTarget(config);
    if (!target?.metubeUrl) {
      queueSummary.textContent = "Unavailable";
      queueList.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "queue-empty";
      empty.textContent = "This target has no MeTube queue";
      queueList.append(empty);
      return;
    }

    try {
      const response = await fetch(`${target.metubeUrl}/history`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const history = await response.json();
      if (requestId !== queueRequestId) return;
      renderQueue(
        normalizeQueueHistory(history, { folder: target.metubeFolder }),
      );
    } catch {
      if (requestId !== queueRequestId) return;
      queueSummary.textContent = "Offline";
      queueList.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "queue-empty";
      empty.textContent = "Queue could not be reached";
      queueList.append(empty);
    }
  }

  function renderTargetOptions() {
    destination.replaceChildren();
    if (!config.targets.length) {
      const option = document.createElement("option");
      option.textContent = "Add an archive target";
      option.value = "";
      destination.append(option);
      destination.disabled = true;
      return;
    }

    destination.disabled = false;
    for (const target of config.targets) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.name;
      destination.append(option);
    }
    destination.value = config.activeTargetId;
  }

  function setField(id, value) {
    document.getElementById(id).value = value || "";
  }

  function renderTargetEditor() {
    const target = getActiveTarget(config) || {};
    setField("target-name", target.name);
    setField("metube-url", target.metubeUrl);
    setField("metube-folder", target.metubeFolder);
    setField("ta-url", target.tubeArchivistUrl);
    setField("ta-api-key", target.tubeArchivistApiKey);
    setField("image-api-url", target.imageApiUrl);
    setField("image-destination", target.imageDestination);
    setField("availability-id", target.availabilityId);
    document.getElementById("use-ta-youtube").checked =
      target.useTubeArchivistForYouTube === true;
    document.getElementById("remove-target").disabled = !target.id;
  }

  function renderPageStatus() {
    const target = getActiveTarget(config);
    if (!target) {
      pageStatus.textContent = "Add an archive target in Settings";
      archiveButton.disabled = true;
      dashboardLink.removeAttribute("href");
      dashboardLink.setAttribute("aria-disabled", "true");
      return;
    }
    archiveButton.disabled = !tab?.url;
    const service = tab?.url ? getTargetService(tab.url, target) : "metube";
    pageStatus.textContent = `${target.name} → ${service}`;
    const dashboardUrl = getTargetDashboardUrl(tab?.url || "", target);
    if (dashboardUrl) {
      dashboardLink.href = dashboardUrl;
      dashboardLink.removeAttribute("aria-disabled");
    } else {
      dashboardLink.removeAttribute("href");
      dashboardLink.setAttribute("aria-disabled", "true");
    }
  }

  renderTargetOptions();
  renderTargetEditor();
  renderPageStatus();
  void refreshQueue();
  window.setInterval(refreshQueue, 2000);
  document.getElementById("auto-save").checked = config.autoSaveEnabled;
  document.getElementById("auto-save-delay").value =
    config.autoSaveDelaySeconds;

  destination.addEventListener("change", async () => {
    config = await saveConfig({ activeTargetId: destination.value });
    renderTargetEditor();
    renderPageStatus();
    await refreshQueue();
  });

  archiveButton.addEventListener("click", async () => {
    archiveButton.disabled = true;
    archiveButton.textContent = "Submitting…";
    try {
      const result = await chrome.runtime.sendMessage({
        type: "submit-url",
        url: tab.url,
        tabId: tab?.id,
      });
      archiveButton.textContent = result.ok ? "Submitted!" : "Failed";
      if (!result.ok) {
        pageStatus.textContent = result.error;
      }
      await refreshQueue();
    } catch (error) {
      archiveButton.textContent = "Error";
      pageStatus.textContent = error.message;
    }
  });

  document.getElementById("manual-submit").addEventListener("click", async () => {
    const input = document.getElementById("manual-url");
    const url = input.value.trim();
    if (!url) {
      manualStatus.textContent = "Enter a URL to archive.";
      return;
    }
    manualStatus.textContent = "Submitting…";
    try {
      const result = await chrome.runtime.sendMessage({
        type: "submit-url",
        url,
        tabId: tab?.id,
      });
      manualStatus.textContent = result.ok
        ? "Submitted!"
        : `Failed: ${result.error}`;
      await refreshQueue();
    } catch (error) {
      manualStatus.textContent = `Error: ${error.message}`;
    }
  });

  document.getElementById("add-target").addEventListener("click", async () => {
    const id = crypto.randomUUID();
    const target = createTarget({ id, name: "New archive target" });
    config = await saveConfig({
      targets: [...config.targets, target],
      activeTargetId: id,
    });
    renderTargetOptions();
    renderTargetEditor();
    renderPageStatus();
    await refreshQueue();
  });

  document.getElementById("remove-target").addEventListener("click", async () => {
    const active = getActiveTarget(config);
    if (
      !active ||
      !window.confirm(`Remove "${active.name}"? This cannot be undone.`)
    ) {
      return;
    }
    const targets = config.targets.filter(
      (target) => target.id !== config.activeTargetId,
    );
    config = await saveConfig({
      targets,
      activeTargetId: targets[0]?.id || "",
    });
    renderTargetOptions();
    renderTargetEditor();
    renderPageStatus();
    await refreshQueue();
  });

  document.getElementById("save-settings").addEventListener("click", async () => {
    const active = getActiveTarget(config);
    const targets = active
      ? config.targets.map((target) =>
          target.id === active.id
            ? createTarget({
                ...target,
                name: document.getElementById("target-name").value,
                metubeUrl: document.getElementById("metube-url").value,
                metubeFolder: document.getElementById("metube-folder").value,
                tubeArchivistUrl: document.getElementById("ta-url").value,
                tubeArchivistApiKey:
                  document.getElementById("ta-api-key").value,
                useTubeArchivistForYouTube:
                  document.getElementById("use-ta-youtube").checked,
                imageApiUrl:
                  document.getElementById("image-api-url").value,
                imageDestination:
                  document.getElementById("image-destination").value,
                availabilityId:
                  document.getElementById("availability-id").value,
              })
            : target,
        )
      : config.targets;

    config = await saveConfig({
      targets,
      autoSaveEnabled: document.getElementById("auto-save").checked,
      autoSaveDelaySeconds: Number(
        document.getElementById("auto-save-delay").value,
      ),
    });
    renderTargetOptions();
    renderTargetEditor();
    renderPageStatus();
    await refreshQueue();
    document.getElementById("settings-status").textContent = "Saved!";
  });
});
