import type { AiResult } from "./claude.js";
import type { RefineInput } from "./ai.js";
import type { Grouping, Listing, Refined } from "./prompts.js";

/**
 * DEVELOPMENT ONLY. Used when FAKE_AI=1 so the screens can be built and
 * tested without calling Claude or spending money. The listings it returns
 * are canned text and say so.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function result<T>(data: T, inputTokens: number, outputTokens: number): AiResult<T> {
  return {
    data,
    model: "fake-ai",
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * 4 + outputTokens * 20) / 1_000_000,
  };
}

/** Pretends every two photos show one item, and that the last photo is unclear. */
export async function fakeGrouping(photoCount: number): Promise<AiResult<Grouping>> {
  await wait(1500);
  const items: Grouping["items"] = [];
  const unsure: Grouping["unsure_photos"] = [];
  const lastIsUnsure = photoCount >= 5 && photoCount % 2 === 1;
  const usable = lastIsUnsure ? photoCount - 1 : photoCount;
  for (let n = 1; n <= usable; n += 2) {
    const photos = [{ photo: n, whole_photo: true, box: null as number[] | null }];
    if (n + 1 <= usable) photos.push({ photo: n + 1, whole_photo: true, box: null });
    items.push({ name: `Demo item ${items.length + 1}`, photos });
  }
  if (lastIsUnsure) {
    unsure.push({ photo: photoCount, question: "Is this part of the first item, or something separate?", likely_item: 1 });
  }
  return result({ items, unsure_photos: unsure, skipped_photos: [] }, 1200 * photoCount, 400);
}

export async function fakeDraft(label: string): Promise<AiResult<Listing>> {
  await wait(1200 + Math.random() * 2500);
  const listing: Listing = {
    title_no: `${label} (demo)`,
    description_no:
      "Dette er en demotekst laget uten Claude.\nPent brukt, fungerer som den skal.\n\nTilstand: Pent brukt\nFarge: Se bilder",
    title_en: `${label} (demo)`,
    description_en:
      "This is canned demo text written without Claude.\nGently used and works as it should.\n\nCondition: Good\nColour: See photos",
    category: "Demo",
    finn_category: "Møbler og interiør > Annet",
    ebay_category: "Home & Garden",
    condition: "good",
    brand: "",
    model: "",
    price_nok: 350,
    price_low_nok: 250,
    price_high_nok: 450,
    price_reason: "Demo estimate. Real estimates come from Claude.",
    questions: [
      { question: "Does it work?", kind: "choice", options: ["Works perfectly", "Works with issues", "Not tested", "Doesn't work"] },
      { question: "What are the measurements?", kind: "text", options: [] },
    ],
  };
  return result(listing, 9000, 900);
}

export async function fakeRefine(input: RefineInput): Promise<AiResult<Refined>> {
  await wait(1200);
  const facts = input.answers.map((a) => `${a.question} ${a.answer}`).join("\n");
  return result(
    {
      ...input.current,
      description_no: `${input.current.description_no}\n\n${facts}`,
      description_en: `${input.current.description_en}\n\n${facts}`,
    },
    1500,
    700,
  );
}
