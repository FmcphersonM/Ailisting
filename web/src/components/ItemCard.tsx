import { useState } from "react";
import { Link } from "react-router-dom";
import type { Condition, Item, ItemEdit, ItemPhoto, Question } from "../api";
import { CONDITION_LABEL, CONDITION_ORDER, fee, kr } from "../lib/format";
import { EditablePrice, EditableText } from "./Editable";
import { Icon, Segmented, Sheet, Spinner } from "./ui";

export interface ItemActions {
  edit: (itemId: string, edit: ItemEdit) => void;
  answer: (itemId: string, answers: { id: string; answer: string | null }[]) => void;
  redraft: (itemId: string) => void;
  remove: (itemId: string) => void;
  merge: (fromId: string, intoId: string) => void;
  removePhoto: (photoId: string) => void;
  movePhoto: (photoId: string, to: string) => void;
  useOriginalPhoto: (photoId: string) => void;
}

function name(item: Item): string {
  return item.titleNo || item.label || "Item";
}

export function ItemCard({
  item,
  others,
  actions,
  usdToNok,
}: {
  item: Item;
  others: Item[];
  actions: ItemActions;
  usdToNok: number;
}) {
  const [language, setLanguage] = useState<"no" | "en">("no");
  const [photo, setPhoto] = useState<ItemPhoto | null>(null);
  const [menu, setMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const hasText = Boolean(item.titleNo || item.descriptionNo);
  const writing = (item.aiState === "pending" || item.aiState === "working") && !hasText;
  const updating = (item.aiState === "pending" || item.aiState === "working") && hasText;
  const failed = item.aiState === "failed";
  const openQuestions = item.questions.filter((x) => !x.answer && !x.skipped);
  const edit = (change: ItemEdit) => actions.edit(item.id, change);

  const photos = (
    <div className="strip">
      {item.photos.map((p, index) => (
        <button key={p.id} onClick={() => setPhoto(p)} aria-label={`Photo ${index + 1}. Tap for options.`}>
          <img src={p.thumbUrl} alt="" loading="lazy" />
          {index === 0 && <span className="cover-tag">Cover</span>}
          {p.blurry && <span className="blur-tag">Blurry</span>}
        </button>
      ))}
    </div>
  );

  const sheets = (
    <>
      {photo && (
        <PhotoSheet
          photo={photo}
          others={others}
          onlyPhoto={item.photos.length === 1}
          onClose={() => setPhoto(null)}
          onMove={(to) => {
            actions.movePhoto(photo.id, to);
            setPhoto(null);
          }}
          onRemove={() => {
            actions.removePhoto(photo.id);
            setPhoto(null);
          }}
          onUseOriginal={() => {
            actions.useOriginalPhoto(photo.id);
            setPhoto(null);
          }}
        />
      )}
      {menu && (
        <ItemMenu
          item={item}
          others={others}
          onClose={() => setMenu(false)}
          onRedraft={() => {
            setMenu(false);
            actions.redraft(item.id);
          }}
          onMerge={(into) => {
            setMenu(false);
            actions.merge(item.id, into);
          }}
          onDelete={() => {
            setMenu(false);
            actions.remove(item.id);
          }}
        />
      )}
    </>
  );

  // ----- Still being written -----
  if (writing) {
    return (
      <article className="card stack" id={`item-${item.id}`} aria-busy="true">
        {photos}
        <div className="row">
          <Spinner />
          <div>
            <div style={{ fontWeight: 700 }}>{item.label || "Item"}</div>
            <div className="muted small">Writing the listing…</div>
          </div>
        </div>
        <div className="skeleton" style={{ height: 22, width: "70%" }} />
        <div className="skeleton" style={{ height: 16 }} />
        <div className="skeleton" style={{ height: 16, width: "85%" }} />
        {sheets}
      </article>
    );
  }

  // ----- Could not be written -----
  if (failed && !hasText) {
    return (
      <article className="card stack" id={`item-${item.id}`}>
        {photos}
        <div style={{ fontWeight: 700 }}>{item.label || "Item"}</div>
        <div className="notice error">{item.aiError || "The listing could not be written."}</div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => actions.redraft(item.id)}>
            Try again
          </button>
          <button className="btn btn-danger btn-small" style={{ minHeight: 56 }} onClick={() => actions.remove(item.id)}>
            Delete
          </button>
        </div>
        {sheets}
      </article>
    );
  }

  // ----- Approved: compact -----
  if (item.status !== "draft") {
    return (
      <article className="card stack" id={`item-${item.id}`}>
        <div className="itemrow">
          {item.photos[0] && <img className="thumb" src={item.photos[0].thumbUrl} alt="" />}
          <div className="grow">
            <div className="title">{name(item)}</div>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 700 }}>{kr(item.priceNok)}</span>
              <span className="badge green">
                <Icon name="check" size={13} /> Approved
              </span>
            </div>
          </div>
        </div>
        <div className="row">
          <Link className="btn btn-primary" to={`/i/${item.id}`}>
            Post it
          </Link>
          <button className="btn btn-secondary btn-small" style={{ minHeight: 56 }} onClick={() => edit({ status: "draft" })}>
            Edit
          </button>
        </div>
      </article>
    );
  }

  // ----- Draft: everything editable -----
  const title = language === "no" ? item.titleNo : item.titleEn;
  const description = language === "no" ? item.descriptionNo : item.descriptionEn;
  const titleLimit = language === "no" ? 60 : 80;

  return (
    <article className={`card stack${updating ? " working" : ""}`} id={`item-${item.id}`}>
      {updating && (
        <div className="working-veil">
          <span className="row">
            <Spinner /> Updating the text…
          </span>
        </div>
      )}
      {photos}

      {item.photosChanged && (
        <div className="notice row spread">
          <span>Photos were added after this text was written.</span>
          <button className="btn btn-secondary btn-small" onClick={() => actions.redraft(item.id)}>
            Rewrite
          </button>
        </div>
      )}
      {item.aiError && <div className="notice error">{item.aiError}</div>}

      <div className="row spread">
        <Segmented
          label="Language of the text"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "no", label: "Norsk" },
            { value: "en", label: "English" },
          ]}
        />
        <button className="iconbtn" onClick={() => setMenu(true)} aria-label="More options for this item">
          <Icon name="dots" />
        </button>
      </div>
      <div className="muted small" style={{ marginTop: -6 }}>
        {language === "no" ? "For Finn, Tise and Facebook." : "For eBay."} Tap any text to change it.
      </div>

      <div>
        <EditableText
          key={`t-${language}`}
          className="item-title"
          label="Title"
          value={title}
          placeholder="Tap to add a title"
          onSave={(v) => edit(language === "no" ? { titleNo: v } : { titleEn: v })}
        />
        {title.length > titleLimit && (
          <div className="small" style={{ color: "var(--amber)", marginTop: 6 }}>
            {title.length} characters. {language === "no" ? "Finn" : "eBay"} titles work best under {titleLimit}.
          </div>
        )}
      </div>

      <div>
        <div className="row" style={{ flexWrap: "wrap", rowGap: 4 }}>
          <EditablePrice value={item.priceNok} onSave={(v) => edit({ priceNok: v })} />
          <span className="badge amber">Estimate</span>
          {item.priceLowNok !== null && item.priceHighNok !== null && item.priceHighNok > 0 && (
            <span className="muted small">
              likely {item.priceLowNok.toLocaleString("nb-NO")}–{item.priceHighNok.toLocaleString("nb-NO")} kr
            </span>
          )}
        </div>
        {item.priceReason && (
          <p className="muted small" style={{ marginTop: 6 }}>
            {item.priceReason}
          </p>
        )}
      </div>

      <div>
        <div className="field-label">Condition</div>
        <div className="chips" role="radiogroup" aria-label="Condition">
          {CONDITION_ORDER.map((c: Condition) => (
            <button
              key={c}
              role="radio"
              aria-checked={item.condition === c}
              className={`chip${item.condition === c ? " on" : ""}`}
              onClick={() => edit({ condition: c })}
            >
              {CONDITION_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="field-label">Description</div>
        <EditableText
          key={`d-${language}`}
          label="Description"
          value={description}
          multiline
          clamp
          placeholder="Tap to add a description"
          onSave={(v) => edit(language === "no" ? { descriptionNo: v } : { descriptionEn: v })}
        />
      </div>

      {openQuestions.length > 0 && (
        <Questions key={openQuestions.map((x) => x.id).join()} questions={openQuestions} onSubmit={(a) => actions.answer(item.id, a)} />
      )}

      <button className="linkbtn small" style={{ alignSelf: "flex-start" }} onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? "Hide details" : "Brand, model and category"}
      </button>
      {showDetails && (
        <div className="stack" style={{ gap: 12 }}>
          <Detail label="Brand" value={item.brand} onSave={(v) => edit({ brand: v })} />
          <Detail label="Model" value={item.model} onSave={(v) => edit({ model: v })} />
          <Detail label="Category on Finn (suggestion)" value={item.categoryFinn} onSave={(v) => edit({ categoryFinn: v })} />
          <Detail label="Category on eBay (suggestion)" value={item.categoryEbay} onSave={(v) => edit({ categoryEbay: v })} />
        </div>
      )}

      <div className="divider" />
      <button className="btn btn-primary" onClick={() => edit({ status: "approved" })}>
        <Icon name="check" /> Approve
      </button>
      <div className="muted small" style={{ textAlign: "center" }}>
        AI cost for this listing: about {fee(item.costUsd, usdToNok)}
      </div>
      {sheets}
    </article>
  );
}

function Detail({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <EditableText label={label} value={value} onSave={onSave} placeholder="Tap to add" />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Questions({
  questions,
  onSubmit,
}: {
  questions: Question[];
  onSubmit: (answers: { id: string; answer: string | null }[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const answered = questions.filter((x) => answers[x.id]?.trim());

  function submit() {
    onSubmit(questions.map((x) => ({ id: x.id, answer: answers[x.id]?.trim() || null })));
  }

  return (
    <div className="questions stack">
      <h3>
        {questions.length === 1 ? "One quick question" : `${questions.length} quick questions`} to make the listing better
      </h3>
      {questions.map((x) => {
        const value = answers[x.id] ?? "";
        const custom = typing[x.id] || x.kind === "text";
        return (
          <div key={x.id}>
            <div className="q-text">{x.question}</div>
            {x.kind === "choice" && (
              <div className="chips" style={{ marginBottom: custom ? 8 : 0 }}>
                {x.options.map((option) => (
                  <button
                    key={option}
                    className={`chip${value === option && !typing[x.id] ? " on" : ""}`}
                    onClick={() => {
                      setTyping({ ...typing, [x.id]: false });
                      setAnswers({ ...answers, [x.id]: value === option ? "" : option });
                    }}
                  >
                    {option}
                  </button>
                ))}
                <button
                  className={`chip${typing[x.id] ? " on" : ""}`}
                  onClick={() => {
                    setTyping({ ...typing, [x.id]: !typing[x.id] });
                    setAnswers({ ...answers, [x.id]: "" });
                  }}
                >
                  Other…
                </button>
              </div>
            )}
            {custom && (
              <input
                className="text-input"
                aria-label={x.question}
                placeholder="Type your answer"
                value={value}
                enterKeyHint="done"
                onChange={(e) => setAnswers({ ...answers, [x.id]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            )}
          </div>
        );
      })}
      <div className="row">
        <button className="btn btn-primary" disabled={answered.length === 0} onClick={submit}>
          Update the listing
        </button>
        <button className="btn btn-quiet btn-small" onClick={() => onSubmit(questions.map((x) => ({ id: x.id, answer: null })))}>
          Skip
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PhotoSheet({
  photo,
  others,
  onlyPhoto,
  onClose,
  onMove,
  onRemove,
  onUseOriginal,
}: {
  photo: ItemPhoto;
  others: Item[];
  onlyPhoto: boolean;
  onClose: () => void;
  onMove: (to: string) => void;
  onRemove: () => void;
  onUseOriginal: () => void;
}) {
  const [moving, setMoving] = useState(false);
  return (
    <Sheet title={moving ? "Move photo to…" : undefined} onClose={onClose}>
      {!moving && (
        <>
          <img className="sheet-photo" src={photo.url} alt="" />
          {photo.blurry && (
            <div className="notice">This photo is blurry. If you can, take it again: sharp photos sell better.</div>
          )}
          {photo.edited && (
            <>
              <p className="muted small">
                {photo.cutOut
                  ? "I cut this item out of a photo that shows several things."
                  : "I tidied this photo: trimmed the surroundings or sharpened it. The item itself is unchanged."}
              </p>
              <button className="btn btn-secondary" onClick={onUseOriginal}>
                Use the original photo instead
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={() => setMoving(true)}>
            This photo belongs to another item
          </button>
          {!onlyPhoto && (
            <button className="btn btn-danger" onClick={onRemove}>
              <Icon name="trash" /> Remove photo from this item
            </button>
          )}
          <button className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </>
      )}
      {moving && (
        <>
          {others.map((other) => (
            <button key={other.id} className="card tight itemrow" style={{ boxShadow: "inset 0 0 0 1.5px var(--line)" }} onClick={() => onMove(other.id)}>
              {other.photos[0] && <img className="thumb" src={other.photos[0].thumbUrl} alt="" />}
              <span className="title grow">{name(other)}</span>
            </button>
          ))}
          {!onlyPhoto && (
            <button className="btn btn-soft" onClick={() => onMove("new")}>
              <Icon name="plus" /> It is a separate item
            </button>
          )}
          <button className="btn btn-quiet" onClick={() => setMoving(false)}>
            Back
          </button>
        </>
      )}
    </Sheet>
  );
}

function ItemMenu({
  item,
  others,
  onClose,
  onRedraft,
  onMerge,
  onDelete,
}: {
  item: Item;
  others: Item[];
  onClose: () => void;
  onRedraft: () => void;
  onMerge: (into: string) => void;
  onDelete: () => void;
}) {
  const [view, setView] = useState<"menu" | "merge" | "delete" | "redraft">("menu");
  if (view === "merge") {
    return (
      <Sheet title="Same thing as…" onClose={onClose}>
        <p className="muted">All photos move to the item you pick, and this card disappears.</p>
        {others.map((other) => (
          <button key={other.id} className="card tight itemrow" style={{ boxShadow: "inset 0 0 0 1.5px var(--line)" }} onClick={() => onMerge(other.id)}>
            {other.photos[0] && <img className="thumb" src={other.photos[0].thumbUrl} alt="" />}
            <span className="title grow">{name(other)}</span>
          </button>
        ))}
        <button className="btn btn-quiet" onClick={() => setView("menu")}>
          Back
        </button>
      </Sheet>
    );
  }
  if (view === "delete") {
    return (
      <Sheet title="Delete this item?" onClose={onClose}>
        <p className="muted">“{name(item)}” and its photos are removed from the app. This cannot be undone.</p>
        <button className="btn btn-danger" onClick={onDelete}>
          <Icon name="trash" /> Delete
        </button>
        <button className="btn btn-quiet" onClick={onClose}>
          Keep it
        </button>
      </Sheet>
    );
  }
  if (view === "redraft") {
    return (
      <Sheet title="Write the listing again?" onClose={onClose}>
        <p className="muted">Claude looks at the photos again and replaces the current text, including your own changes.</p>
        <button className="btn btn-primary" onClick={onRedraft}>
          <Icon name="refresh" /> Write it again
        </button>
        <button className="btn btn-quiet" onClick={onClose}>
          Keep the current text
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet title={name(item)} onClose={onClose}>
      <button className="btn btn-secondary" onClick={() => setView("redraft")}>
        <Icon name="refresh" /> Write the listing again
      </button>
      {others.length > 0 && (
        <button className="btn btn-secondary" onClick={() => setView("merge")}>
          <Icon name="merge" /> This is the same thing as another item
        </button>
      )}
      <button className="btn btn-danger" onClick={() => setView("delete")}>
        <Icon name="trash" /> Delete this item
      </button>
      <button className="btn btn-quiet" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
