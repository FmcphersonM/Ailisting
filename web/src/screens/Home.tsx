import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Item, type OpenBatch } from "../api";
import { useMe } from "../App";
import { Icon, Spinner, useToast } from "../components/ui";
import { kr } from "../lib/format";
import { PLATFORMS } from "../lib/platforms";
import { uploadsFor } from "../lib/uploads";

export function HomeScreen() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [openBatches, setOpenBatches] = useState<OpenBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const home = await api.home();
      setItems(home.items);
      setOpenBatches(home.openBatches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your items.");
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  async function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so the same photos can be picked again later
    if (files.length === 0) return;
    setStarting(true);
    try {
      const { id } = await api.createBatch();
      uploadsFor(id, me.maxPhotosPerBatch).addFiles(files);
      navigate(`/b/${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start. Try again.");
      setStarting(false);
    }
  }

  const drafts = (items ?? []).filter((i) => i.status === "draft");
  const ready = (items ?? []).filter((i) => i.status !== "draft");
  const nothingYet = items !== null && items.length === 0 && openBatches.length === 0;

  return (
    <main className="screen stack" style={{ gap: 18 }}>
      <header style={{ marginTop: 8 }}>
        <div className="brand">Selg</div>
        <p className="lead">Photos in, listings out.</p>
      </header>

      <InstallTip />
      {me.demoMode && <div className="notice">Demo mode: the listings are canned text, not written by Claude.</div>}
      {!me.aiReady && (
        <div className="notice">
          The Anthropic API key is not set on the server yet, so listings cannot be written. Add <b>ANTHROPIC_API_KEY</b>{" "}
          under “Environment” on Render.
        </div>
      )}

      <input
        ref={picker}
        className="hidden-input"
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={onPicked}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button className="btn btn-primary btn-huge" disabled={starting} onClick={() => picker.current?.click()}>
        {starting ? <Spinner /> : <Icon name="camera" size={34} />}
        <span>Add photos or video</span>
        <span className="sub">One thing or a whole pile. I sort them out.</span>
      </button>

      {error && <div className="notice error">{error}</div>}
      {items === null && !error && (
        <div className="row" style={{ justifyContent: "center", padding: 20 }}>
          <Spinner />
        </div>
      )}

      {nothingYet && (
        <section className="card stack">
          <h2 style={{ fontSize: 18 }}>How it works</h2>
          <div className="steps">
            <div className="step">
              <span className="step-num">1</span>
              <div>
                <b>Take photos or a short video</b>
                <div className="muted small">Of one thing, or of everything you want to sell at once.</div>
              </div>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <div>
                <b>Check the listings</b>
                <div className="muted small">Each item gets a title, description and price estimate. Tap to change anything.</div>
              </div>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <div>
                <b>Post them</b>
                <div className="muted small">Copy the text to Finn, Tise or Facebook with one tap per field.</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {openBatches.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="Not finished">
          <h2 className="section-title">Not finished</h2>
          {openBatches.map((batch) => (
            <Link key={batch.id} to={`/b/${batch.id}`} className="card tight itemrow">
              {batch.coverThumbUrl && <img className="thumb" src={batch.coverThumbUrl} alt="" />}
              <div className="grow">
                <div className="title">
                  {batch.photoCount} photo{batch.photoCount === 1 ? "" : "s"}
                </div>
                <div className="muted small">
                  {batch.status === "analyzing"
                    ? "Working on these now…"
                    : batch.status === "failed"
                      ? "Something went wrong. Tap to try again."
                      : "Waiting. Tap to create listings."}
                </div>
              </div>
              <span className="chev">
                <Icon name="chevron" />
              </span>
            </Link>
          ))}
        </section>
      )}

      {drafts.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="To check">
          <h2 className="section-title">To check ({drafts.length})</h2>
          {drafts.map((item) => (
            <ItemRow key={item.id} item={item} to={item.batchId ? `/b/${item.batchId}?item=${item.id}` : `/i/${item.id}`} />
          ))}
        </section>
      )}

      {ready.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="Ready to post">
          <h2 className="section-title">Ready to post ({ready.length})</h2>
          {ready.map((item) => (
            <ItemRow key={item.id} item={item} to={`/i/${item.id}`} />
          ))}
        </section>
      )}
    </main>
  );
}

function ItemRow({ item, to }: { item: Item; to: string }) {
  const writing = item.aiState === "pending" || item.aiState === "working";
  const posted = PLATFORMS.filter((p) => item.postedOn.includes(p.id));
  return (
    <Link to={to} className="card tight itemrow">
      {item.photos[0] ? <img className="thumb" src={item.photos[0].thumbUrl} alt="" loading="lazy" /> : <span className="thumb" />}
      <div className="grow">
        <div className="title">{item.titleNo || item.label || "Item"}</div>
        <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          {writing ? (
            <span className="muted small">Writing the listing…</span>
          ) : item.aiState === "failed" && !item.titleNo ? (
            <span className="badge amber">Needs another try</span>
          ) : (
            <span style={{ fontWeight: 700 }}>{kr(item.priceNok)}</span>
          )}
          {posted.map((p) => (
            <span key={p.id} className="badge green">
              <Icon name="check" size={13} /> {p.name}
            </span>
          ))}
        </div>
      </div>
      <span className="chev">
        <Icon name="chevron" />
      </span>
    </Link>
  );
}

const TIP_SEEN = "selg.installTipSeen";

/** Shown once on iPhones while the app is still running inside Safari. */
function InstallTip() {
  const [show, setShow] = useState(() => {
    try {
      const onIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const installed =
        (navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      return onIphone && !installed && localStorage.getItem(TIP_SEEN) !== "1";
    } catch {
      return false;
    }
  });
  if (!show) return null;
  return (
    <div className="notice info row spread" style={{ alignItems: "flex-start" }}>
      <span>
        <b>Use it like an app:</b> tap the Share button in Safari, then “Add to Home Screen”.
      </span>
      <button
        className="iconbtn"
        style={{ margin: "-8px -8px -8px 0" }}
        aria-label="Hide this tip"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(TIP_SEEN, "1");
          } catch {
            // not important
          }
        }}
      >
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}
