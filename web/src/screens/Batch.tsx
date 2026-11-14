import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type Batch, type Item, type ItemEdit } from "../api";
import { useMe } from "../App";
import { ItemCard, type ItemActions } from "../components/ItemCard";
import { Icon, Sheet, Spinner, TopBar, useToast } from "../components/ui";
import { fee } from "../lib/format";
import { useUploads } from "../lib/uploads";

function isWorking(batch: Batch): boolean {
  return batch.status === "analyzing" || batch.items.some((i) => i.aiState === "pending" || i.aiState === "working");
}

/**
 * Loads one batch and keeps it fresh while the server is still working on it.
 * A reply that was requested before one of your own changes is ignored, so a
 * slow refresh can never undo what you just did.
 */
function useBatch(id: string) {
  const toast = useToast();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changes = useRef(0);

  const load = useCallback(async () => {
    const seen = changes.current;
    try {
      const fresh = await api.batch(id);
      if (seen === changes.current) setBatch(fresh);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }, [id]);

  useEffect(() => {
    setBatch(null);
    void load();
  }, [load]);

  const working = batch ? isWorking(batch) : false;
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [working, load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** Make a change: show it at once, send it, then reload the truth. */
  const change = useCallback(
    async (send: () => Promise<unknown>, showNow?: (batch: Batch) => Batch) => {
      changes.current++;
      if (showNow) setBatch((current) => (current ? showNow(current) : current));
      try {
        await send();
      } catch (err) {
        toast(err instanceof Error ? err.message : "That did not work. Try again.");
      } finally {
        changes.current++;
        await load();
      }
    },
    [load, toast],
  );

  return { batch, setBatch, error, load, change };
}

export function BatchScreen() {
  const { id = "" } = useParams();
  const { batch, setBatch, error, load, change } = useBatch(id);
  const navigate = useNavigate();

  if (!batch) {
    return (
      <main className="screen">
        <TopBar title="" onBack={() => navigate("/")} />
        {error ? (
          <div className="stack">
            <div className="notice error">{error}</div>
            <button className="btn btn-secondary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "center", padding: 40 }}>
            <Spinner />
          </div>
        )}
      </main>
    );
  }

  if (batch.status === "uploading") {
    return <Staging batch={batch} reload={load} onStarted={setBatch} />;
  }
  return <Review batch={batch} change={change} reload={load} />;
}

// ---------------------------------------------------------------------------
// Before listings are made: check the photos, add more, then go
// ---------------------------------------------------------------------------

function Staging({ batch, reload, onStarted }: { batch: Batch; reload: () => Promise<void>; onStarted: (batch: Batch) => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [uploadState, uploads] = useUploads(batch.id, me.maxPhotosPerBatch);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    uploads.setServerCount(batch.photos.length);
  }, [uploads, batch.photos.length]);

  // When an upload finishes, fetch the list again so the count is right.
  const uploadedCount = uploadState.entries.filter((e) => e.state === "done").length;
  useEffect(() => {
    if (uploadedCount > 0) void reload();
  }, [uploadedCount, reload]);

  const onServer = new Set(batch.photos.map((p) => p.id));
  const localPreview = new Map(uploadState.entries.filter((e) => e.photoId).map((e) => [e.photoId as string, e.previewUrl]));
  const inFlight = uploadState.entries.filter((e) => !e.photoId || !onServer.has(e.photoId));
  const failed = inFlight.filter((e) => e.state === "error");
  const total = batch.photos.length;
  const busy = uploadState.busy;

  function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) uploads.addFiles(files);
  }

  async function removeServerPhoto(photoId: string) {
    try {
      await api.deletePhoto(photoId);
      const entry = uploadState.entries.find((e) => e.photoId === photoId);
      if (entry) uploads.remove(entry.key);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the photo.");
    }
    await reload();
  }

  async function start() {
    setStarting(true);
    try {
      onStarted(await api.analyze(batch.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start. Try again.");
      setStarting(false);
    }
  }

  async function cancel() {
    try {
      await api.deleteBatch(batch.id);
    } catch {
      // Nothing to clean up is fine too.
    }
    navigate("/");
  }

  const video = uploadState.pending.find((p) => p.kind === "video");
  const preparing = uploadState.pending.length;

  return (
    <main className="screen stack">
      <TopBar title="Your photos" onBack={() => navigate("/")} />

      <p className="lead">
        Each separate thing becomes its own listing. Close-ups of labels, size tags and flaws make the listings better.
      </p>

      {!me.aiReady && <div className="notice">The Anthropic API key is not set on the server yet, so listings cannot be written.</div>}

      {uploadState.problems.length > 0 && (
        <div className="notice stack" style={{ gap: 6 }}>
          {uploadState.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
          <button className="linkbtn small" onClick={() => uploads.clearProblems()}>
            OK
          </button>
        </div>
      )}

      {preparing > 0 && (
        <div className="card tight stack" style={{ gap: 8 }}>
          <div className="row">
            <Spinner />
            <div className="grow">
              <div style={{ fontWeight: 650 }}>
                {video ? "Picking the sharpest moments from your video…" : `Preparing ${preparing} photo${preparing === 1 ? "" : "s"}…`}
              </div>
              <div className="muted small">This happens on your phone, so less has to be uploaded.</div>
            </div>
          </div>
          {video && (
            <div className="progressbar">
              <div style={{ width: `${Math.round(video.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {batch.photos.some((p) => p.source === "video") && (
        <p className="muted small">
          The pictures from your video are candidates. I keep only the best few of each item and drop the rest.
        </p>
      )}

      <div className="grid">
        {batch.photos.map((photo) => (
          <div className="tile" key={photo.id}>
            <img src={localPreview.get(photo.id) ?? photo.thumbUrl} alt="" />
            <button className="remove" aria-label="Remove photo" onClick={() => void removeServerPhoto(photo.id)}>
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
        {inFlight.map((entry) => (
          <div className="tile" key={entry.key}>
            <img src={entry.previewUrl} alt="" />
            {entry.state === "uploading" && (
              <div className="veil">
                <Spinner />
              </div>
            )}
            {entry.state === "error" && (
              <button className="veil" onClick={() => uploads.retry(entry.key)}>
                Upload failed. Tap to retry.
              </button>
            )}
            {entry.state === "error" && (
              <button className="remove" aria-label="Remove photo" onClick={() => uploads.remove(entry.key)}>
                <Icon name="x" size={18} />
              </button>
            )}
          </div>
        ))}
        <button className="tile add" onClick={() => picker.current?.click()}>
          <span>
            <Icon name="plus" size={28} />
            <br />
            Add more
          </span>
        </button>
      </div>
      <input ref={picker} className="hidden-input" type="file" accept="image/*,video/*" multiple onChange={onPicked} aria-hidden="true" tabIndex={-1} />

      <button className="btn btn-quiet" onClick={() => void cancel()}>
        Cancel and remove these photos
      </button>

      <div className="bottombar">
        <div className="inner">
          <button className="btn btn-primary" disabled={busy || starting || total === 0 || !me.aiReady} onClick={() => void start()}>
            {starting ? (
              <>
                <Spinner /> Starting…
              </>
            ) : busy ? (
              <>
                <Spinner /> Uploading…
              </>
            ) : total === 0 ? (
              "Add photos to begin"
            ) : (
              `Create listings from ${total} photo${total === 1 ? "" : "s"}`
            )}
          </button>
          {failed.length > 0 && !busy && (
            <div className="small muted" style={{ textAlign: "center" }}>
              {failed.length} photo{failed.length === 1 ? "" : "s"} did not upload and will be left out.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Listings appear here one by one. Check, change, approve.
// ---------------------------------------------------------------------------

function Review({
  batch,
  change,
  reload,
}: {
  batch: Batch;
  change: (send: () => Promise<unknown>, showNow?: (batch: Batch) => Batch) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const onlyItem = params.get("item");
  const [confirmAll, setConfirmAll] = useState(false);

  const patchItem = (itemId: string, patch: Partial<Item>) => (current: Batch): Batch => ({
    ...current,
    items: current.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
  });

  const actions: ItemActions = {
    edit: (itemId, edit: ItemEdit) => void change(() => api.editItem(itemId, edit), patchItem(itemId, edit as Partial<Item>)),
    answer: (itemId, answers) =>
      void change(
        () => api.answer(itemId, answers),
        (current) => ({
          ...current,
          items: current.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  aiState: answers.some((a) => a.answer) ? "working" : i.aiState,
                  questions: i.questions.map((x) => {
                    const given = answers.find((a) => a.id === x.id);
                    return given ? { ...x, answer: given.answer, skipped: !given.answer } : x;
                  }),
                }
              : i,
          ),
        }),
      ),
    redraft: (itemId) =>
      void change(
        () => api.redraft(itemId),
        patchItem(itemId, { aiState: "pending", aiError: null, titleNo: "", descriptionNo: "", photosChanged: false }),
      ),
    remove: (itemId) =>
      void change(
        () => api.deleteItem(itemId),
        (current) => ({ ...current, items: current.items.filter((i) => i.id !== itemId) }),
      ),
    merge: (fromId, intoId) =>
      void change(
        () => api.merge(fromId, intoId),
        (current) => ({ ...current, items: current.items.filter((i) => i.id !== fromId) }),
      ),
    removePhoto: (photoId) =>
      void change(
        () => api.removeItemPhoto(photoId),
        (current) => ({
          ...current,
          items: current.items.map((i) => ({ ...i, photos: i.photos.filter((p) => p.id !== photoId) })),
        }),
      ),
    movePhoto: (photoId, to) => void change(() => api.moveItemPhoto(photoId, to)),
    useOriginalPhoto: (photoId) => void change(() => api.useOriginalPhoto(photoId)),
  };

  const items = onlyItem ? batch.items.filter((i) => i.id === onlyItem) : batch.items;
  const analysing = batch.status === "analyzing";
  const finding = analysing && batch.items.length === 0;
  const written = batch.items.filter((i) => i.aiState === "ready" || i.aiState === "failed").length;
  const approvable = batch.items.filter((i) => i.status === "draft" && i.aiState === "ready");
  const allApproved = batch.items.length > 0 && batch.items.every((i) => i.status !== "draft");
  const stillWriting = batch.items.some((i) => i.aiState === "pending" || i.aiState === "working");
  const nothingFound = batch.status === "failed" && batch.items.length === 0;

  const title = finding
    ? "Looking at your photos"
    : onlyItem
      ? "Check the listing"
      : batch.items.length === 1
        ? "1 item found"
        : `${batch.items.length} items found`;

  return (
    <main className="screen stack">
      <TopBar title={title} onBack={() => navigate("/")} />

      {finding && (
        <section className="card stack">
          <div className="row">
            <Spinner />
            <div>
              <div style={{ fontWeight: 700 }}>Working out what is in your photos…</div>
              <div className="muted small">Usually under a minute. You can leave this screen. It keeps working.</div>
            </div>
          </div>
          <div className="grid">
            {batch.photos.slice(0, 9).map((p) => (
              <div className="tile" key={p.id}>
                <img src={p.thumbUrl} alt="" />
              </div>
            ))}
          </div>
        </section>
      )}

      {nothingFound && (
        <section className="card stack">
          <div className="notice error">{batch.error || "Something went wrong."}</div>
          <button className="btn btn-primary" onClick={() => void change(() => api.analyze(batch.id))}>
            Try again
          </button>
          <button className="btn btn-secondary" onClick={() => void change(() => api.asOneItem(batch.id))}>
            Treat all photos as one item
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => void api.deleteBatch(batch.id).then(() => navigate("/"), () => navigate("/"))}
          >
            Remove these photos
          </button>
        </section>
      )}

      {!finding && !nothingFound && !onlyItem && stillWriting && (
        <section className="card tight stack" style={{ gap: 8 }}>
          <div className="row spread">
            <span style={{ fontWeight: 650 }}>Writing listings</span>
            <span className="muted small">
              {written} of {batch.items.length} ready
            </span>
          </div>
          <div className="progressbar">
            <div style={{ width: `${Math.round((written / Math.max(1, batch.items.length)) * 100)}%` }} />
          </div>
        </section>
      )}

      {!onlyItem &&
        batch.questions.map((question) => (
          <section className="questions stack" key={question.id}>
            <h3>I am not sure about this photo</h3>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <img src={question.thumbUrl} alt="" style={{ width: 96, height: 96, borderRadius: 14, objectFit: "cover" }} />
              <div className="q-text grow">{question.question}</div>
            </div>
            {batch.items.map((item) => (
              <button
                key={item.id}
                className="card tight itemrow"
                onClick={() => void change(() => api.answerBatchQuestion(question.id, item.id))}
              >
                {item.photos[0] && <img className="thumb" src={item.photos[0].thumbUrl} alt="" style={{ width: 52, height: 52 }} />}
                <span className="grow">
                  <span className="small muted">It belongs to</span>
                  <span className="title">{item.titleNo || item.label}</span>
                </span>
                {question.suggestedItemId === item.id && <span className="badge green">My guess</span>}
              </button>
            ))}
            <div className="row">
              <button className="btn btn-secondary btn-small grow" onClick={() => void change(() => api.answerBatchQuestion(question.id, "new"))}>
                It is a separate item
              </button>
              <button className="btn btn-quiet btn-small" onClick={() => void change(() => api.answerBatchQuestion(question.id, "ignore"))}>
                Ignore photo
              </button>
            </div>
          </section>
        ))}

      {items.map((item) => (
        <ItemCard key={item.id} item={item} others={batch.items.filter((i) => i.id !== item.id)} actions={actions} usdToNok={me.usdToNok} />
      ))}

      {onlyItem && items.length === 0 && <div className="notice">This item no longer exists.</div>}
      {onlyItem && batch.items.length > 1 && (
        <button className="btn btn-quiet" onClick={() => setParams({})}>
          Show all {batch.items.length} items from these photos
        </button>
      )}

      {!finding && batch.items.length > 0 && !onlyItem && (
        <p className="muted small" style={{ textAlign: "center" }}>
          AI cost for these {batch.items.length === 1 ? "photos" : `${batch.items.length} items`}: about {fee(batch.costUsd, me.usdToNok)}
        </p>
      )}

      {!finding && !nothingFound && batch.items.length > 0 && (
        <div className="bottombar">
          <div className="inner">
            {allApproved ? (
              <Link className="btn btn-primary" to={onlyItem ? `/i/${onlyItem}` : "/"}>
                {onlyItem ? "Post it" : "Done. Go to my items"}
              </Link>
            ) : onlyItem ? (
              <Link className="btn btn-secondary" to="/">
                Back to my items
              </Link>
            ) : (
              <button className="btn btn-primary" disabled={approvable.length === 0} onClick={() => setConfirmAll(true)}>
                {approvable.length === 0
                  ? "Writing listings…"
                  : stillWriting
                    ? `Approve the ${approvable.length} ready so far`
                    : approvable.length === 1
                      ? batch.items.length === 1
                        ? "Approve"
                        : "Approve the last one"
                      : `Approve all ${approvable.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {confirmAll && (
        <Sheet title={`Approve ${approvable.length} listing${approvable.length === 1 ? "" : "s"}?`} onClose={() => setConfirmAll(false)}>
          <p className="muted">Approved listings move to “Ready to post”. You can still change them later.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              setConfirmAll(false);
              const ids = approvable.map((i) => i.id);
              void change(
                () => Promise.all(ids.map((itemId) => api.editItem(itemId, { status: "approved" }))),
                (current) => ({
                  ...current,
                  items: current.items.map((i) => (ids.includes(i.id) ? { ...i, status: "approved" } : i)),
                }),
              );
            }}
          >
            <Icon name="check" /> Yes, approve
          </button>
          <button className="btn btn-quiet" onClick={() => setConfirmAll(false)}>
            Not yet
          </button>
        </Sheet>
      )}
    </main>
  );
}
