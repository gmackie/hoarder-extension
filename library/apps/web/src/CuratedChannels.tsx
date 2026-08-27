import { type FormEvent, useCallback, useEffect, useState } from "react";

import { type Asset } from "./AssetViewer";

type CuratedChannel = {
  id: string;
  name: string;
  description: string;
  item_count: number;
};

type CuratedItem = {
  asset_id: string;
  position: number;
  status: "candidate" | "reviewed" | "selected" | "used" | "rejected";
  asset: Asset;
};

type CuratedChannelsProps = {
  apiBase: string;
  onViewAsset: (asset: Asset) => void;
};

export function CuratedChannels({ apiBase, onViewAsset }: CuratedChannelsProps) {
  const [channels, setChannels] = useState<CuratedChannel[]>([]);
  const [selected, setSelected] = useState<CuratedChannel | null>(null);
  const [items, setItems] = useState<CuratedItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/curated-channels`);
      if (!response.ok) throw new Error(`Channel request failed (${response.status})`);
      const payload = (await response.json()) as { items: CuratedChannel[] };
      setChannels(payload.items);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel request failed");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const loadItems = useCallback(async (channelId: string) => {
    const response = await fetch(
      `${apiBase}/api/curated-channels/${encodeURIComponent(channelId)}/items`,
    );
    if (!response.ok) throw new Error(`Channel items failed (${response.status})`);
    const payload = (await response.json()) as { items: CuratedItem[] };
    setItems(payload.items);
  }, [apiBase]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBase}/api/curated-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!response.ok) throw new Error(`Channel creation failed (${response.status})`);
      const created = (await response.json()) as CuratedChannel;
      setChannels((current) => [...current, created].sort((a, b) => (
        a.name.localeCompare(b.name)
      )));
      setName("");
      setDescription("");
      setMessage(`${created.name} created`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel creation failed");
    } finally {
      setSaving(false);
    }
  }

  async function openChannel(channel: CuratedChannel) {
    setSelected(channel);
    setEditingName(channel.name);
    setEditingDescription(channel.description);
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await loadItems(channel.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel items failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !editingName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editingName.trim(),
            description: editingDescription.trim(),
          }),
        },
      );
      if (!response.ok) throw new Error(`Channel save failed (${response.status})`);
      const updated = (await response.json()) as CuratedChannel;
      setSelected(updated);
      setChannels((current) => current.map((channel) => (
        channel.id === updated.id ? updated : channel
      )));
      setMessage("Channel details saved");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel save failed");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(assetId: string, updates: Record<string, string | number>) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(selected.id)}/items/${encodeURIComponent(assetId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
      );
      if (!response.ok) throw new Error(`Channel item save failed (${response.status})`);
      await loadItems(selected.id);
      setMessage("position" in updates ? "Order saved" : "Item status saved");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel item save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(assetId: string) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(selected.id)}/items/${encodeURIComponent(assetId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`Remove failed (${response.status})`);
      await loadItems(selected.id);
      setMessage("Item removed");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Remove failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(selected.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`Channel deletion failed (${response.status})`);
      setChannels((current) => current.filter((channel) => channel.id !== selected.id));
      setSelected(null);
      setItems([]);
      setMessage("Channel deleted");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel deletion failed");
    } finally {
      setSaving(false);
    }
  }

  if (selected) {
    return (
      <section aria-label={`${selected.name} channel editor`} className="curated-editor">
        <div className="curated-editor-toolbar">
          <button className="secondary-action" onClick={() => setSelected(null)} type="button">
            All curated channels
          </button>
          <span>{items.length} items</span>
        </div>
        <div className="curated-editor-layout">
          <form className="channel-details-form" onSubmit={saveChannel}>
            <h2>Channel details</h2>
            <label>
              Channel title
              <input onChange={(event) => setEditingName(event.target.value)} value={editingName} />
            </label>
            <label>
              Description
              <textarea
                onChange={(event) => setEditingDescription(event.target.value)}
                rows={4}
                value={editingDescription}
              />
            </label>
            <button className="primary-action" disabled={saving} type="submit">
              Save channel
            </button>
            <button className="danger-action" disabled={saving} onClick={deleteChannel} type="button">
              Delete channel
            </button>
          </form>
          <div className="curated-items">
            <header>
              <span>Program order</span>
              <strong>{selected.name}</strong>
            </header>
            {items.map((item, index) => (
              <article className="curated-item" key={item.asset_id}>
                <button
                  className="curated-item-preview"
                  onClick={() => onViewAsset(item.asset)}
                  type="button"
                >
                  {item.asset.thumbnail_url ? (
                    <img alt="" src={`${apiBase}${item.asset.thumbnail_url}`} />
                  ) : (
                    <span aria-hidden="true">▶</span>
                  )}
                </button>
                <div className="curated-item-copy">
                  <button onClick={() => onViewAsset(item.asset)} type="button">
                    {item.asset.title}
                  </button>
                  <span>Position {index + 1}</span>
                </div>
                <select
                  aria-label={`Status for ${item.asset.title}`}
                  disabled={saving}
                  onChange={(event) => void updateItem(item.asset_id, {
                    status: event.target.value,
                  })}
                  value={item.status}
                >
                  <option value="candidate">Candidate</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="selected">Selected</option>
                  <option value="used">Used</option>
                  <option value="rejected">Rejected</option>
                </select>
                <div className="curated-item-actions">
                  <button
                    aria-label={`Move ${item.asset.title} up`}
                    disabled={index === 0 || saving}
                    onClick={() => void updateItem(item.asset_id, { position: index - 1 })}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${item.asset.title} down`}
                    disabled={index === items.length - 1 || saving}
                    onClick={() => void updateItem(item.asset_id, { position: index + 1 })}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`Remove ${item.asset.title}`}
                    disabled={saving}
                    onClick={() => void removeItem(item.asset_id)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
            {loading ? <p>Loading channel…</p> : null}
            {!loading && items.length === 0 ? (
              <div className="empty-state compact-empty-state">
                <strong>No items yet</strong>
                <span>Open an asset and add it to this curated channel.</span>
              </div>
            ) : null}
          </div>
        </div>
        {message ? <p aria-live="polite" className="editorial-status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Curated channels" className="curated-channels">
      <form className="create-channel-form" onSubmit={createChannel}>
        <div>
          <span>New collection</span>
          <h2>Create a curated channel</h2>
        </div>
        <label>
          Channel name
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          Channel description
          <input
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>
        <button className="primary-action" disabled={saving || !name.trim()} type="submit">
          Create channel
        </button>
      </form>
      <div className="curated-channel-grid">
        {channels.map((channel) => (
          <button
            aria-label={`Open ${channel.name}`}
            className="curated-channel-card"
            key={channel.id}
            onClick={() => void openChannel(channel)}
            type="button"
          >
            <span className="curated-channel-mark" aria-hidden="true">{channel.name.slice(0, 1)}</span>
            <span>
              <strong>{channel.name}</strong>
              <small>{channel.item_count} items</small>
              <span>{channel.description || "No description yet"}</span>
            </span>
          </button>
        ))}
        {loading ? <p>Loading curated channels…</p> : null}
        {!loading && channels.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <strong>No curated channels yet</strong>
            <span>Create one here, then add assets from the viewer.</span>
          </div>
        ) : null}
      </div>
      {message ? <p aria-live="polite" className="editorial-status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
