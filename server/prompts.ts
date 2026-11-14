import { z } from "zod";

/**
 * Everything Claude is asked to do lives in this file: the instructions and
 * the exact shape of the answers. To change how listings are written, edit
 * the text here.
 */

// ---------------------------------------------------------------------------
// Step 1: which photos show which item
// ---------------------------------------------------------------------------

export const GROUPING_SYSTEM = `You help a private person in Norway sell used things online. They have photographed one or more things with their phone. Sometimes it is one item per photo, sometimes several photos of the same item from different angles, sometimes a whole pile or table of things in a single photo, and sometimes frames grabbed from a short phone video.

In this step you only work out which separate sellable items are shown, and which photos, or which part of a photo, belong to each one. A later step writes the listings, so you don't need to describe the items beyond a short name.

What counts as one item: whatever a buyer would expect to get in one listing. Things that naturally sell together are one item, for example a pair of shoes, a set of matching glasses, a console with its controllers and cables, a book series, a game in its case. Unrelated things that just happen to lie next to each other are separate items.

Matching photos to items: use colour, shape, logos, wear marks and the background to recognise the same item across photos. Close-ups of a label, size tag, serial plate or a defect belong to the item they were taken from.

For every photo you assign to an item, give a box around that item in that photo: [left, top, right, bottom] in pixels of the photo exactly as you see it. The box should contain the whole item with a small margin. The app uses the box to cut the item out of a photo that shows several things, and to trim away messy surroundings when the item only fills part of the picture, so a box that cuts off part of the item is worse than one that is a little too generous. For a close-up where the item fills the frame, the box is simply the whole photo. Set whole_photo to true when this item is the only thing for sale in the photo, and false when the photo shows several separate items.

Leave out things that are not for sale: the floor, the room, the furniture things are standing on (unless it is clearly the subject), people, pets, hands. In a pile, only pick out things someone could plausibly sell and that are visible well enough to write a listing for. A few confident items are more useful to the seller than many doubtful ones.

Frames from a video are different from photos the seller took on purpose. The app grabs more frames than needed, and many are near-repeats or caught at a bad moment. For each item keep only the best few video frames, at most four: sharp, with the whole item in view, and from different angles rather than repeats. Put the other frames in skipped_photos. A frame that is blurred, shows only part of an item, or shows mostly floor is not worth keeping, unless it is the only view of that item.

When you genuinely cannot tell where a photo belongs, for example it could be the same item as in another photo or a second similar one, do not guess silently. Put it in unsure_photos with a short, plain question for the seller and your best guess. The seller wants to be asked only when it matters, so keep this for real doubt.

Photos that are too blurry or dark to use, or that show nothing sellable, go in skipped_photos with a brief reason.

For each item, list its photos with the clearest overall view first, because the first one becomes the cover photo.`;

export const GroupingSchema = z.object({
  items: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Short plain English name the seller will recognise, e.g. 'Black Nike running shoes' or 'IKEA desk lamp, white'."),
        photos: z
          .array(
            z.object({
              photo: z.number().int().describe("The photo number as labelled, starting at 1."),
              whole_photo: z.boolean().describe("True when this item is the only thing for sale in the photo."),
              box: z
                .array(z.number())
                .nullable()
                .describe("[left, top, right, bottom] in pixels of this photo: a box around this item with a small margin."),
            }),
          )
          .describe("Photos showing this item, clearest overall view first."),
      }),
    )
    .describe("Each separate sellable item."),
  unsure_photos: z
    .array(
      z.object({
        photo: z.number().int(),
        question: z.string().describe("One short question for the seller in plain English, e.g. 'Is this the same lamp as in the first photo?'"),
        likely_item: z
          .number()
          .int()
          .nullable()
          .describe("Position in the items list (starting at 1) of your best guess, or null if it is probably a separate item."),
      }),
    )
    .describe("Photos you could not place with confidence. Empty when everything is clear."),
  skipped_photos: z
    .array(z.object({ photo: z.number().int(), reason: z.string() }))
    .describe("Photos that are unusable, show nothing sellable, or are surplus video frames."),
});
export type Grouping = z.infer<typeof GroupingSchema>;

// ---------------------------------------------------------------------------
// Step 2: write the listing for one item
// ---------------------------------------------------------------------------

export const CONDITIONS = ["new", "like_new", "good", "fair", "needs_repair"] as const;
export type Condition = (typeof CONDITIONS)[number];

const LISTING_RULES = `Write the listing the way the seller would write it themselves: an ordinary person selling their own things, typing on their phone. Buyers trust that voice and skip past anything that reads like an advert or a product description.

The seller owns the item and knows it, so the text states things flatly. It never mentions the photos or how something looks in them, and it never hedges (no "ser ut til", "trolig", "muligens", "appears to be", "likely", "possibly"). When you are not sure of something, such as the material, the brand, the model or whether it works, it does not go in the text at all: ask the seller about it instead.

Honesty still comes first. Only state what is clearly visible or what the seller has told you. Never invent measurements, age, original price, model numbers, what is included, or whether something works.

Descriptions are one to three short sentences. Say what it is, how used it is, and any wear or damage in plain words ("Litt slitt på tærne.", "Ripe i lokket."). Add a short line for a fact only when buyers need it and cannot see it for themselves: size, measurements, age, what is included. Leave out everything a buyer can see in the photos, such as the colour of details, the number of pockets or the kind of stitching. No suggestions for what it could be used for, no praise, no invitation to ask questions or look at the photos, and no closing line.

Titles say what the thing is, with brand, model and size when you know them. Nothing uncertain goes in a title. No capitals for emphasis, no emojis. The Norwegian title is at most 60 characters and the English title at most 80.

The Norwegian text is for Finn.no, Tise and Facebook Marketplace. Write everyday bokmål the way people actually write there, not a translation of the English. To show the tone only (do not reuse the wording): "Pent brukt jakke fra Finn Flare, str. S. Ingen hull eller flekker." or "Brukte skinnstøvletter. Bretter i skinnet og litt slitt på tærne, ellers hele." or "Selger caps, brukt noen få ganger."

The English text is for eBay buyers abroad: the same facts in the same plain voice, standing on its own.

Condition, judged from what is visible:
- new: unused, typically with tags or in unopened packaging
- like_new: used but with no visible signs of use
- good: light signs of normal use
- fair: clearly visible wear, still fully usable
- needs_repair: broken, incomplete or needs fixing

Give brand and model only when you can read them or the item is unmistakable; otherwise leave them empty.

Price: suggest a realistic asking price in Norwegian kroner for this item in this condition on the Norwegian second-hand market, set slightly above what it will likely sell for since buyers haggle. Give a low-to-high range around it and the reason in one short English sentence. This is an estimate from general knowledge, not a live market check. When you cannot identify the brand or model, widen the range.`;

export const LISTING_SYSTEM = `You write second-hand listings for a private seller in Norway. You are given photos of one item (the first photo is the cover).

${LISTING_RULES}

Questions for the seller: ask up to three questions about facts buyers need that the photos cannot show, and about anything you left out of the text because you were not sure. Typical ones are the size of clothes or shoes when no tag is visible, the material, whether electronics work and what is included, hidden defects, dimensions of furniture, or how old something is. Skip anything already visible, and skip questions whose answer would not change the listing or the price. Write each question in short plain English with two to five tap-able answers where that makes sense, so the seller rarely has to type. Use kind "text" only when a typed answer is unavoidable, such as measurements. If nothing important is missing, ask nothing.`;

const listingFields = {
  title_no: z.string().describe("Norwegian (bokmål) title, at most 60 characters."),
  description_no: z.string().describe("Norwegian (bokmål) description, one to three short sentences. Plain text, line breaks allowed."),
  title_en: z.string().describe("English title for eBay, at most 80 characters."),
  description_en: z.string().describe("English description for eBay, one to three short sentences. Plain text, line breaks allowed."),
  category: z.string().describe("Short general category in English, e.g. 'Shoes' or 'Lamps'."),
  finn_category: z
    .string()
    .describe("Best guess at where this belongs on Finn.no Torget, written as a path in Norwegian, e.g. 'Møbler og interiør > Belysning'."),
  ebay_category: z.string().describe("Best guess at the eBay category name in English."),
  condition: z.enum(CONDITIONS),
  brand: z.string().describe("Brand if readable or unmistakable, otherwise an empty string."),
  model: z.string().describe("Model name or number if readable or unmistakable, otherwise an empty string."),
  price_nok: z.number().int().describe("Suggested asking price in whole Norwegian kroner."),
  price_low_nok: z.number().int().describe("Low end of a realistic price range."),
  price_high_nok: z.number().int().describe("High end of a realistic price range."),
  price_reason: z.string().describe("One short English sentence on what the price is based on."),
};

export const ListingSchema = z.object({
  ...listingFields,
  questions: z
    .array(
      z.object({
        question: z.string().describe("Short plain English question for the seller."),
        kind: z.enum(["choice", "text"]).describe("'choice' when the seller can tap an answer, 'text' when they must type."),
        options: z.array(z.string()).describe("Two to five short tap-able answers in English for kind 'choice'; empty for kind 'text'."),
      }),
    )
    .describe("Up to three questions. Empty when nothing important is missing."),
});
export type Listing = z.infer<typeof ListingSchema>;

// ---------------------------------------------------------------------------
// Step 3: fold the seller's answers into the listing
// ---------------------------------------------------------------------------

export const REFINE_SYSTEM = `You maintain a second-hand listing for a private seller in Norway. You are given the current listing as the seller has it now (they may have edited it by hand) and their answers to questions about the item.

Work the new facts into the listing in both languages as plain statements, for example "Str. 42." or "Fungerer som den skal.". Keep the seller's own wording and edits wherever they don't conflict with the new facts; this is their listing. Adjust the condition and the price when an answer changes what the item is worth, for example a defect, something not working, or missing parts lowers it. If an answer is "Don't know" or similar, leave the topic out rather than writing that it is unknown, unless buyers clearly need the warning (for example electronics that were never tested: say so).

${LISTING_RULES}`;

export const RefinedSchema = z.object(listingFields);
export type Refined = z.infer<typeof RefinedSchema>;
