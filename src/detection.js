const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|mkv|avi|mpg|mpeg|ts)(?:$|[?#])/i;

function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isKnownVideoPage(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return parsed.pathname.length > 1;
  }
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    return (
      (parsed.pathname === "/watch" && parsed.searchParams.has("v")) ||
      /^\/(shorts|live)\/[^/]+/.test(parsed.pathname)
    );
  }
  if (host === "clips.twitch.tv") {
    return parsed.pathname.length > 1;
  }
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    return /^\/(?:[^/]+\/clip|videos)\/[^/]+/.test(parsed.pathname);
  }
  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
    return parsed.pathname.split("/").filter(Boolean).length >= 2;
  }
  return false;
}

export function findDownloadableVideo(pageUrl, videoSources = []) {
  if (!isHttpUrl(pageUrl)) {
    return null;
  }
  if (VIDEO_EXTENSIONS.test(pageUrl) || isKnownVideoPage(pageUrl)) {
    return pageUrl;
  }
  return (
    videoSources.find(
      (source) => isHttpUrl(source) && VIDEO_EXTENSIONS.test(source),
    ) || null
  );
}
