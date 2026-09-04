import React, { useEffect, useMemo, useRef, useState } from "react";

function modulePercent(module, seconds) {
  if (!module.duration_seconds) return 0;
  return Math.min(100, Math.round((seconds / module.duration_seconds) * 100));
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

function EmbeddedVideo({ module, onProgress, onEnded }) {
  const frameRef = useRef(null);
  const progressHandler = useRef(onProgress);
  const endedHandler = useRef(onEnded);
  useEffect(() => { progressHandler.current = onProgress; endedHandler.current = onEnded; }, [onProgress, onEnded]);
  useEffect(() => {
    const origin = new URL(module.playback_url).origin;
    const isYouTube = origin.endsWith("youtube.com") || origin.endsWith("youtube-nocookie.com");
    let player;
    let progressTimer;
    let cancelled = false;
    if (isYouTube) {
      loadYouTubeApi().then((YT) => {
        if (cancelled || !frameRef.current) return;
        player = new YT.Player(frameRef.current, { events: { onStateChange(event) {
          clearInterval(progressTimer);
          if (event.data === YT.PlayerState.PLAYING) {
            progressTimer = setInterval(() => progressHandler.current(Math.floor(player.getCurrentTime() || 0)), 15000);
          }
          if (event.data === YT.PlayerState.ENDED) {
            const seconds = Math.max(Math.floor(player.getDuration() || 0), module.duration_seconds);
            progressHandler.current(seconds);
            endedHandler.current(seconds);
          }
        } } });
      }).catch(() => {});
      return () => { cancelled = true; clearInterval(progressTimer); player?.destroy?.(); };
    }
    function receive(event) {
      if (event.origin !== origin || event.data?.hucTrainingMediaId !== module.training_media_id) return;
      const seconds = Math.max(0, Math.floor(Number(event.data.currentTime) || 0));
      if (event.data.event === "progress") progressHandler.current(seconds);
      if (event.data.event === "ended") endedHandler.current(Math.max(seconds, module.duration_seconds));
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [module]);
  return <iframe
    ref={frameRef}
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
    } catch (err) { setError(err.message || "Training completion could not be recorded."); }
    finally { setSaving(null); }
  }

  return <section className="huc-training" aria-labelledby="training-title">
    <div className="huc-training-heading">
      <div><p className="huc-training-eyebrow">Applicant onboarding</p><h2 id="training-title">Cleaner training</h2></div>
      <strong>{completed}/{catalog.length} complete</strong>
    </div>
    <p className="huc-help">Watch every required module here, then confirm your comprehension. Training completion never bypasses screening, document review, or compliance approval.</p>
    {error ? <div className="huc-alert huc-alert-error" role="alert">{error}</div> : null}
    <div className="huc-training-layout">
      <ol className="huc-training-list">
        {catalog.map((module) => <li key={module.module_code}>
          <button type="button" disabled={!module.playback_configured} aria-current={activeId === module.training_media_id ? "step" : undefined} onClick={() => setActiveId(module.training_media_id)}>
            <span>{module.completion_status === "completed" ? "✓" : module.playback_configured ? "○" : "—"}</span>
            <span><strong>{module.title}</strong><small>{module.playback_configured ? `${modulePercent(module, watched[module.training_media_id] || module.duration_seconds * Number(module.completion_percent || 0) / 100)}% watched` : "Video awaiting configuration"}</small></span>
          </button>
        </li>)}
      </ol>
      <div className="huc-training-stage">
        {active ? <>
          {active.playback_type === "embed"
            ? <EmbeddedVideo module={active} onProgress={(seconds) => saveProgress(active, seconds)} onEnded={(seconds) => { setEnded((current) => ({ ...current, [active.training_media_id]: seconds })); saveProgress(active, seconds); }} />
            : <DirectVideo module={active} onProgress={(seconds) => saveProgress(active, seconds)} onEnded={(seconds) => { setEnded((current) => ({ ...current, [active.training_media_id]: seconds })); saveProgress(active, seconds); }} />}
          <label className="huc-training-confirm"><input type="checkbox" checked={confirmed[active.training_media_id] || false} onChange={(event) => setConfirmed((current) => ({ ...current, [active.training_media_id]: event.target.checked }))} /> I understand this module and agree to follow the standard shown.</label>
          <button type="button" className="huc-submit" disabled={active.completion_status === "completed" || !ended[active.training_media_id] || !confirmed[active.training_media_id] || saving === active.training_media_id} onClick={() => complete(active)}>
            {active.completion_status === "completed" ? "Module complete" : saving === active.training_media_id ? "Recording milestone…" : "Confirm module completion"}
          </button>
        </> : <p className="huc-help">Training becomes available when governed video media is configured for the required modules.</p>}
      </div>
    </div>
  </section>;
}
