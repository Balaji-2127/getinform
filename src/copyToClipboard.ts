// `navigator.clipboard` only exists in a secure context — plain http on a
// LAN IP (exactly how a rep might open this on a laptop during a demo, or
// from a phone on the office wifi) doesn't qualify, so the property is
// simply undefined there. Both copy buttons in this app used to call
// `navigator.clipboard.writeText(...).then(...)` directly, which in that
// case throws a TypeError inside the click handler, and when the API does
// exist but the write is denied, rejects with nothing catching it. Either
// way the link wasn't copied and the UI still claimed it was.
//
// Falls back to the legacy hidden-textarea + execCommand path, which is
// deprecated but remains the only thing that works outside a secure
// context, and reports success as a boolean so callers can tell the user
// the truth instead of guessing.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or a non-secure context — fall through below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen but still focusable/selectable: display:none or
    // visibility:hidden would make select() a no-op.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
