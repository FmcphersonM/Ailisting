import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Text you can change by tapping it. It saves when you tap away.
 * While you are typing, updates from the server do not overwrite your text.
 */
export function EditableText({
  value,
  onSave,
  label,
  placeholder,
  className = "",
  multiline = false,
  clamp = false,
  maxLength,
}: {
  value: string;
  onSave: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  clamp?: boolean;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Grow the box to fit the text, so there is never a scrollbar inside it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draft]);

  useEffect(() => {
    const el = area.current;
    if (editing && el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  function finish() {
    setEditing(false);
    const cleaned = multiline ? draft.replace(/\s+$/g, "") : draft.replace(/\s+/g, " ").trim();
    if (cleaned !== value) onSave(cleaned);
  }

  if (editing) {
    return (
      <textarea
        ref={area}
        className={`edit-input ${className}`}
        aria-label={label}
        rows={1}
        value={draft}
        maxLength={maxLength}
        enterKeyHint={multiline ? "enter" : "done"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  const isLong = clamp && (value.length > 260 || value.split("\n").length > 6);
  return (
    <>
      <button
        type="button"
        className={`editable ${className}${value ? "" : " empty"}${isLong && !expanded ? " clamp" : ""}`}
        aria-label={`${label}. Tap to edit.`}
        onClick={() => setEditing(true)}
      >
        {value || placeholder || "Tap to add"}
      </button>
      {isLong && (
        <button type="button" className="linkbtn small" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </>
  );
}

/** A price you can change by tapping it. Opens the number keyboard. */
export function EditablePrice({ value, onSave }: { value: number | null; onSave: (value: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  function finish() {
    setEditing(false);
    const digits = draft.replace(/[^\d]/g, "");
    const next = digits ? Number(digits) : null;
    if (next !== value) onSave(next);
  }

  if (editing) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <input
          ref={input}
          className="text-input price"
          style={{ width: 150, minHeight: 52 }}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Price in kroner"
          value={draft}
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="price">kr</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="price"
      style={{ borderRadius: 12, padding: "2px 8px", margin: "-2px -8px" }}
      aria-label="Price. Tap to edit."
      onClick={() => {
        setDraft(value === null ? "" : String(value));
        setEditing(true);
      }}
    >
      {value === null ? "Set a price" : `${value.toLocaleString("nb-NO")} kr`}
    </button>
  );
}
