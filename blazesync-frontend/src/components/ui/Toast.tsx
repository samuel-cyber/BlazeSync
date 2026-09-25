"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastItem = { id: number; tone: "success" | "danger"; text: ReactNode; leaving: boolean };
const ToastContext = createContext<(text: ReactNode, tone?: ToastItem["tone"]) => void>(() => {});

const SHOWN_FOR = 5000;
const EXIT = 180; // matches --t-ui, so the exit is seen before the toast leaves the tree

/** Confirms an action in the same words as the button that caused it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: ReactNode, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text, leaving: false }]);
    setTimeout(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x))), SHOWN_FOR);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), SHOWN_FOR + EXIT);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`toast pointer-events-auto flex max-w-md items-start gap-2.5 rounded-md bg-slab px-4 py-3 text-sm font-medium text-on-slab shadow-[var(--shadow-float)] ${t.leaving ? "is-leaving" : ""}`}
          >
            {t.tone === "success" ? <CheckCircle2 aria-hidden className="mt-px size-4 shrink-0 text-[#6ee7a8]" /> : <XCircle aria-hidden className="mt-px size-4 shrink-0 text-[#ff9b8a]" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
