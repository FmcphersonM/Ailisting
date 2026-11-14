import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, setSignedOutHandler, type Me } from "./api";
import { Spinner } from "./components/ui";
import { BatchScreen } from "./screens/Batch";
import { HomeScreen } from "./screens/Home";
import { LoginScreen } from "./screens/Login";
import { PostScreen } from "./screens/Post";

const MeContext = createContext<Me | null>(null);

/** Settings the server shares with the app (exchange rate, limits, and so on). */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe used before the app has loaded");
  return me;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [slow, setSlow] = useState(false);

  const load = useCallback(async () => {
    // On free hosting the server sleeps when unused and needs up to a minute
    // to wake. Keep trying quietly until it answers.
    for (;;) {
      try {
        setMe(await api.me());
        return;
      } catch {
        setSlow(true);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 2500);
    void load().finally(() => window.clearTimeout(timer));
    setSignedOutHandler(() => setMe((current) => (current ? { ...current, signedIn: false } : current)));
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!me) {
    return (
      <div className="center-screen">
        <div className="panel" style={{ alignItems: "center" }}>
          <Spinner />
          {slow && (
            <>
              <div style={{ fontWeight: 700, fontSize: 19 }}>Waking up…</div>
              <p className="muted">The app sleeps when nobody uses it. This can take up to a minute.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (me.access === "not_configured") {
    return (
      <div className="center-screen">
        <div className="panel">
          <div className="brand">Selg</div>
          <div className="notice">
            The app is not set up yet: no passcode has been chosen. Add <b>APP_PASSCODE</b> under “Environment” for this
            service on Render, then reload.
          </div>
        </div>
      </div>
    );
  }

  if (!me.signedIn) return <LoginScreen onDone={load} />;

  return (
    <MeContext.Provider value={me}>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/b/:id" element={<BatchScreen />} />
        <Route path="/i/:id" element={<PostScreen />} />
        <Route path="*" element={<HomeScreen />} />
      </Routes>
    </MeContext.Provider>
  );
}
