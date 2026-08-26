export function shouldAutoSave(config, candidateUrl) {
  return Boolean(
    candidateUrl &&
      config.autoSaveEnabled === true &&
      config.activeTargetId &&
      config.targets?.some((target) => target.id === config.activeTargetId),
  );
}
