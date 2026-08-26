const DEFAULT_CONFIG = {
  schemaVersion: 2,
  targets: [],
  activeTargetId: "",
  autoSaveEnabled: false,
  autoSaveDelaySeconds: 10,
};

const DEFAULT_TARGET = {
  id: "",
  name: "",
  metubeUrl: "",
  metubeFolder: "",
  tubeArchivistUrl: "",
  tubeArchivistApiKey: "",
  useTubeArchivistForYouTube: false,
  imageApiUrl: "",
  imageDestination: "",
  availabilityId: "",
};

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanId(value, fallback = "archive") {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function titleFromId(value) {
  return String(value || "archive")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function withPort(baseUrl, port) {
  const base = cleanUrl(baseUrl);
  return base && port ? `${base}:${port}` : base;
}

export function normalizeTarget(target = {}, index = 0) {
  const id = cleanId(target.id, `archive-${index + 1}`);
  return {
    ...DEFAULT_TARGET,
    ...target,
    id,
    name: String(target.name || titleFromId(id)).trim(),
    metubeUrl: cleanUrl(target.metubeUrl),
    metubeFolder: String(target.metubeFolder || "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
    tubeArchivistUrl: cleanUrl(target.tubeArchivistUrl),
    tubeArchivistApiKey: String(target.tubeArchivistApiKey || "").trim(),
    useTubeArchivistForYouTube:
      target.useTubeArchivistForYouTube === true,
    imageApiUrl: cleanUrl(target.imageApiUrl),
    imageDestination: String(target.imageDestination || "").trim(),
    availabilityId: String(target.availabilityId || "").trim(),
  };
}

function migrateLegacyConfig(stored) {
  if (!stored.nasBaseUrl) {
    return null;
  }

  const legacyDestination = cleanId(stored.destination, "archive");
  const isLegacyPrimary = !stored.destination;
  const target = normalizeTarget({
    id: legacyDestination,
    name: titleFromId(legacyDestination),
    metubeUrl: withPort(stored.nasBaseUrl, stored.metubePort || 8081),
    metubeFolder: isLegacyPrimary ? "" : legacyDestination,
    tubeArchivistUrl: withPort(
      stored.nasBaseUrl,
      stored.tubeArchivistPort || 8000,
    ),
    tubeArchivistApiKey: stored.taApiKey || "",
    useTubeArchivistForYouTube: isLegacyPrimary,
    imageApiUrl: withPort(stored.nasBaseUrl, stored.imageApiPort || 8082),
    imageDestination: legacyDestination,
    availabilityId: isLegacyPrimary ? "" : legacyDestination,
  });

  return {
    ...DEFAULT_CONFIG,
    targets: [target],
    activeTargetId: target.id,
    autoSaveEnabled: stored.autoDetect === true,
  };
}

export function normalizeConfig(stored = {}) {
  if (!Array.isArray(stored.targets)) {
    return migrateLegacyConfig(stored) || { ...DEFAULT_CONFIG };
  }

  const targets = stored.targets.map(normalizeTarget);
  const requestedTarget = String(stored.activeTargetId || "");
  const activeTargetId = targets.some((target) => target.id === requestedTarget)
    ? requestedTarget
    : targets[0]?.id || "";
  const delay = Number(stored.autoSaveDelaySeconds);

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    schemaVersion: 2,
    targets,
    activeTargetId,
    autoSaveEnabled: stored.autoSaveEnabled === true,
    autoSaveDelaySeconds:
      Number.isFinite(delay) && delay >= 0 && delay <= 300 ? delay : 10,
  };
}

export async function getConfig() {
  const stored = await chrome.storage.local.get(null);
  const config = normalizeConfig(stored);
  if (!Array.isArray(stored.targets) && stored.nasBaseUrl) {
    await chrome.storage.local.set(config);
  }
  return config;
}

export async function saveConfig(changes) {
  const current = await getConfig();
  const config = normalizeConfig({ ...current, ...changes });
  await chrome.storage.local.set(config);
  return config;
}

export function createTarget(overrides = {}) {
  return normalizeTarget(overrides);
}

export function getActiveTarget(config) {
  return (
    config.targets?.find((target) => target.id === config.activeTargetId) || null
  );
}

export function getTargetService(url, target = {}) {
  try {
    const hostname = new URL(url).hostname;
    const isYouTube =
      hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com");
    if (
      isYouTube &&
      target.useTubeArchivistForYouTube === true &&
      target.tubeArchivistUrl
    ) {
      return "tubearchivist";
    }
  } catch {
    // Invalid URLs are handled by the caller.
  }
  return "metube";
}
