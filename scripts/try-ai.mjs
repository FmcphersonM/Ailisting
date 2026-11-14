// Sends photos straight to a running server and prints the listings that come
// back. Handy for judging the AI's work without tapping through the app.
//
//   node scripts/try-ai.mjs <app address> <output folder> <photo> [<photo> ...]
//
// The item photos (including cut-outs) are saved in the output folder.
import fs from "node:fs";
import path from "node:path";

const [base, outDir, ...files] = process.argv.slice(2);
if (!base || !outDir || files.length === 0) {
  console.error("usage: node scripts/try-ai.mjs <app address> <output folder> <photo> [<photo> ...]");
  process.exit(1);
}

async function api(route, init) {
  const response = await fetch(`${base}/api${route}`, init);
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response;
}
const json = async (route, init) => (await api(route, init)).json();
const seconds = (ms) => `${Math.round(ms / 100) / 10}s`;

const started = Date.now();
const { id } = await json("/batches", { method: "POST" });
for (const [i, file] of files.entries()) {
  const form = new FormData();
  form.append("position", String(i));
  form.append("source", /frame/i.test(file) ? "video" : "photo");
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  await json(`/batches/${id}/photos`, { method: "POST", body: form });
}
await json(`/batches/${id}/analyze`, { method: "POST" });

let batch;
let firstItemsAt = null;
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  batch = await json(`/batches/${id}`);
  if (batch.items.length > 0 && firstItemsAt === null) firstItemsAt = Date.now();
  const busy = batch.status === "analyzing" || batch.items.some((i) => i.aiState === "pending" || i.aiState === "working");
  if (!busy) break;
}

console.log(`\n${files.length} photos -> ${batch.items.length} items. Status: ${batch.status}${batch.error ? ` (${batch.error})` : ""}`);
console.log(
  `Sorting took ${firstItemsAt ? seconds(firstItemsAt - started) : "n/a"}, everything ${seconds(Date.now() - started)}. Cost $${batch.costUsd.toFixed(4)}`,
);
for (const question of batch.questions) console.log(`UNSURE PHOTO: ${question.question}`);

fs.mkdirSync(outDir, { recursive: true });
for (const [n, item] of batch.items.entries()) {
  console.log(`\n=== Item ${n + 1}: ${item.label}  [${item.aiState}${item.aiError ? `: ${item.aiError}` : ""}]  $${item.costUsd.toFixed(4)}`);
  console.log(`photos: ${item.photos.map((p) => `${p.width}x${p.height}${p.cutOut ? " cut-out" : ""}`).join(", ")}`);
  console.log(`NO  ${item.titleNo}  (${item.titleNo.length} chars)\n${item.descriptionNo}`);
  console.log(`EN  ${item.titleEn}  (${item.titleEn.length} chars)\n${item.descriptionEn}`);
  console.log(`condition=${item.condition} brand="${item.brand}" model="${item.model}" category="${item.category}"`);
  console.log(`finn="${item.categoryFinn}" ebay="${item.categoryEbay}"`);
  console.log(`price ${item.priceNok} kr (${item.priceLowNok}-${item.priceHighNok}): ${item.priceReason}`);
  for (const x of item.questions) console.log(`Q [${x.kind}] ${x.question}${x.options.length ? `  -> ${x.options.join(" | ")}` : ""}`);
  for (const [k, photo] of item.photos.entries()) {
    const data = Buffer.from(await (await api(photo.url.replace(/^\/api/, ""))).arrayBuffer());
    fs.writeFileSync(path.join(outDir, `item${n + 1}-photo${k + 1}.jpg`), data);
  }
}
console.log(`\nbatch id: ${id}`);
