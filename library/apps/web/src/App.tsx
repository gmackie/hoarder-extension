import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { AssetViewer, type Asset, type EditorialState } from "./AssetViewer";
import { CuratedChannels } from "./CuratedChannels";

export type AppProps = { apiBase: string };

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
type SourceChannel = {
  id: string;
  title: string;
  video_count: number;
  audio_count: number;
  total_count: number;
  subscribers: number | null;
  thumbnail_url: string | null;
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
  const [channels, setChannels] = useState<SourceChannel[]>([]);
  const [totalChannels, setTotalChannels] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [workflowDraft, setWorkflowDraft] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [favoritesDraft, setFavoritesDraft] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [reviewQueue, setReviewQueue] = useState<Asset[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<SourceChannel | null>(null);
  const assetRequestId = useRef(0);
  const channelRequestId = useRef(0);

  const loadAssets = useCallback(
    async (
      lens: Lens,
      pageOffset: number,
      searchQuery: string,
      channelId?: string,
      favorite?: boolean,
      workflowState?: string,
      tag?: string,
    ) => {
      const requestId = ++assetRequestId.current;
      const mediaType = mediaTypes[lens];
      if (!mediaType && lens !== "Inbox") {
        setLoadingAssets(false);
        return;
      }
      setError(null);
      setLoadingAssets(true);
      const parameters = new URLSearchParams();
      if (mediaType) parameters.set("media_type", mediaType);
      parameters.set("limit", String(PAGE_SIZE));
      parameters.set("offset", String(pageOffset));
      if (searchQuery) parameters.set("q", searchQuery);
      if (favorite) parameters.set("favorite", "true");
      if (workflowState) parameters.set("workflow_state", workflowState);
      if (tag) parameters.set("tag", tag);
      try {
        const resource = channelId
          ? `/api/channels/${encodeURIComponent(channelId)}/assets`
          : "/api/assets";
        const response = await fetch(`${apiBase}${resource}?${parameters}`);
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        const payload = (await response.json()) as { items: Asset[]; total: number };
        if (requestId === assetRequestId.current) {
          setAssets(payload.items);
          setTotalAssets(payload.total);
        }
      } catch (reason: unknown) {
        if (requestId === assetRequestId.current) {
          setError(reason instanceof Error ? reason.message : "Catalog request failed");
        }
      } finally {
        if (requestId === assetRequestId.current) setLoadingAssets(false);
      }
    },
    [apiBase],
  );

  const loadChannels = useCallback(
    async (pageOffset: number, searchQuery: string) => {
      const requestId = ++channelRequestId.current;
      setError(null);
      setLoadingChannels(true);
      const parameters = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageOffset),
      });
      if (searchQuery) parameters.set("q", searchQuery);
      try {
        const response = await fetch(`${apiBase}/api/channels?${parameters}`);
        if (!response.ok) throw new Error(`Channel request failed (${response.status})`);
        const payload = (await response.json()) as {
          items: SourceChannel[];
          total: number;
        };
        if (requestId === channelRequestId.current) {
          setChannels(payload.items);
          setTotalChannels(payload.total);
        }
      } catch (reason: unknown) {
        if (requestId === channelRequestId.current) {
          setError(reason instanceof Error ? reason.message : "Channel request failed");
        }
      } finally {
        if (requestId === channelRequestId.current) setLoadingChannels(false);
      }
    },
    [apiBase],
  );

  const selectedChannelId = selectedChannel?.id;
  const selectedAssetIndex = selectedAsset
    ? reviewQueue.findIndex((asset) => asset.id === selectedAsset.id)
    : -1;

  function applySavedEditorial(saved: EditorialState) {
    const updateAsset = (asset: Asset) => (
      asset.id === saved.asset_id ? { ...asset, editorial: saved } : asset
    );
    setAssets((current) => current.map(updateAsset));
    setReviewQueue((current) => current.map(updateAsset));
    setSelectedAsset((current) => (current ? updateAsset(current) : null));
  }

  useEffect(() => {
    void loadAssets(
      activeLens,
      offset,
      query,
      selectedChannelId,
      favoritesOnly,
      workflowFilter,
      tagFilter,
    );
  }, [
    activeLens,
    favoritesOnly,
    loadAssets,
    offset,
    query,
    selectedChannelId,
    tagFilter,
    workflowFilter,
  ]);

  useEffect(() => {
    if (activeLens !== "Source Channels") return;
    void loadChannels(offset, query);
  }, [activeLens, loadChannels, offset, query]);

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

  const showsCatalog = activeLens === "Inbox" || Boolean(mediaTypes[activeLens]);
  const showsChannels = activeLens === "Source Channels";
  const visibleItems = showsChannels ? channels.length : assets.length;
  const totalItems = showsChannels ? totalChannels : totalAssets;
  const loadingItems = showsChannels ? loadingChannels : loadingAssets;
  const firstVisible = visibleItems > 0 ? offset + 1 : 0;
  const lastVisible = visibleItems > 0 ? offset + visibleItems : 0;
  const lastPageOffset = totalItems > 0
    ? Math.floor((totalItems - 1) / PAGE_SIZE) * PAGE_SIZE
    : 0;

  function resetCatalogNavigation() {
    setSelectedAsset(null);
    setReviewQueue([]);
    setOffset(0);
    setSearchDraft("");
    setQuery("");
    setWorkflowDraft("");
    setWorkflowFilter("");
    setFavoritesDraft(false);
    setFavoritesOnly(false);
    setTagDraft("");
    setTagFilter("");
  }

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

  function applyEditorialFilters() {
    setOffset(0);
    setWorkflowFilter(workflowDraft);
    setFavoritesOnly(favoritesDraft);
    setTagFilter(tagDraft.trim());
  }

  function clearEditorialFilters() {
    setOffset(0);
    setWorkflowDraft("");
    setWorkflowFilter("");
    setFavoritesDraft(false);
    setFavoritesOnly(false);
    setTagDraft("");
    setTagFilter("");
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
      setSelectedChannel(null);
      setActiveLens("Jobs");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Scan request failed");
    } finally {
      setScanning(false);
    }
  }

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
                setSelectedChannel(null);
                resetCatalogNavigation();
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
            <span>{selectedChannel ? "Source channel" : "Media catalog"}</span>
            <h1>{selectedChannel?.title ?? activeLens}</h1>
          </div>
          <div className="header-actions">
            {selectedChannel ? (
              <button
                className="secondary-action"
                onClick={() => {
                  setSelectedChannel(null);
                  setActiveLens("Source Channels");
                  resetCatalogNavigation();
                }}
                type="button"
              >
                All source channels
              </button>
            ) : null}
            <button
              className="scan-button"
              disabled={scanning}
              onClick={scanStorage}
              type="button"
            >
              {scanning ? "Scanning…" : "Scan storage"}
            </button>
          </div>
        </header>
        {scanStatus ? <p aria-live="polite" className="scan-status">{scanStatus}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {showsCatalog || showsChannels ? (
          <>
            <CatalogToolbar
              activeLens={activeLens}
              applyEditorialFilters={applyEditorialFilters}
              clearEditorialFilters={clearEditorialFilters}
              firstVisible={firstVisible}
              favoritesDraft={favoritesDraft}
              lastPageOffset={lastPageOffset}
              lastVisible={lastVisible}
              loading={loadingItems}
              offset={offset}
              query={query}
              searchDraft={searchDraft}
              setFavoritesDraft={setFavoritesDraft}
              selectedChannel={selectedChannel}
              setOffset={setOffset}
              setSearchDraft={setSearchDraft}
              setTagDraft={setTagDraft}
              setWorkflowDraft={setWorkflowDraft}
              showsChannels={showsChannels}
              submitSearch={submitSearch}
              clearSearch={clearSearch}
              tagDraft={tagDraft}
              totalItems={totalItems}
              visibleItems={visibleItems}
              workflowDraft={workflowDraft}
            />
            {showsChannels ? (
              <section aria-label="Source channels" className="channel-grid">
                {channels.map((channel) => (
                  <button
                    aria-label={`Browse ${channel.title}`}
                    className="channel-card"
                    key={channel.id}
                    onClick={() => {
                      setSelectedChannel(channel);
                      setActiveLens("Videos");
                      resetCatalogNavigation();
                    }}
                    type="button"
                  >
                    <span className="channel-artwork">
                      <span aria-hidden="true">{channel.title.slice(0, 1)}</span>
                      {channel.thumbnail_url ? (
                        <img
                          alt=""
                          loading="lazy"
                          onError={(event) => { event.currentTarget.hidden = true; }}
                          src={`${apiBase}${channel.thumbnail_url}`}
                        />
                      ) : null}
                    </span>
                    <span className="channel-card-copy">
                      <strong>{channel.title}</strong>
                      <span>{channel.video_count} videos · {channel.audio_count} audio</span>
                      {channel.subscribers !== null ? (
                        <small>{formatCount(channel.subscribers)} subscribers</small>
                      ) : null}
                    </span>
                  </button>
                ))}
                {channels.length === 0 ? (
                  <CatalogEmptyState
                    loading={loadingChannels}
                    query={query}
                    subject="source channels"
                  />
                ) : null}
              </section>
            ) : (
              <section aria-label={`${activeLens} catalog`} className="asset-grid">
                {assets.map((asset) => (
                  <button
                    aria-label={`View ${asset.title}`}
                    className="asset-card"
                    key={asset.id}
                    onClick={() => {
                      setReviewQueue(assets);
                      setSelectedAsset(asset);
                    }}
                    type="button"
                  >
                    <AssetPreview apiBase={apiBase} asset={asset} />
                    <span className="asset-card-copy">
                      <strong>{asset.title}</strong>
                      <span>{asset.files[0]?.relative_path}</span>
                    </span>
                  </button>
                ))}
                {assets.length === 0 ? (
                  <CatalogEmptyState loading={loadingAssets} query={query} subject="media" />
                ) : null}
              </section>
            )}
          </>
        ) : null}
        {activeLens === "Curated Channels" ? (
          <CuratedChannels
            apiBase={apiBase}
            onViewAsset={(asset, queue) => {
              setReviewQueue(queue);
              setSelectedAsset(asset);
            }}
          />
        ) : null}
        {activeLens === "Jobs" ? (
          <section aria-label="Background jobs" className="jobs-list">
            {jobs.map((job) => (
              <article key={job.id}>
                <h2>{formatJobKind(job.kind)}</h2>
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
          canNavigateNext={selectedAssetIndex >= 0 && selectedAssetIndex < reviewQueue.length - 1}
          canNavigatePrevious={selectedAssetIndex > 0}
          onClose={() => {
            setSelectedAsset(null);
            setReviewQueue([]);
          }}
          onEditorialSaved={applySavedEditorial}
          onNavigateNext={() => {
            if (selectedAssetIndex >= 0 && selectedAssetIndex < reviewQueue.length - 1) {
              setSelectedAsset(reviewQueue[selectedAssetIndex + 1]);
            }
          }}
          onNavigatePrevious={() => {
            if (selectedAssetIndex > 0) {
              setSelectedAsset(reviewQueue[selectedAssetIndex - 1]);
            }
          }}
        />
      ) : null}
    </div>
  );
}

type CatalogToolbarProps = {
  activeLens: Lens;
  applyEditorialFilters: () => void;
  clearEditorialFilters: () => void;
  clearSearch: () => void;
  favoritesDraft: boolean;
  firstVisible: number;
  lastPageOffset: number;
  lastVisible: number;
  loading: boolean;
  offset: number;
  query: string;
  searchDraft: string;
  selectedChannel: SourceChannel | null;
  setFavoritesDraft: (value: boolean) => void;
  setOffset: (value: number) => void;
  setSearchDraft: (value: string) => void;
  setTagDraft: (value: string) => void;
  setWorkflowDraft: (value: string) => void;
  showsChannels: boolean;
  submitSearch: (event: FormEvent<HTMLFormElement>) => void;
  tagDraft: string;
  totalItems: number;
  visibleItems: number;
  workflowDraft: string;
};

function CatalogToolbar(props: CatalogToolbarProps) {
  const {
    activeLens,
    applyEditorialFilters,
    clearEditorialFilters,
    clearSearch,
    favoritesDraft,
    firstVisible,
    lastPageOffset,
    lastVisible,
    loading,
    offset,
    query,
    searchDraft,
    selectedChannel,
    setFavoritesDraft,
    setOffset,
    setSearchDraft,
    setTagDraft,
    setWorkflowDraft,
    showsChannels,
    submitSearch,
    tagDraft,
    totalItems,
    visibleItems,
    workflowDraft,
  } = props;
  return (
    <div className="catalog-toolbar">
      <div className="catalog-query-controls">
        <form
          aria-label={showsChannels ? "Search source channels" : "Search media"}
          onSubmit={submitSearch}
          role="search"
        >
          <input
            aria-label="Search library"
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={
              showsChannels
                ? "Search source channels…"
                : `Search ${selectedChannel?.title ?? activeLens.toLowerCase()}…`
            }
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
        {!showsChannels ? (
          <div className="editorial-filters">
            <label>
              <span>Workflow filter</span>
              <select
                aria-label="Workflow filter"
                onChange={(event) => setWorkflowDraft(event.target.value)}
                value={workflowDraft}
              >
                <option value="">Any workflow</option>
                <option value="inbox">Inbox</option>
                <option value="candidate">Candidate</option>
                <option value="reviewed">Reviewed</option>
                <option value="selected">Selected</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <button
              aria-pressed={favoritesDraft}
              className="filter-toggle"
              onClick={() => setFavoritesDraft(!favoritesDraft)}
              type="button"
            >
              Favorites only
            </button>
            <label>
              <span>Tag filter</span>
              <input
                aria-label="Tag filter"
                onChange={(event) => setTagDraft(event.target.value)}
                placeholder="Tag"
                value={tagDraft}
              />
            </label>
            <button onClick={applyEditorialFilters} type="button">Apply filters</button>
            <button className="secondary-action" onClick={clearEditorialFilters} type="button">
              Reset filters
            </button>
          </div>
        ) : null}
      </div>
      <nav aria-label="Catalog pages" className="catalog-pagination">
        <span aria-live="polite">
          {loading ? "Loading…" : `${firstVisible}–${lastVisible} of ${totalItems}`}
        </span>
        <button disabled={offset === 0} onClick={() => setOffset(0)} type="button">
          {showsChannels ? "First" : "Newest"}
        </button>
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          type="button"
        >
          {showsChannels ? "Previous" : "Newer"}
        </button>
        <button
          disabled={offset + visibleItems >= totalItems}
          onClick={() => setOffset(offset + PAGE_SIZE)}
          type="button"
        >
          {showsChannels ? "Next" : "Older"}
        </button>
        <button
          disabled={offset >= lastPageOffset}
          onClick={() => setOffset(lastPageOffset)}
          type="button"
        >
          {showsChannels ? "Last" : "Oldest"}
        </button>
      </nav>
    </div>
  );
}

function CatalogEmptyState({
  loading,
  query,
  subject,
}: {
  loading: boolean;
  query: string;
  subject: string;
}) {
  return (
    <div className="empty-state">
      <strong>{loading ? `Loading ${subject}…` : `No ${subject} found`}</strong>
      <span>
        {query
          ? "Clear the search or try another title."
          : "Scan storage or choose another library section."}
      </span>
    </div>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function formatJobKind(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function AssetPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [loadVideoFrame, setLoadVideoFrame] = useState(false);
  const streamUrl = `${apiBase}/api/assets/${asset.id}/stream`;

  useEffect(() => {
    if (asset.media_type !== "video" || asset.thumbnail_url) return;
    if (!("IntersectionObserver" in window)) {
      setLoadVideoFrame(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLoadVideoFrame(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [asset.media_type, asset.thumbnail_url]);

  return (
    <span className={`asset-preview asset-preview-${asset.media_type}`} ref={previewRef}>
      <span aria-hidden="true" className="media-glyph">
        {asset.media_type === "video" ? "▶" : asset.media_type === "audio" ? "♪" : ""}
      </span>
      {asset.media_type === "image" ? <img alt="" loading="lazy" src={streamUrl} /> : null}
      {asset.thumbnail_url ? (
        <img
          alt=""
          loading="lazy"
          onError={(event) => { event.currentTarget.hidden = true; }}
          src={`${apiBase}${asset.thumbnail_url}`}
        />
      ) : null}
      {asset.media_type === "video" && !asset.thumbnail_url && loadVideoFrame ? (
        <video
          aria-hidden="true"
          muted
          onError={(event) => { event.currentTarget.hidden = true; }}
          playsInline
          preload="metadata"
          src={`${streamUrl}#t=0.1`}
        />
      ) : null}
      <span className="media-type">{asset.media_type}</span>
    </span>
  );
}
