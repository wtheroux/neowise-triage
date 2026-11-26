let latest = 0;
let controller;
export function invalidatePending() {
  latest += 1;
  controller?.abort();
}
const manual = "Автоматический разбор недоступен. Разберите заявку вручную или повторите попытку. Ответ клиенту не отправлен.";
const labels = { delivery: "Доставка", pricing: "Стоимость", other: "Другое" };

export async function submitTriage(text, render, fetchRequest = fetch) {
  invalidatePending();
  const id = latest;
  render(""); // Never leave the previous draft visible during another request.
  if (!text.trim()) {
    render("Введите текст заявки.");
    return;
  }
  controller = new AbortController();
  const current = controller;
  const timer = setTimeout(() => current.abort(), 5000);
  render("Разбираем заявку…");
  try {
    const response = await fetchRequest("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: current.signal,
    });
    const data = await response.json();
    if (id !== latest) return;
    if (response.status === 400 && data.status === "invalid_input") {
      render("Введите непустой текст заявки.");
    } else if (response.ok && data.status === "ready" && Object.hasOwn(labels, data.topic)
      && typeof data.draft === "string" && data.draft.trim()) {
      render(`Тема: ${labels[data.topic]}\n\nЧерновик (проверьте перед отправкой):\n${data.draft.trim()}`);
    } else {
      render(manual);
    }
  } catch {
    if (id === latest) render(manual);
  } finally {
    clearTimeout(timer);
  }
}
