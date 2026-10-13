import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { DemoChapter } from "./demoChapters";
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
} from "./icons";
import "./DemoPlayer.css";

export type DemoPlayerHandle = { seekTo: (seconds: number, play?: boolean) => void };

const SKIP = 10;
const SPEEDS = [0.75, 1, 1.25, 1.5];

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// A custom control layer over a plain <video>.
//
// The browser's built-in controls can't have skip buttons, look different in
// every browser, and give a chapter list nowhere to show on the timeline. This
// keeps the native <video> for playback itself and draws its own controls:
// 10-second skip back and forward, a timeline with chapter marks and a hover
// preview, playback speed, volume, and fullscreen — plus the keyboard
// shortcuts people already know from YouTube (space/K, arrows/J/L, M, F).
export default function DemoPlayer({
  src,
  poster,
  chapters,
  onTime,
  ref,
}: {
  src: string;
  poster: string;
  chapters: DemoChapter[];
  onTime?: (seconds: number) => void;
  ref?: Ref<DemoPlayerHandle>;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Brief "−10" / "+10" badge on the side that was skipped, so a skip from the
  // keyboard is as visible as one from a button.
  const [flash, setFlash] = useState<{ side: "back" | "fwd"; key: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const v = () => videoRef.current;

  const seekTo = useCallback((seconds: number, play = false) => {
    const el = v();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
    setTime(el.currentTime);
    if (play) void el.play().catch(() => {});
  }, []);

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  const togglePlay = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const el = v();
      if (!el) return;
      seekTo(el.currentTime + delta);
      setFlash({ side: delta < 0 ? "back" : "fwd", key: Date.now() });
    },
    [seekTo],
  );

  // Controls fade out while playing and the pointer is still; any movement,
  // touch or key brings them back. Always shown while paused.
  const wake = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!v()?.paused && !scrubbing && !speedOpen) setControlsVisible(false);
    }, 2600);
  }, [scrubbing, speedOpen]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
  }, [flash]);

  const toggleFullscreen = () => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (shell.requestFullscreen) void shell.requestFullscreen();
    else {
      // iOS Safari can't fullscreen an arbitrary element, only the video.
      (v() as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
    }
  };

  const setVol = (next: number) => {
    const el = v();
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, next));
    el.muted = el.volume === 0;
  };

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
      wake();
    };
    if (k === " " || k === "k") handled(togglePlay);
    else if (k === "arrowleft" || k === "j") handled(() => skip(-SKIP));
    else if (k === "arrowright" || k === "l") handled(() => skip(SKIP));
    else if (k === "arrowup") handled(() => setVol((v()?.volume ?? 1) + 0.1));
    else if (k === "arrowdown") handled(() => setVol((v()?.volume ?? 1) - 0.1));
    else if (k === "m") handled(() => v() && (v()!.muted = !v()!.muted));
    else if (k === "f") handled(toggleFullscreen);
    else if (/^[0-9]$/.test(k)) handled(() => seekTo(((v()?.duration ?? 0) * Number(k)) / 10));
  };

  // Timeline: click or drag anywhere on it to seek. Pointer capture keeps the
  // drag working even if the pointer wanders off the thin track.
  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };

  const chapterAt = (t: number) => [...chapters].reverse().find((c) => t >= c.at);
  const current = chapterAt(time);
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={"dp" + (controlsVisible || !playing ? " dp-awake" : "") + (fullscreen ? " dp-fs" : "")}
      tabIndex={0}
      role="region"
      aria-label="Product walkthrough video. Space to play or pause, left and right arrows to skip 10 seconds."
      onKeyDown={onKey}
      onMouseMove={wake}
      onTouchStart={wake}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        className="dp-video"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={() => {
          togglePlay();
          shellRef.current?.focus();
        }}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (!scrubbing) setTime(t);
          onTime?.(t);
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted);
          setVolume(e.currentTarget.volume);
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
      />

      {!started && (
        <button
          type="button"
          className="dp-bigplay"
          aria-label="Play the walkthrough"
          onClick={() => {
            togglePlay();
            shellRef.current?.focus();
          }}
        >
          <PlayIcon size={34} />
        </button>
      )}

      {flash && (
        <div key={flash.key} className={`dp-flash dp-flash-${flash.side}`} aria-hidden="true">
          {flash.side === "back" ? <SkipBackIcon size={30} /> : <SkipForwardIcon size={30} />}
          <span>{flash.side === "back" ? "−10s" : "+10s"}</span>
        </div>
      )}

      <div className="dp-bar" onClick={(e) => e.stopPropagation()}>
        <div
          ref={trackRef}
          className={"dp-track" + (scrubbing ? " is-scrubbing" : "")}
          role="slider"
          tabIndex={-1}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmt(time)} of ${fmt(duration)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(true);
            const t = timeAt(e.clientX);
            setTime(t);
          }}
          onPointerMove={(e) => {
            const r = trackRef.current!.getBoundingClientRect();
            const t = timeAt(e.clientX);
            setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), t });
            if (scrubbing) setTime(t);
          }}
          onPointerUp={(e) => {
            if (!scrubbing) return;
            setScrubbing(false);
            seekTo(timeAt(e.clientX));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="dp-track-rail">
            <div className="dp-track-buffer" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <div className="dp-track-fill" style={{ width: `${pct}%` }} />
            {duration > 0 &&
              chapters.map((c) => (
                <span key={c.id} className="dp-track-tick" style={{ left: `${(c.at / duration) * 100}%` }} />
              ))}
          </div>
          <span className="dp-track-knob" style={{ left: `${pct}%` }} />
          {hover && duration > 0 && (
            <div className="dp-tip" style={{ left: hover.x }}>
              <span className="dp-tip-time">{fmt(hover.t)}</span>
              {chapterAt(hover.t) && <span className="dp-tip-label">{chapterAt(hover.t)!.label}</span>}
            </div>
          )}
        </div>

        <div className="dp-row">
          <button type="button" className="dp-btn" onClick={togglePlay} aria-label={playing ? "Pause (space)" : "Play (space)"} title={playing ? "Pause (space)" : "Play (space)"}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={18} />}
          </button>
          <button type="button" className="dp-btn" onClick={() => skip(-SKIP)} aria-label="Back 10 seconds" title="Back 10 seconds (←)">
            <SkipBackIcon size={22} />
          </button>
          <button type="button" className="dp-btn" onClick={() => skip(SKIP)} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)">
            <SkipForwardIcon size={22} />
          </button>

          <div className="dp-vol">
            <button
              type="button"
              className="dp-btn"
              onClick={() => v() && (v()!.muted = !v()!.muted)}
              aria-label={muted ? "Unmute (M)" : "Mute (M)"}
              title={muted ? "Unmute (M)" : "Mute (M)"}
            >
              {muted || volume === 0 ? <MuteIcon size={20} /> : <VolumeIcon size={20} />}
            </button>
            <input
              className="dp-vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>

          <span className="dp-time">
            {fmt(time)} <span className="dp-time-sep">/</span> {fmt(duration)}
          </span>
          {current && <span className="dp-chapter">{current.label}</span>}

          <span className="dp-spacer" />

          <div className="dp-speed">
            <button
              type="button"
              className="dp-btn dp-speed-btn"
              onClick={() => setSpeedOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={speedOpen}
              aria-label={`Playback speed ${speed}x`}
              title="Playback speed"
            >
              {speed}×
            </button>
            {speedOpen && (
              <div className="dp-speed-menu" role="menu">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s === speed}
                    className={"dp-speed-item" + (s === speed ? " is-on" : "")}
                    onClick={() => {
                      if (v()) v()!.playbackRate = s;
                      setSpeedOpen(false);
                    }}
                  >
                    {s === 1 ? "Normal" : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="dp-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
            title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
          >
            {fullscreen ? <ExitFullscreenIcon size={19} /> : <FullscreenIcon size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}
