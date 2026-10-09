import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import "./Toast.css";

type ToastTone = "success" | "error";
type ToastEntry = { id: number; message: string; tone: ToastTone };

type ToastContextValue = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 2800;

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
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
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
