import { useEffect } from "react";

export type Asset = {
  id: string;
  title: string;
  media_type: "video" | "audio" | "image";
  status: string;
  files: Array<{ id: number; relative_path: string; size: number }>;
};

type AssetViewerProps = {
  apiBase: string;
  asset: Asset;
  onClose: () => void;
};

export function AssetViewer({ apiBase, asset, onClose }: AssetViewerProps) {
  const streamUrl = `${apiBase}/api/assets/${asset.id}/stream`;
  const file = asset.files[0];
  const extension = file?.relative_path.split(".").pop()?.toLowerCase();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="viewer-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="viewer-title"
        aria-modal="true"
        className="asset-viewer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="viewer-header">
          <div>
            <span>{asset.media_type}</span>
            <h2 id="viewer-title">{asset.title}</h2>
          </div>
          <button aria-label="Close viewer" className="viewer-close" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="viewer-stage">
          {asset.media_type === "video" ? (
            <video controls preload="metadata" src={streamUrl} />
          ) : null}
          {asset.media_type === "audio" ? (
            <audio controls preload="metadata" src={streamUrl} />
          ) : null}
          {asset.media_type === "image" ? (
            <img alt={asset.title} src={streamUrl} />
          ) : null}
        </div>

        <footer className="viewer-footer">
          <div>
            <strong>{file?.relative_path}</strong>
            <span>{file ? formatBytes(file.size) : "Original file"}</span>
            {asset.media_type === "video" && extension === "mkv" ? (
              <p>Brave may not play MKV directly. Download the original only when you want the file.</p>
            ) : null}
          </div>
          <a download href={streamUrl}>Download original</a>
        </footer>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
