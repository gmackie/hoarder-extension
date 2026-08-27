function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeItem(item, recent = false) {
  const numericProgress = Number(item.percent);
  const progress = Number.isFinite(numericProgress)
    ? Math.min(100, Math.max(0, Math.round(numericProgress)))
    : 0;
  const status = recent
    ? item.status === "error"
      ? "failed"
      : "saved"
    : item.status || "queued";

  return {
    id: item.id || item.url || "",
    title: item.title || item.filename || item.id || item.url || "Untitled video",
    url: item.url || "",
    status,
    progress,
    message: item.msg || item.error || "",
    timestamp: Number(item.timestamp) || 0,
  };
}

export function normalizeQueueHistory(
  history = {},
  { folder = "", recentLimit = 5 } = {},
) {
  const inFolder = (item) => (item?.folder || "") === folder;
  const active = [...asArray(history.queue), ...asArray(history.pending)]
    .filter(inFolder)
    .map((item) => normalizeItem(item));
  const recent = asArray(history.done)
    .filter(inFolder)
    .sort((left, right) => (Number(right.timestamp) || 0) - (Number(left.timestamp) || 0))
    .slice(0, recentLimit)
    .map((item) => normalizeItem(item, true));

  return { active, recent };
}
