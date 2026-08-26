import { getCookiesForDomain } from "./cookies.js";
import { getActiveTarget, getConfig, getTargetService } from "./config.js";

export function buildTubeArchivistPayload(url) {
  return {
    data: [{ youtube_id: url, status: "pending" }],
  };
}

export function buildMetubePayload(url, target = {}) {
  const payload = {
    url: canonicalizeUrl(url),
    quality: "best",
  };
  if (target.metubeFolder) {
    payload.folder = target.metubeFolder;
  }
  return payload;
}

export async function checkTargetAvailability(target) {
  if (!target.availabilityId) {
    return true;
  }
  if (!target.imageApiUrl) {
    return false;
  }

  try {
    const response = await fetch(`${target.imageApiUrl}/destinations`);
    if (!response.ok) {
      return false;
    }
    const body = await response.json();
    return (
      body.destinations?.some(
        (item) =>
          item.id === target.availabilityId && item.available === true,
      ) ?? false
    );
  } catch {
    return false;
  }
}

function canonicalizeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const shortTwitchClip =
      host === "clips.twitch.tv"
        ? parsed.pathname.match(/^\/([^/]+)/)?.[1]
        : null;
    const redirectedTwitchClip =
      host === "twitch.tv" || host.endsWith(".twitch.tv")
        ? parsed.pathname.match(/^\/[^/]+\/clip\/([^/]+)/)?.[1]
        : null;
    const twitchClip = shortTwitchClip || redirectedTwitchClip;

    if (twitchClip) {
      parsed.hostname = "clips.twitch.tv";
      parsed.pathname = `/${twitchClip}`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }

    const trackingParameters = new Set([
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid",
      "si",
    ]);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || trackingParameters.has(key)) {
        parsed.searchParams.delete(key);
      }
    }
    if (
      parsed.hostname.endsWith("twitch.tv") &&
      parsed.pathname.includes("/videos/")
    ) {
      parsed.searchParams.delete("filter");
      parsed.searchParams.delete("range");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function submitUrl(url) {
  const config = await getConfig();
  const target = getActiveTarget(config);
  if (!target) {
    return { ok: false, error: "No archive target configured" };
  }
  if (!(await checkTargetAvailability(target))) {
    return { ok: false, error: `${target.name} is unavailable` };
  }

  const service = getTargetService(url, target);
  const domain = new URL(url).hostname.replace(/^www\./, "");
  const cookieString = await getCookiesForDomain(domain);

  if (service === "tubearchivist") {
    if (!target.tubeArchivistApiKey) {
      return { ok: false, error: "No TubeArchivist API key configured" };
    }

    const cookieResponse = await fetch(
      `${target.tubeArchivistUrl}/api/appsettings/cookie/`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${target.tubeArchivistApiKey}`,
        },
        body: JSON.stringify({ cookie: cookieString }),
      },
    );
    if (!cookieResponse.ok) {
      const text = await cookieResponse.text().catch(() => "");
      return {
        ok: false,
        error: `Cookie upload ${cookieResponse.status}: ${text}`,
      };
    }

    const response = await fetch(
      `${target.tubeArchivistUrl}/api/download/?autostart=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${target.tubeArchivistApiKey}`,
        },
        body: JSON.stringify(buildTubeArchivistPayload(url)),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Download API ${response.status}: ${text}`,
      };
    }
    return { ok: true };
  }

  if (!target.metubeUrl) {
    return { ok: false, error: `No MeTube URL configured for ${target.name}` };
  }

  const historyResponse = await fetch(`${target.metubeUrl}/history`).catch(
    () => null,
  );
  if (historyResponse?.ok) {
    const history = await historyResponse.json();
    if (isDuplicateDownload(history, url, target.metubeFolder)) {
      return { ok: true, skipped: true };
    }
  }

  const cookieBlob = new Blob([cookieString], { type: "text/plain" });
  const cookieForm = new FormData();
  cookieForm.append("cookies", cookieBlob, "cookies.txt");
  await fetch(`${target.metubeUrl}/upload-cookies`, {
    method: "POST",
    body: cookieForm,
  });

  const response = await fetch(`${target.metubeUrl}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMetubePayload(url, target)),
  });
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: `MeTube ${response.status}: ${text}` };
  }
  if (body?.status === "error") {
    return { ok: false, error: `MeTube: ${body.msg || "Download failed"}` };
  }
  return { ok: true };
}

export async function uploadImage(imageBlob, filename, metadata) {
  const config = await getConfig();
  const target = getActiveTarget(config);
  if (!target?.imageApiUrl || !(await checkTargetAvailability(target))) {
    return false;
  }

  const form = new FormData();
  form.append("image", imageBlob, filename);
  form.append("source_url", metadata.sourceUrl || "");
  form.append("page_title", metadata.pageTitle || "");
  if (target.imageDestination) {
    form.append("destination", target.imageDestination);
  }
  if (metadata.tags) {
    form.append("tags", metadata.tags);
  }

  const response = await fetch(`${target.imageApiUrl}/upload`, {
    method: "POST",
    body: form,
  });
  return response.ok;
}

export function isDuplicateDownload(history, url, folder = "") {
  const cleanUrl = canonicalizeUrl(url);
  const allItems = [
    ...(history.done || []),
    ...(history.queue || []),
    ...(history.pending || []),
  ];
  return allItems.some(
    (item) =>
      canonicalizeUrl(item.url) === cleanUrl &&
      (item.folder || "") === (folder || ""),
  );
}
