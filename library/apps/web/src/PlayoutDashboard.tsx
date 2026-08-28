import { useCallback, useEffect, useState } from "react";

type ItemStatus = "candidate" | "reviewed" | "selected" | "used" | "rejected";

type PlayoutConfiguration = {
  id: string | null;
  channel_id: string;
  enabled: boolean;
  playback_mode: "ordered" | "shuffle";
  loop: boolean;
  image_duration_seconds: number;
  item_statuses: ItemStatus[];
  eligible_item_count: number;
  updated_at: string | null;
};

type PlayoutSummary = {
  channel: {
    id: string;
    name: string;
    description: string;
    item_count: number;
  };
  configuration: PlayoutConfiguration;
  ready: boolean;
  active_screen_count: number;
  sessions: Array<{
    id: string;
    screen_key: string;
    current_asset_id: string | null;
    current_title: string | null;
    paused: boolean;
    ended: boolean;
    last_seen_at: string;
  }>;
};

const statusOptions: Array<{ value: ItemStatus; label: string }> = [
  { value: "candidate", label: "Candidate" },
  { value: "reviewed", label: "Reviewed" },
  { value: "selected", label: "Selected" },
  { value: "used", label: "Used" },
  { value: "rejected", label: "Rejected" },
];

export function PlayoutDashboard({ apiBase }: { apiBase: string }) {
  const [summaries, setSummaries] = useState<PlayoutSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlayoutConfiguration | null>(null);
  const [screenKeys, setScreenKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/playout/channels`);
      if (!response.ok) throw new Error(`Playout request failed (${response.status})`);
      const payload = await response.json() as { items: PlayoutSummary[] };
      setSummaries(payload.items);
      setScreenKeys((current) => {
        const next = { ...current };
        for (const summary of payload.items) {
          next[summary.channel.id] ??= summary.sessions[0]?.screen_key ?? "default";
        }
        return next;
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Playout request failed");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  function beginEditing(summary: PlayoutSummary) {
    setEditingId(summary.channel.id);
    setDraft({ ...summary.configuration, item_statuses: [...summary.configuration.item_statuses] });
    setMessage(null);
    setError(null);
  }

  function toggleStatus(status: ItemStatus) {
    setDraft((current) => {
      if (!current) return current;
      const contains = current.item_statuses.includes(status);
      const itemStatuses = contains
        ? current.item_statuses.filter((candidate) => candidate !== status)
        : [...current.item_statuses, status];
      return itemStatuses.length > 0 ? { ...current, item_statuses: itemStatuses } : current;
    });
  }

  async function save() {
    if (!draft || !editingId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const body = {
      enabled: draft.enabled,
      playback_mode: draft.playback_mode,
      loop: draft.loop,
      image_duration_seconds: draft.image_duration_seconds,
      item_statuses: draft.item_statuses,
    };
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(editingId)}/playout`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(`Playout save failed (${response.status})`);
      const configuration = await response.json() as PlayoutConfiguration;
      setSummaries((current) => current.map((summary) => (
        summary.channel.id === editingId
          ? {
              ...summary,
              configuration,
              ready: configuration.enabled && configuration.eligible_item_count > 0,
            }
          : summary
      )));
      setDraft(configuration);
      setMessage("Playout settings saved");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Playout save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading playout channels…</p>;

  return (
    <section aria-label="Channel playout" className="playout-dashboard">
      <div className="playout-intro">
        <div>
          <span>Household screens</span>
          <h2>Continuous channel playout</h2>
          <p>Launch a durable screen session from curated programs. Archive files stay unchanged.</p>
        </div>
        <button className="secondary-action" onClick={() => void load()} type="button">
          Refresh status
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p aria-live="polite" className="editorial-status">{message}</p> : null}
      <div className="playout-grid">
        {summaries.map((summary) => {
          const screenKey = screenKeys[summary.channel.id] ?? "default";
          const launchHref = `/?play=${encodeURIComponent(summary.channel.id)}&screen=${encodeURIComponent(screenKey)}`;
          const editing = editingId === summary.channel.id && draft !== null;
          return (
            <article className="playout-card" key={summary.channel.id}>
              <header>
                <div>
                  <span className={summary.ready ? "ready-chip" : "offline-chip"}>
                    {summary.ready ? "Ready" : "Needs setup"}
                  </span>
                  <h2>{summary.channel.name}</h2>
                  <p>{summary.channel.description || "No channel description"}</p>
                </div>
                <strong>{summary.configuration.eligible_item_count} programs ready</strong>
              </header>
              <div className="playout-facts">
                <span>{summary.active_screen_count} active screen{summary.active_screen_count === 1 ? "" : "s"}</span>
                <span>{summary.configuration.playback_mode === "shuffle" ? "Shuffled" : "In order"}</span>
                <span>{summary.configuration.loop ? "Loops continuously" : "Stops after one run"}</span>
              </div>
              <div className="playout-launch">
                <label>
                  Screen name
                  <input
                    onChange={(event) => setScreenKeys((current) => ({
                      ...current,
                      [summary.channel.id]: event.target.value,
                    }))}
                    value={screenKey}
                  />
                </label>
                <a
                  aria-disabled={!summary.ready}
                  aria-label={`Launch ${summary.channel.name}`}
                  className="primary-action"
                  href={summary.ready ? launchHref : undefined}
                  rel="noreferrer"
                  target="_blank"
                >
                  Launch channel
                </a>
                <button
                  aria-label={`Configure ${summary.channel.name}`}
                  className="secondary-action"
                  onClick={() => beginEditing(summary)}
                  type="button"
                >
                  Configure
                </button>
              </div>
              {editing && draft ? (
                <div className="playout-settings">
                  <label className="toggle-field">
                    <input
                      aria-label="Enable channel"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                      type="checkbox"
                    />
                    Enable channel
                  </label>
                  <label>
                    Playback order
                    <select
                      aria-label="Playback order"
                      onChange={(event) => setDraft({
                        ...draft,
                        playback_mode: event.target.value as "ordered" | "shuffle",
                      })}
                      value={draft.playback_mode}
                    >
                      <option value="ordered">In curated order</option>
                      <option value="shuffle">Deterministic shuffle</option>
                    </select>
                  </label>
                  <label>
                    Image duration in seconds
                    <input
                      aria-label="Image duration in seconds"
                      max={3600}
                      min={3}
                      onChange={(event) => setDraft({
                        ...draft,
                        image_duration_seconds: Number(event.target.value),
                      })}
                      type="number"
                      value={draft.image_duration_seconds}
                    />
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={draft.loop}
                      onChange={(event) => setDraft({ ...draft, loop: event.target.checked })}
                      type="checkbox"
                    />
                    Loop continuously
                  </label>
                  <fieldset>
                    <legend>Eligible program statuses</legend>
                    {statusOptions.map((option) => (
                      <label className="toggle-field" key={option.value}>
                        <input
                          checked={draft.item_statuses.includes(option.value)}
                          onChange={() => toggleStatus(option.value)}
                          type="checkbox"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <div className="playout-settings-actions">
                    <button className="primary-action" disabled={saving} onClick={() => void save()} type="button">
                      Save playout
                    </button>
                    <button className="secondary-action" onClick={() => setEditingId(null)} type="button">
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
              {summary.sessions.length > 0 ? (
                <div className="screen-list">
                  <strong>Saved screens</strong>
                  {summary.sessions.map((screen) => (
                    <div key={screen.id}>
                      <span>{screen.screen_key}</span>
                      <span>{screen.current_title ?? (screen.ended ? "Ended" : "Waiting")}</span>
                      <small>{screen.paused ? "Paused" : "Playing"}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {summaries.length === 0 ? (
        <div className="empty-state">
          <strong>No curated channels yet</strong>
          <span>Create a curated channel and add selected programs before configuring playout.</span>
        </div>
      ) : null}
    </section>
  );
}
