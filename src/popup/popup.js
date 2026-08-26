import {
  createTarget,
  getActiveTarget,
  getConfig,
  getTargetService,
  saveConfig,
} from "../config.js";

document.addEventListener("DOMContentLoaded", async () => {
  let config = await getConfig();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const destination = document.getElementById("destination");
  const pageStatus = document.getElementById("page-status");
  const archiveButton = document.getElementById("archive-btn");

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
      return;
    }
    archiveButton.disabled = !tab?.url;
    const service = tab?.url ? getTargetService(tab.url, target) : "metube";
    pageStatus.textContent = `${target.name} → ${service}`;
  }

  renderTargetOptions();
  renderTargetEditor();
  renderPageStatus();
  document.getElementById("auto-save").checked = config.autoSaveEnabled;
  document.getElementById("auto-save-delay").value =
    config.autoSaveDelaySeconds;

  destination.addEventListener("change", async () => {
    config = await saveConfig({ activeTargetId: destination.value });
    renderTargetEditor();
    renderPageStatus();
  });

  archiveButton.addEventListener("click", async () => {
    archiveButton.disabled = true;
    archiveButton.textContent = "Submitting…";
    try {
      const result = await chrome.runtime.sendMessage({
        type: "submit-url",
        url: tab.url,
      });
      archiveButton.textContent = result.ok ? "Submitted!" : "Failed";
      if (!result.ok) {
        pageStatus.textContent = result.error;
      }
    } catch (error) {
      archiveButton.textContent = "Error";
      pageStatus.textContent = error.message;
    }
  });

  document.getElementById("manual-submit").addEventListener("click", async () => {
    const input = document.getElementById("manual-url");
    const url = input.value.trim();
    if (!url) {
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({
        type: "submit-url",
        url,
      });
      input.value = result.ok ? "Submitted!" : `Failed: ${result.error}`;
    } catch (error) {
      input.value = `Error: ${error.message}`;
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
  });

  document.getElementById("remove-target").addEventListener("click", async () => {
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
    document.getElementById("settings-status").textContent = "Saved!";
  });
});
