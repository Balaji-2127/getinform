import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertIcon, CheckCircleIcon } from "./icons";
import "./Toast.css";

type ToastTone = "success" | "error";
// `leaving` drives the exit animation. Without it a toast simply stopped
// existing mid-sentence — it animated in politely and then blinked out of
// the page, which reads as a glitch rather than as a dismissal.
type ToastEntry = { id: number; message: string; tone: ToastTone; leaving: boolean };

type ToastContextValue = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 2800;
// Exit runs faster than enter on purpose: entering, the toast is asking to
// be read, so it can take its time; leaving, it's just getting out of the
// way, and a slow exit makes the UI feel like it's lagging behind you.
const EXIT_MS = 160;

// Wraps the dashboard shell once, at the top (see Dashboard.tsx) — any
// page or modal anywhere inside it can call useToast() to show a brief
// confirmation/error without prop-drilling a callback down through every
// layer. Several actions in this app (starring an area, editing a
// shortlist, exporting a PDF) used to update silently or only on error,
// which reads as "did that actually work?" — this is the one shared
// primitive for all of them instead of each inventing its own banner.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const showToast = useCallback<ToastContextValue>((message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone, leaving: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, EXIT_MS);
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}` + (t.leaving ? " is-leaving" : "")}>
            <span className="toast-icon" aria-hidden="true">
              {t.tone === "error" ? <AlertIcon size={16} /> : <CheckCircleIcon size={16} />}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
