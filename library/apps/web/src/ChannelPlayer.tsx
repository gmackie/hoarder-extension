import { useCallback, useEffect, useRef, useState } from "react";

import { type Asset } from "./AssetViewer";

type Program = {
  asset: Asset;
  stream_url: string;
  display_seconds: number | null;
};

type PlayoutSession = {
  id: string;
  channel_id: string;
  channel_name: string;
  screen_key: string;
  cycle: number;
  position_ms: number;
  paused: boolean;
  ended: boolean;
  current: Program | null;
  next: Program | null;
  last_seen_at: string;
};

type ChannelPlayerProps = {
  apiBase: string;
  channelId: string;
  screenKey: string;
};

export function ChannelPlayer({ apiBase, channelId, screenKey }: ChannelPlayerProps) {
  const [session, setSession] = useState<PlayoutSession | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  const refresh = useCallback(async (sessionId: string) => {
    const response = await fetch(`${apiBase}/api/playout-sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new Error(`Screen refresh failed (${response.status})`);
    const nextSession = await response.json() as PlayoutSession;
    setSession(nextSession);
    setPaused(nextSession.paused);
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    setError(null);
    fetch(`${apiBase}/api/curated-channels/${encodeURIComponent(channelId)}/playout-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen_key: screenKey }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Channel could not start (${response.status})`);
        return response.json() as Promise<PlayoutSession>;
      })
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setPaused(nextSession.paused);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Channel could not start");
      });
    return () => { active = false; };
  }, [apiBase, channelId, screenKey]);

  const advance = useCallback(async () => {
    if (!session?.current || advancing) return;
    setAdvancing(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/playout-sessions/${encodeURIComponent(session.id)}/advance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected_asset_id: session.current.asset.id }),
        },
      );
      if (response.status === 409) {
        await refresh(session.id);
        return;
      }
      if (!response.ok) throw new Error(`Program advance failed (${response.status})`);
      const nextSession = await response.json() as PlayoutSession;
      setSession(nextSession);
      setPaused(false);
      setShowInfo(true);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Program advance failed");
    } finally {
      setAdvancing(false);
    }
  }, [advancing, apiBase, refresh, session]);

  const persistPlaybackState = useCallback(async (
    nextPaused: boolean,
    positionMs?: number,
  ) => {
    if (!session?.current) return;
    const media = mediaRef.current;
    const resolvedPosition = positionMs ?? (
      media ? Math.max(0, Math.round(media.currentTime * 1000)) : session.position_ms
    );
    const response = await fetch(
      `${apiBase}/api/playout-sessions/${encodeURIComponent(session.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_asset_id: session.current.asset.id,
          position_ms: resolvedPosition,
          paused: nextPaused,
        }),
      },
    );
    if (response.status === 409) await refresh(session.id);
  }, [apiBase, refresh, session]);

  useEffect(() => {
    if (!started || paused || session?.current?.asset.media_type !== "image") return;
    const elapsed = Math.min(
      session.position_ms,
      (session.current.display_seconds ?? 15) * 1000,
    );
    const timeout = window.setTimeout(
      () => void advance(),
      (session.current.display_seconds ?? 15) * 1000 - elapsed,
    );
    return () => window.clearTimeout(timeout);
  }, [advance, paused, session, started]);

  useEffect(() => {
    if (!started || !session?.current) return;
    const heartbeat = window.setInterval(() => {
      void persistPlaybackState(paused);
    }, 10_000);
    return () => window.clearInterval(heartbeat);
  }, [paused, persistPlaybackState, session, started]);

  useEffect(() => {
    if (!started || paused) return;
    void mediaRef.current?.play().catch(() => {
      setError("Playback needs another click to continue");
    });
  }, [paused, session?.current?.asset.id, started]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "i") setShowInfo((current) => !current);
      if (event.key.toLowerCase() === "m") setMuted((current) => !current);
      if (event.key.toLowerCase() === "f") void document.documentElement.requestFullscreen?.();
      if (event.key === "ArrowRight") void advance();
      if (event.key === " ") {
        event.preventDefault();
        setPaused((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance]);

  useEffect(() => {
    if (!started) return;
    const wakeLock = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    let sentinel: { release: () => Promise<void> } | undefined;
    void wakeLock.wakeLock?.request("screen").then((result) => { sentinel = result; }).catch(() => undefined);
    return () => { void sentinel?.release(); };
  }, [started]);

  function start() {
    if (!session) return;
    setStarted(true);
    setPaused(false);
    setError(null);
    void persistPlaybackState(false, session.position_ms);
  }

  function togglePause() {
    const media = mediaRef.current;
    setPaused((current) => {
      const nextPaused = !current;
      if (nextPaused) media?.pause();
      else void media?.play();
      void persistPlaybackState(nextPaused);
      return nextPaused;
    });
  }

  if (error && !session) {
    return (
      <main className="channel-player channel-player-error">
        <p role="alert">{error}</p>
        <a href="/">Back to library</a>
      </main>
    );
  }
  if (!session) return <main className="channel-player"><p>Preparing channel…</p></main>;
  if (!session.current) {
    return (
      <main className="channel-player channel-player-ended">
        <span>{session.channel_name}</span>
        <h1>Channel complete</h1>
        <a href="/">Back to library</a>
      </main>
    );
  }

  const { current } = session;
  const streamUrl = `${apiBase}${current.stream_url}`;
  return (
    <main
      aria-label={`${session.channel_name} channel player`}
      className={`channel-player${showInfo ? " show-channel-info" : ""}`}
      onMouseMove={() => setShowInfo(true)}
    >
      <div className="channel-stage">
        {current.asset.media_type === "video" ? (
          <video
            autoPlay={started}
            key={current.asset.id}
            muted={muted}
            onEnded={() => void advance()}
            onError={() => setError("This program could not be played")}
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = session.position_ms / 1000;
              if (started && !paused) void event.currentTarget.play();
            }}
            playsInline
            ref={(node) => { mediaRef.current = node; }}
            src={streamUrl}
          />
        ) : null}
        {current.asset.media_type === "audio" ? (
          <div className="channel-audio-stage">
            <span aria-hidden="true">♫</span>
            <audio
              autoPlay={started}
              key={current.asset.id}
              muted={muted}
              onEnded={() => void advance()}
              onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = session.position_ms / 1000;
              }}
              ref={(node) => { mediaRef.current = node; }}
              src={streamUrl}
            />
          </div>
        ) : null}
        {current.asset.media_type === "image" ? (
          <img alt={current.asset.title} key={current.asset.id} src={streamUrl} />
        ) : null}
      </div>
      <header className="channel-now-next">
        <div>
          <span>{session.channel_name} · {session.screen_key}</span>
          <h1>{current.asset.title}</h1>
          <p>{session.next ? `Up next: ${session.next.asset.title}` : "Last program"}</p>
        </div>
        <span className="channel-cycle">Cycle {session.cycle + 1}</span>
      </header>
      {!started ? (
        <div className="channel-start-overlay">
          <span>{session.channel_name}</span>
          <button autoFocus onClick={start} type="button">Start channel</button>
          <small>Starts with sound and keeps this screen awake.</small>
        </div>
      ) : null}
      {started ? (
        <nav aria-label="Channel controls" className="channel-controls">
          <button onClick={togglePause} type="button">{paused ? "Resume" : "Pause"}</button>
          <button disabled={advancing} onClick={() => void advance()} type="button">Skip</button>
          <button onClick={() => setMuted((currentMuted) => !currentMuted)} type="button">
            {muted ? "Unmute" : "Mute"}
          </button>
          <button onClick={() => setShowInfo((currentInfo) => !currentInfo)} type="button">Info</button>
          <button onClick={() => void document.documentElement.requestFullscreen?.()} type="button">Fullscreen</button>
          <a href="/">Library</a>
        </nav>
      ) : null}
      {error ? <p className="channel-error" role="alert">{error}</p> : null}
    </main>
  );
}
