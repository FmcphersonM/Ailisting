/** Copy text with one tap. Falls back to the older method where needed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
