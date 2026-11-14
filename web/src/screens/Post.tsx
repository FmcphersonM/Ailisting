import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Platform } from "../api";
import { Icon, Segmented, Spinner, TopBar, useToast } from "../components/ui";
import { copyText } from "../lib/clipboard";
import { kr } from "../lib/format";
import { fieldsFor, PLATFORMS, type CopyField } from "../lib/platforms";
import { canShareFiles, loadPhotoFiles, savePhotos } from "../lib/share";

const LAST_PLATFORM = "selg.lastPlatform";

function rememberedPlatform(): Platform {
  try {
    const saved = localStorage.getItem(LAST_PLATFORM);
    if (saved && PLATFORMS.some((p) => p.id === saved)) return saved as Platform;
  } catch {
    // Private browsing can block this; not important.
  }
  return "finn";
}

export function PostScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>(rememberedPlatform);
  const [files, setFiles] = useState<File[] | null>(null);
  const [photoError, setPhotoError] = useState(false);

  const load = useCallback(async () => {
    try {
      setItem(await api.item(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this item.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the photos ahead of time: the share menu can only be opened
  // directly from a tap, with the photos already in hand.
  const photoKey = item?.photos.map((p) => p.id).join(",") ?? "";
  useEffect(() => {
    if (!item || item.photos.length === 0) return;
    let cancelled = false;
    setFiles(null);
    setPhotoError(false);
    loadPhotoFiles(item).then(
      (loaded) => !cancelled && setFiles(loaded),
      () => !cancelled && setPhotoError(true),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);

  function choose(next: Platform) {
    setPlatform(next);
    try {
      localStorage.setItem(LAST_PLATFORM, next);
    } catch {
      // not important
    }
  }

  if (!item) {
    return (
      <main className="screen">
        <TopBar title="" onBack={() => navigate("/")} />
        {error ? (
          <div className="notice error">{error}</div>
        ) : (
          <div className="row" style={{ justifyContent: "center", padding: 40 }}>
            <Spinner />
          </div>
        )}
      </main>
    );
  }

  const info = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const fields = fieldsFor(platform, item);
  const posted = item.postedOn.includes(platform);
  const count = item.photos.length;
  const sharing = files ? canShareFiles(files) : false;

  async function onSavePhotos() {
    if (!files) return;
    const result = await savePhotos(files);
    if (result === "downloaded") toast(`${files.length} photo${files.length === 1 ? "" : "s"} downloaded`);
  }

  async function togglePosted() {
    if (!item) return;
    const next = !posted;
    setItem({ ...item, postedOn: next ? [...item.postedOn, platform] : item.postedOn.filter((p) => p !== platform) });
    try {
      setItem(await api.setPosted(item.id, platform, next));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that.");
      void load();
    }
  }

  return (
    <main className="screen stack">
      <TopBar
        title="Post it"
        onBack={() => navigate("/")}
        right={
          item.batchId ? (
            <button
              className="btn btn-secondary btn-small"
              onClick={async () => {
                try {
                  await api.editItem(item.id, { status: "draft" });
                } catch {
                  // The edit screen still opens; it just stays approved.
                }
                navigate(`/b/${item.batchId}?item=${item.id}`);
              }}
            >
              <Icon name="pencil" size={18} /> Edit
            </button>
          ) : undefined
        }
      />

      <div className="itemrow">
        {item.photos[0] && <img className="thumb" src={item.photos[0].thumbUrl} alt="" />}
        <div className="grow">
          <div className="title">{item.titleNo || item.label}</div>
          <div className="row" style={{ gap: 8, marginTop: 2 }}>
            <span style={{ fontWeight: 700 }}>{kr(item.priceNok)}</span>
            <span className="badge amber">Estimate</span>
          </div>
        </div>
      </div>

      <Segmented
        big
        label="Where to post"
        value={platform}
        onChange={choose}
        options={PLATFORMS.map((p) => ({ value: p.id, label: item.postedOn.includes(p.id) ? `${p.name} ✓` : p.name }))}
      />

      {info.automaticLater && <div className="notice info">{info.openHelp}</div>}

      {count > 0 && (
        <section className="card stepcard">
          <h2>
            <span className="step-num">1</span> Save the photos to your phone
          </h2>
          <button className="btn btn-soft" disabled={!files} onClick={() => void onSavePhotos()}>
            {files ? <Icon name="download" /> : <Spinner />}
            {files ? `Save ${count} photo${count === 1 ? "" : "s"}` : "Getting the photos ready…"}
          </button>
          <p className="muted small" style={{ marginTop: 8 }}>
            {photoError
              ? "The photos could not be loaded. Check your connection and reopen this screen."
              : sharing
                ? `In the menu that opens, choose “Save ${count === 1 ? "Image" : `${count} Images`}”. They land in your camera roll.`
                : "The photos are downloaded to this device."}
          </p>
        </section>
      )}

      <section className="card stepcard">
        <h2>
          <span className="step-num">{count > 0 ? 2 : 1}</span> Start a new ad on {info.name}
        </h2>
        <a className="btn btn-soft" href={info.openUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="external" /> {info.openLabel}
        </a>
        {!info.automaticLater && (
          <p className="muted small" style={{ marginTop: 8 }}>
            {info.openHelp}
          </p>
        )}
      </section>

      <section className="card stepcard">
        <h2>
          <span className="step-num">{count > 0 ? 3 : 2}</span> Copy each field into the ad
        </h2>
        <p className="muted small" style={{ marginBottom: 12 }}>
          {info.language === "no" ? "Norwegian text." : "English text."} Tap Copy, switch to {info.name}, and paste.
        </p>
        <div>
          {fields.map((field) => (
            <CopyRow key={`${platform}-${field.label}`} field={field} />
          ))}
        </div>
      </section>

      <section className="card tight">
        <button className={`check${posted ? " on" : ""}`} role="checkbox" aria-checked={posted} onClick={() => void togglePosted()}>
          <span className="box">
            <Icon name="check" size={20} />
          </span>
          <span>I have posted this on {info.name}</span>
        </button>
      </section>
    </main>
  );
}

function CopyRow({ field }: { field: CopyField }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(field.value);
    if (!ok) {
      toast("Could not copy. Press and hold the text to copy it instead.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="copyrow">
      <div className="grow">
        <div className="field-label">
          {field.label}
          {field.hint ? ` · ${field.hint}` : ""}
        </div>
        <div className="value">{field.value}</div>
        {field.note && <div className="muted small" style={{ marginTop: 2 }}>{field.note}</div>}
      </div>
      <button className={`copybtn${copied ? " done" : ""}`} onClick={() => void copy()} aria-label={`Copy ${field.label}`}>
        <Icon name={copied ? "check" : "copy"} size={18} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
