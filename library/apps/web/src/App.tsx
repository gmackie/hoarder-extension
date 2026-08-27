import { type FormEvent, useCallback, useEffect, useState } from "react";

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

const PAGE_SIZE = 50;

export function App({ apiBase }: AppProps) {
  const [activeLens, setActiveLens] = useState<Lens>("Inbox");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const loadAssets = useCallback(
    async (lens: Lens, pageOffset: number, searchQuery: string) => {
      const mediaType = mediaTypes[lens];
      if (!mediaType && lens !== "Inbox") return;
      setError(null);
      setLoadingAssets(true);
      const parameters = new URLSearchParams();
      if (mediaType) parameters.set("media_type", mediaType);
      parameters.set("limit", String(PAGE_SIZE));
      parameters.set("offset", String(pageOffset));
      if (searchQuery) parameters.set("q", searchQuery);
      try {
        const response = await fetch(`${apiBase}/api/assets?${parameters}`);
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        const payload = (await response.json()) as { items: Asset[]; total: number };
        setAssets(payload.items);
        setTotalAssets(payload.total);
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "Catalog request failed");
      } finally {
        setLoadingAssets(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void loadAssets(activeLens, offset, query);
  }, [activeLens, loadAssets, offset, query]);

  const showsCatalog = activeLens === "Inbox" || Boolean(mediaTypes[activeLens]);
  const firstVisible = assets.length > 0 ? offset + 1 : 0;
  const lastVisible = assets.length > 0 ? offset + assets.length : 0;
  const oldestOffset = totalAssets > 0
    ? Math.floor((totalAssets - 1) / PAGE_SIZE) * PAGE_SIZE
    : 0;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setQuery(searchDraft.trim());
  }

  function clearSearch() {
    setSearchDraft("");
    setOffset(0);
    setQuery("");
  }

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
                setOffset(0);
                setSearchDraft("");
                setQuery("");
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
        {showsCatalog ? (
          <>
            <div className="catalog-toolbar">
              <form aria-label="Search media" onSubmit={submitSearch} role="search">
                <input
                  aria-label="Search library"
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={`Search ${activeLens.toLowerCase()}…`}
                  type="search"
                  value={searchDraft}
                />
                <button type="submit">Search</button>
                {query || searchDraft ? (
                  <button className="secondary-action" onClick={clearSearch} type="button">
                    Clear
                  </button>
                ) : null}
              </form>
              <nav aria-label="Catalog pages" className="catalog-pagination">
                <span aria-live="polite">
                  {loadingAssets ? "Loading…" : `${firstVisible}–${lastVisible} of ${totalAssets}`}
                </span>
                <button disabled={offset === 0} onClick={() => setOffset(0)} type="button">
                  Newest
                </button>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  type="button"
                >
                  Newer
                </button>
                <button
                  disabled={offset + assets.length >= totalAssets}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  type="button"
                >
                  Older
                </button>
                <button
                  disabled={offset >= oldestOffset}
                  onClick={() => setOffset(oldestOffset)}
                  type="button"
                >
                  Oldest
                </button>
              </nav>
            </div>
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
                <strong>{loadingAssets ? "Loading media…" : "No media found"}</strong>
                <span>
                  {query
                    ? "Clear the search or try another title."
                    : "Scan storage or choose another library section."}
                </span>
              </div>
            ) : null}
            </section>
          </>
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
