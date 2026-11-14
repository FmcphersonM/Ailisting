import { useState, type FormEvent } from "react";
import { api } from "../api";

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(passcode);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="panel" onSubmit={submit}>
        <div className="brand">Selg</div>
        <p className="lead">Enter your passcode to open the app. You only do this once on each device.</p>
        <input
          className="text-input"
          style={{ textAlign: "center", minHeight: 56, fontSize: 20 }}
          type="password"
          autoComplete="current-password"
          aria-label="Passcode"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
        />
        {error && <div className="notice error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !passcode.trim()}>
          {busy ? "Checking…" : "Open"}
        </button>
      </form>
    </div>
  );
}
