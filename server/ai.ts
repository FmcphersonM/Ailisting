import { config } from "./config.js";
import { askClaude, imageBlock, textBlock, type AiResult, type ContentBlock } from "./claude.js";
import { fakeDraft, fakeGrouping, fakeRefine } from "./fakeAi.js";
import {
  GROUPING_SYSTEM,
  GroupingSchema,
  LISTING_SYSTEM,
  ListingSchema,
  REFINE_SYSTEM,
  RefinedSchema,
  type Grouping,
  type Listing,
  type Refined,
} from "./prompts.js";

/** The three things the app asks Claude to do. */

export interface PhotoForGrouping {
  jpeg: Buffer;
  width: number;
  height: number;
  source: string; // "photo" or "video"
}

export async function groupPhotos(photos: PhotoForGrouping[]): Promise<AiResult<Grouping>> {
  if (config.fakeAi) return fakeGrouping(photos);
  const content: ContentBlock[] = [
    textBlock(
      `The seller added ${photos.length} photo${photos.length === 1 ? "" : "s"}. Each is labelled with its number and size before the image.`,
    ),
  ];
  photos.forEach((p, i) => {
    const from = p.source === "video" ? ", frame from a video" : "";
    content.push(textBlock(`Photo ${i + 1} (${p.width} x ${p.height} pixels${from}):`));
    content.push(imageBlock(p.jpeg));
  });
  content.push(textBlock("Work out the separate items and which photos belong to each."));
  return askClaude({ schema: GroupingSchema, system: GROUPING_SYSTEM, content });
}

export interface DraftInput {
  label: string;
  photos: Buffer[]; // cover first
  hasCutOuts: boolean;
}

/** How many photos of one item Claude looks at when writing its listing. */
export const MAX_PHOTOS_PER_DRAFT = 6;

export async function draftListing(input: DraftInput): Promise<AiResult<Listing>> {
  if (config.fakeAi) return fakeDraft(input.label);
  const content: ContentBlock[] = [
    textBlock(
      `Working name for this item from the sorting step: "${input.label}". It may be wrong; trust the photos.` +
        (input.hasCutOuts
          ? " Some photos are cut out of a larger photo of several things, so they can look small or soft. That is the photo, not a flaw in the item."
          : ""),
    ),
  ];
  input.photos.slice(0, MAX_PHOTOS_PER_DRAFT).forEach((jpeg, i) => {
    content.push(textBlock(i === 0 ? "Photo 1 (cover):" : `Photo ${i + 1}:`));
    content.push(imageBlock(jpeg));
  });
  content.push(textBlock("Write the listing."));
  return askClaude({ schema: ListingSchema, system: LISTING_SYSTEM, content });
}

export interface RefineInput {
  current: Refined;
  answers: { question: string; answer: string }[];
}

export async function refineListing(input: RefineInput): Promise<AiResult<Refined>> {
  if (config.fakeAi) return fakeRefine(input);
  const content: ContentBlock[] = [
    textBlock(
      `Current listing:\n${JSON.stringify(input.current, null, 2)}\n\nThe seller's answers:\n` +
        input.answers.map((a) => `- ${a.question} -> ${a.answer}`).join("\n") +
        "\n\nUpdate the listing.",
    ),
  ];
  return askClaude({ schema: RefinedSchema, system: REFINE_SYSTEM, content });
}
