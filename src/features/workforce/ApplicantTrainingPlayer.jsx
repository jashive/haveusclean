import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, StatusBadge } from "../../components/ui.jsx";

function modulePercent(module, seconds) {
  if (!module.duration_seconds) return 0;
  return Math.min(100, Math.round((seconds / module.duration_seconds) * 100));
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function ProgressRing({ value, label }) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="training-progress-ring" style={{ "--training-progress": `${percent * 3.6}deg` }} role="img" aria-label={`${label}: ${percent}%`}><span>{percent}%</span></div>;
}

function DirectVideo({ module, onProgress, onEnded }) {
  const lastSent = useRef(0);
  function progress(event) {
    const seconds = Math.floor(event.currentTarget.currentTime || 0);
    if (seconds - lastSent.current >= 15) {
      lastSent.current = seconds;
      onProgress(seconds);
    }
  }
  return <video
    key={module.training_media_id}
    controls
    controlsList="nodownload"
    preload="metadata"
    poster={module.poster_url || undefined}
    onTimeUpdate={progress}
    onEnded={(event) => onEnded(Math.floor(event.currentTarget.duration || module.duration_seconds))}
    className="huc-training-video"
  >
    <source src={module.playback_url} type={module.playback_type === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4"} />
    Your browser cannot play this training video.
  </video>;
}

let youtubeApiPromise;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube player controls could not be loaded."));
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

function embeddedUrl(value) {
  const url = new URL(value);
  if (url.hostname.endsWith("youtube.com") || url.hostname.endsWith("youtube-nocookie.com")) {
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("rel", "0");
    url.searchParams.set("origin", window.location.origin);
  }
  return url.toString();
}

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.endsWith("youtube.com") || hostname.endsWith("youtube-nocookie.com");
  } catch { return false; }
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.searchParams.get("v") || (parts[0] === "embed" ? parts[1] : null);
  } catch { return null; }
}

function YouTubeVideo({ module, onProgress, onEnded }) {
  const mountRef = useRef(null);
  const progressHandler = useRef(onProgress);
  const endedHandler = useRef(onEnded);
  useEffect(() => { progressHandler.current = onProgress; endedHandler.current = onEnded; }, [onProgress, onEnded]);
  useEffect(() => {
    let player;
    let progressTimer;
    let cancelled = false;
    const videoId = youtubeVideoId(module.playback_url);
    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current || !videoId) return;
      player = new YT.Player(mountRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
        events: { onStateChange(event) {
          clearInterval(progressTimer);
          if (event.data === YT.PlayerState.PLAYING) {
            progressTimer = setInterval(() => progressHandler.current(Math.floor(player.getCurrentTime() || 0)), 15000);
          }
          if (event.data === YT.PlayerState.ENDED) {
            const seconds = Math.max(Math.floor(player.getDuration() || 0), module.duration_seconds);
            progressHandler.current(seconds);
            endedHandler.current(seconds);
          }
        } },
      });
    }).catch(() => {});
    return () => { cancelled = true; clearInterval(progressTimer); player?.destroy?.(); };
  }, [module.training_media_id, module.playback_url, module.duration_seconds]);
  return <div ref={mountRef} className="huc-training-video" aria-label={module.title} />;
}

function EmbeddedVideo({ module, onProgress, onEnded }) {
  useEffect(() => {
    if (isYouTubeUrl(module.playback_url)) return undefined;
    const origin = new URL(module.playback_url).origin;
    function receive(event) {
      if (event.origin !== origin || event.data?.hucTrainingMediaId !== module.training_media_id) return;
      const seconds = Math.max(0, Math.floor(Number(event.data.currentTime) || 0));
      if (event.data.event === "progress") progressHandler.current(seconds);
      if (event.data.event === "ended") endedHandler.current(Math.max(seconds, module.duration_seconds));
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [module.training_media_id, module.playback_url, module.duration_seconds, onProgress, onEnded]);
  if (isYouTubeUrl(module.playback_url)) {
    return <YouTubeVideo key={module.training_media_id} module={module} onProgress={onProgress} onEnded={onEnded} />;
  }
  return <iframe
    key={module.training_media_id}
    className="huc-training-video"
    src={embeddedUrl(module.playback_url)}
    title={module.title}
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
    sandbox="allow-scripts allow-same-origin allow-presentation"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  />;
}

export default function ApplicantTrainingPlayer({ session, request }) {
  const [catalog, setCatalog] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [watched, setWatched] = useState({});
  const [ended, setEnded] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await request({ action: "training_catalog", applicantReference: session.applicantReference, applicantAccessToken: session.applicantAccessToken });
      const modules = response.training?.modules || [];
      setCatalog(modules);
      setActiveId((current) => current || modules[0]?.training_media_id || null);
    } catch (err) { setError(err.message || "Training modules could not be loaded."); }
  }

  useEffect(() => { load(); }, []); // session is fixed for the submitted application
  const active = useMemo(() => catalog.find((item) => item.training_media_id === activeId), [catalog, activeId]);
  const completed = catalog.filter((item) => item.completion_status === "completed").length;

  async function saveProgress(module, seconds) {
    setWatched((current) => ({ ...current, [module.training_media_id]: Math.max(current[module.training_media_id] || 0, seconds) }));
    try {
      await request({
        action: "training_progress", applicantReference: session.applicantReference, applicantAccessToken: session.applicantAccessToken,
        trainingMediaId: module.training_media_id, watchedSeconds: seconds, idempotencyKey: `progress-${module.training_media_id}-${Math.floor(seconds / 15)}`,
      });
    } catch { /* the final completion call remains authoritative and surfaces errors */ }
  }

  async function complete(module) {
    const seconds = Math.max(watched[module.training_media_id] || 0, ended[module.training_media_id] || 0);
    setSaving(module.training_media_id); setError("");
    try {
      await request({
        action: "training_complete", applicantReference: session.applicantReference, applicantAccessToken: session.applicantAccessToken,
        trainingMediaId: module.training_media_id, watchedSeconds: seconds, comprehensionConfirmed: confirmed[module.training_media_id] === true,
        comprehensionVersion: module.comprehension_version, idempotencyKey: `complete-${module.training_media_id}-${module.media_version}`,
      });
      await load();
      const next = catalog.find((item) => item.training_media_id !== module.training_media_id && item.completion_status !== "completed");
      if (next) setActiveId(next.training_media_id);
    } catch (err) { setError(err.message || "Training completion could not be recorded."); }
    finally { setSaving(null); }
  }

  const overallPercent = catalog.length ? Math.round((completed / catalog.length) * 100) : 0;

  return <section className="candidate-training" aria-labelledby="training-title">
    <div className="candidate-training__heading">
      <div><p className="candidate-kicker">Step 3 · Video training player</p><h2 id="training-title">Cleaner orientation</h2><p>Watch each required module, then confirm your comprehension to record the milestone.</p></div>
      <div className="candidate-training__overall"><ProgressRing value={overallPercent} label="Overall training progress" /><strong>{completed}/{catalog.length || 4}<small>modules complete</small></strong></div>
    </div>
    {error ? <div className="huc-alert huc-alert-error" role="alert">{error}</div> : null}
    <div className="huc-training-layout">
      <aside className="training-checklist" aria-label="Training milestone checklist"><div className="training-checklist__title"><span>Required milestones</span><StatusBadge tone={completed === catalog.length && catalog.length ? "success" : "info"}>{completed === catalog.length && catalog.length ? "Complete" : "In progress"}</StatusBadge></div><ol className="huc-training-list">
        {catalog.map((module, index) => {
          const percent = modulePercent(module, watched[module.training_media_id] || module.duration_seconds * Number(module.completion_percent || 0) / 100);
          const done = module.completion_status === "completed";
          return <li key={module.module_code}>
          <button type="button" disabled={!module.playback_configured} aria-current={activeId === module.training_media_id ? "step" : undefined} onClick={() => setActiveId(module.training_media_id)}>
            <span className="training-checklist__number">{done ? "✓" : index + 1}</span>
            <span><strong>{module.title}</strong><small>{module.playback_configured ? `${formatDuration(module.duration_seconds)} · ${percent}% watched` : "Video awaiting configuration"}</small></span>
            <StatusBadge tone={done ? "success" : percent ? "info" : "neutral"}>{done ? "Complete" : percent ? "Started" : "To do"}</StatusBadge>
          </button>
        </li>;
        })}
      </ol></aside>
      <div className="huc-training-stage candidate-player-card">
        {active ? <>
          <div className="candidate-player-card__meta"><div><span>Now playing</span><h3>{active.title}</h3></div><StatusBadge tone={active.completion_status === "completed" ? "success" : "neutral"}>{formatDuration(active.duration_seconds)}</StatusBadge></div>
          <div className="candidate-player-card__frame">
          {active.playback_type === "embed"
            ? <EmbeddedVideo key={active.training_media_id} module={active} onProgress={(seconds) => saveProgress(active, seconds)} onEnded={(seconds) => { setEnded((current) => ({ ...current, [active.training_media_id]: seconds })); saveProgress(active, seconds); }} />
            : <DirectVideo key={active.training_media_id} module={active} onProgress={(seconds) => saveProgress(active, seconds)} onEnded={(seconds) => { setEnded((current) => ({ ...current, [active.training_media_id]: seconds })); saveProgress(active, seconds); }} />}
          </div>
          <div className="candidate-player-card__progress"><span style={{ width: `${modulePercent(active, watched[active.training_media_id] || active.duration_seconds * Number(active.completion_percent || 0) / 100)}%` }} /><small>Playback progress is saved securely every 15 seconds.</small></div>
          <label className="huc-training-confirm"><input type="checkbox" checked={active.completion_status === "completed" || confirmed[active.training_media_id] || false} disabled={active.completion_status === "completed" || !ended[active.training_media_id]} onChange={(event) => setConfirmed((current) => ({ ...current, [active.training_media_id]: event.target.checked }))} /> I understand this module and agree to follow the standard shown.</label>
          {!ended[active.training_media_id] && active.completion_status !== "completed" ? <p className="candidate-player-card__unlock">Finish this video to unlock the comprehension check.</p> : null}
          <Button type="button" disabled={active.completion_status === "completed" || !ended[active.training_media_id] || !confirmed[active.training_media_id] || saving === active.training_media_id} onClick={() => complete(active)}>
            {active.completion_status === "completed" ? "Module complete" : saving === active.training_media_id ? "Recording milestone…" : "Confirm module completion"}
          </Button>
        </> : <p className="huc-help">Training becomes available when governed video media is configured for the required modules.</p>}
      </div>
    </div>
  </section>;
}
