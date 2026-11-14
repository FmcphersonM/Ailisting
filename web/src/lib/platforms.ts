// What each marketplace needs, and the words it uses. Change the links here
// if a marketplace moves its "new ad" page.

import type { Condition, Item, Platform } from "../api";

export interface CopyField {
  label: string; // shown to you
  hint?: string; // the field's name on the marketplace
  value: string;
  long?: boolean;
  note?: string;
}

export interface PlatformInfo {
  id: Platform;
  name: string;
  language: "no" | "en";
  openUrl: string;
  openLabel: string;
  openHelp: string;
  automaticLater?: boolean;
}

export const PLATFORMS: PlatformInfo[] = [
  {
    id: "finn",
    name: "Finn",
    language: "no",
    openUrl: "https://www.finn.no/nyannonse",
    openLabel: "Open Finn.no",
    openHelp: "Choose Torget, then “Selge”. If the page does not open on a new ad, tap “Ny annonse” on Finn.",
  },
  {
    id: "tise",
    name: "Tise",
    language: "no",
    openUrl: "https://tise.com/",
    openLabel: "Open Tise",
    openHelp: "Tise works best in its app. If the app does not open by itself, open it and tap the + button.",
  },
  {
    id: "facebook",
    name: "Facebook",
    language: "no",
    openUrl: "https://www.facebook.com/marketplace/create/item",
    openLabel: "Open Marketplace",
    openHelp: "This opens “New listing” on Facebook Marketplace.",
  },
  {
    id: "ebay",
    name: "eBay",
    language: "en",
    openUrl: "https://www.ebay.com/sl/sell",
    openLabel: "Open eBay",
    openHelp: "Automatic posting to eBay is coming in the next phase. Until then you can copy the English text.",
    automaticLater: true,
  },
];

const CONDITION_WORDS: Record<Platform, Record<Condition, string>> = {
  finn: {
    new: "Helt ny – Ubrukt/uåpnet",
    like_new: "Som ny – Ikke synlig brukt",
    good: "Pent brukt – Små bruksmerker",
    fair: "Godt brukt – Synlige bruksmerker",
    needs_repair: "Må fikses",
  },
  tise: {
    new: "Ny",
    like_new: "Som ny",
    good: "Pent brukt",
    fair: "Godt brukt",
    needs_repair: "Må fikses",
  },
  facebook: {
    new: "Ny",
    like_new: "Brukt – som ny",
    good: "Brukt – god",
    fair: "Brukt – grei",
    needs_repair: "Brukt – grei",
  },
  ebay: {
    new: "New",
    like_new: "Used – like new",
    good: "Used – good",
    fair: "Used – acceptable",
    needs_repair: "For parts or not working",
  },
};

export function fieldsFor(platform: Platform, item: Item): CopyField[] {
  const condition = CONDITION_WORDS[platform][item.condition];
  const price = item.priceNok === null ? "" : String(item.priceNok);
  const fields: CopyField[] = [];
  const add = (field: CopyField) => {
    if (field.value.trim()) fields.push(field);
  };

  if (platform === "finn") {
    add({ label: "Title", hint: "Annonseoverskrift", value: item.titleNo });
    add({ label: "Description", hint: "Beskrivelse", value: item.descriptionNo, long: true });
    add({ label: "Price", hint: "Pris", value: price, note: "Estimate. Check before posting." });
    add({ label: "Condition", hint: "Tilstand", value: condition, note: "Pick this in Finn's list." });
    add({ label: "Category", hint: "Kategori", value: item.categoryFinn, note: "Suggestion. Pick the closest in Finn's list." });
    add({ label: "Brand", hint: "Merke", value: item.brand });
  } else if (platform === "tise") {
    add({ label: "Title", hint: "Tittel", value: item.titleNo });
    add({ label: "Description", hint: "Beskrivelse", value: item.descriptionNo, long: true });
    add({ label: "Price", hint: "Pris", value: price, note: "Estimate. Check before posting." });
    add({ label: "Brand", hint: "Merke", value: item.brand });
    add({ label: "Condition", hint: "Tilstand", value: condition, note: "Pick the closest in Tise's list." });
    add({ label: "Category", hint: "Kategori", value: item.categoryFinn, note: "Suggestion. Pick the closest in Tise's list." });
  } else if (platform === "facebook") {
    add({ label: "Title", hint: "Tittel", value: item.titleNo });
    add({ label: "Price", hint: "Pris", value: price, note: "Estimate. Check before posting." });
    add({ label: "Condition", hint: "Tilstand", value: condition, note: "Pick this in Facebook's list." });
    add({ label: "Description", hint: "Beskrivelse", value: item.descriptionNo, long: true });
    add({ label: "Category", hint: "Kategori", value: item.category, note: "Suggestion. Pick the closest in Facebook's list." });
  } else {
    add({ label: "Title", hint: "max 80 characters", value: item.titleEn.slice(0, 80) });
    add({ label: "Description", value: item.descriptionEn, long: true });
    add({ label: "Condition", value: condition });
    add({ label: "Category", value: item.categoryEbay, note: "Suggestion. Pick the closest in eBay's list." });
    add({ label: "Brand", value: item.brand });
    add({ label: "Model", value: item.model });
  }
  return fields;
}
