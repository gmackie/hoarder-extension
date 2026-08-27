import { useCallback, useEffect, useState } from "react";

import { AssetViewer, type Asset } from "./AssetViewer";

export type AppProps = {
  apiBase: string;
};

const lenses = [
  "Inbox",
  "Videos",
  "Music",
  "Images",
  "Source Channels",
  "Curated Channels",
  "Jobs",
] as const;

type Lens = (typeof lenses)[number];

type Job = {
  id: string;
  kind: string;
  status: string;
  result: { discovered?: number } | null;
  created_at: string;
};

const mediaTypes: Partial<Record<Lens, Asset["media_type"]>> = {
  Videos: "video",
  Music: "audio",
  Images: "image",
};

export function App({ apiBase }: AppProps) {
  const [activeLens, setActiveLens] = useState<Lens>("Inbox");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const loadAssets = useCallback(
    async (lens: Lens) => {
      const mediaType = mediaTypes[lens];
      if (!mediaType && lens !== "Inbox") return;
      setError(null);
      const path = mediaType
        ? `/api/assets?media_type=${mediaType}`
        : "/api/assets?limit=50&offset=0";
      try {
        const response = await fetch(`${apiBase}${path}`);
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        const payload = (await response.json()) as { items: Asset[] };
        setAssets(payload.items);
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "Catalog request failed");
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void loadAssets(activeLens);
  }, [activeLens, loadAssets]);

  async function scanStorage() {
    setScanning(true);
    setScanStatus(null);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/scans`, { method: "POST" });
      if (!response.ok) throw new Error(`Scan request failed (${response.status})`);
      await response.json() as { job_id: string; status: "queued" };
      setScanStatus("Scan queued — follow progress in Jobs");
      setActiveLens("Jobs");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Scan request failed");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (activeLens !== "Jobs") return;
    let active = true;
    const loadJobs = () => {
      setError(null);
      fetch(`${apiBase}/api/jobs`)
        .then((response) => {
          if (!response.ok) throw new Error(`Jobs request failed (${response.status})`);
          return response.json() as Promise<{ items: Job[] }>;
        })
        .then((payload) => {
          if (active) setJobs(payload.items);
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(reason instanceof Error ? reason.message : "Jobs request failed");
          }
        });
    };
    loadJobs();
    const refresh = window.setInterval(loadJobs, 2_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [activeLens, apiBase]);

  return (
    <div className="app-shell">
      <aside>
        <strong>Hoarder Library</strong>
        <nav aria-label="Library">
          {lenses.map((lens) => (
            <button
              aria-current={activeLens === lens ? "page" : undefined}
              key={lens}
              onClick={() => {
                setActiveLens(lens);
                setSelectedAsset(null);
              }}
              type="button"
            >
              {lens}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <span>Media catalog</span>
            <h1>{activeLens}</h1>
          </div>
          <button disabled={scanning} onClick={scanStorage} type="button">
            {scanning ? "Scanning…" : "Scan storage"}
          </button>
        </header>
        {scanStatus ? <p aria-live="polite" className="scan-status">{scanStatus}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {activeLens === "Inbox" || mediaTypes[activeLens] ? (
          <section aria-label={`${activeLens} catalog`} className="asset-grid">
            {assets.map((asset) => (
              <button
                aria-label={`View ${asset.title}`}
                className="asset-card"
                key={asset.id}
                onClick={() => setSelectedAsset(asset)}
                type="button"
              >
                <span className={`asset-preview asset-preview-${asset.media_type}`}>
                  {asset.media_type === "image" ? (
                    <img
                      alt=""
                      loading="lazy"
                      src={`${apiBase}/api/assets/${asset.id}/stream`}
                    />
                  ) : (
                    <>
                      <span aria-hidden="true" className="media-glyph">
                        {asset.media_type === "video" ? "▶" : "♪"}
                      </span>
                      {asset.thumbnail_url ? (
                        <img
                          alt=""
                          loading="lazy"
                          onError={(event) => { event.currentTarget.hidden = true; }}
                          src={`${apiBase}${asset.thumbnail_url}`}
                        />
                      ) : null}
                    </>
                  )}
                  <span className="media-type">{asset.media_type}</span>
                </span>
                <span className="asset-card-copy">
                  <strong>{asset.title}</strong>
                  <span>{asset.files[0]?.relative_path}</span>
                </span>
              </button>
            ))}
            {assets.length === 0 ? (
              <div className="empty-state">
                <strong>No media here yet</strong>
                <span>Scan storage or choose another library section.</span>
              </div>
            ) : null}
          </section>
        ) : null}
        {activeLens === "Jobs" ? (
          <section aria-label="Background jobs" className="jobs-list">
            {jobs.map((job) => (
              <article key={job.id}>
                <h2>{job.kind.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}</h2>
                <strong>{job.status}</strong>
                <p>{job.result?.discovered ?? 0} discovered</p>
              </article>
            ))}
          </section>
        ) : null}
      </main>
      {selectedAsset ? (
        <AssetViewer
          apiBase={apiBase}
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
        />
      ) : null}
    </div>
  );
}
