import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------- Icons (drawn inline so nothing has to be downloaded) ----------

const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  camera: (
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.2-2h6.2l1.2 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.500 19h-11A2.5 2.5 0 0 1 4 16.500z" />
      <circle cx="12" cy="12.500" r="3.4" />
    </>
  ),
  download: <path d="M12 4v11m0 0l-4.500-4.500M12 15l4.500-4.500M5 19.500h14" />,
  external: <path d="M14 5h5v5M19 5l-8 8M11 6H7.500A2.5 2.5 0 0 0 5 8.500v8A2.5 2.5 0 0 0 7.500 19h8a2.5 2.5 0 0 0 2.500-2.500V13" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" />,
  pencil: <path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 0 1 3 3L8 19z" />,
  refresh: <path d="M19 12a7 7 0 1 1-2.100-5M19 5v4h-4" />,
  merge: <path d="M7 4v5a5 5 0 0 0 5 5m5-10v5a5 5 0 0 1-5 5m0 0v6" />,
  tag: (
    <>
      <path d="M12.500 4H19a1 1 0 0 1 1 1v6.500a1.500 1.500 0 0 1-.450 1.050l-7 7a1.500 1.500 0 0 1-2.100 0l-6-6a1.500 1.500 0 0 1 0-2.100l7-7A1.500 1.500 0 0 1 12.500 4z" />
      <circle cx="16" cy="8" r="1.300" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Working" />;
}

// ---------- Toast: a short message that disappears by itself ----------

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------- Sheet: a panel that slides up from the bottom ----------

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {title && <h2>{title}</h2>}
        <div className="stack">{children}</div>
      </div>
    </div>
  );
}

// ---------- Top bar with a back button ----------

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack && (
        <button className="iconbtn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={26} />
        </button>
      )}
      <h1 className="grow">{title}</h1>
      {right}
    </div>
  );
}

// ---------- Segmented choice ----------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  big,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  big?: boolean;
  label: string;
}) {
  return (
    <div className={`segmented${big ? " big" : ""}`} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
