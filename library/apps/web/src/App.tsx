import { useCallback, useEffect, useState } from "react";

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

type Asset = {
  id: string;
  title: string;
  media_type: "video" | "audio" | "image";
  status: string;
  files: Array<{ id: number; relative_path: string; size: number }>;
};

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
      const result = (await response.json()) as { discovered: number };
      setScanStatus(`Scan complete: ${result.discovered} discovered`);
      await loadAssets(activeLens);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Scan request failed");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (activeLens !== "Jobs") return;
    setError(null);
    fetch(`${apiBase}/api/jobs`)
      .then((response) => {
        if (!response.ok) throw new Error(`Jobs request failed (${response.status})`);
        return response.json() as Promise<{ items: Job[] }>;
      })
      .then((payload) => setJobs(payload.items))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Jobs request failed"),
      );
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
              onClick={() => setActiveLens(lens)}
              type="button"
            >
              {lens}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="page-header">
          <h1>{activeLens}</h1>
          <button disabled={scanning} onClick={scanStorage} type="button">
            {scanning ? "Scanning…" : "Scan storage"}
          </button>
        </header>
        {scanStatus ? <p aria-live="polite" className="scan-status">{scanStatus}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {activeLens === "Inbox" || mediaTypes[activeLens] ? (
          <section aria-label={`${activeLens} catalog`} className="asset-grid">
            {assets.map((asset) => (
              <article key={asset.id}>
                <span>{asset.media_type}</span>
                <h2>{asset.title}</h2>
                <p>{asset.files[0]?.relative_path}</p>
                <a href={`${apiBase}/api/assets/${asset.id}/stream`}>Open</a>
              </article>
            ))}
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
    </div>
  );
}
