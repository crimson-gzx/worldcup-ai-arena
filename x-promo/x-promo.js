const exportButton = document.querySelector("#export-all");
const cardParam = new URLSearchParams(window.location.search).get("card");

if (cardParam) {
  const card = document.querySelector(`.x-card[data-export-name="${CSS.escape(cardParam)}"]`);
  document.body.classList.add("single-card");
  card?.classList.add("is-single-export");
}

async function exportCards() {
  const cards = Array.from(document.querySelectorAll(".x-card"));
  if (!cards.length) return;

  const previous = exportButton.textContent;
  exportButton.disabled = true;
  exportButton.textContent = "Exporting...";

  try {
    const html2canvas = await loadHtml2Canvas();
    for (const card of cards) {
      const canvas = await html2canvas(card, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
        width: 1600,
        height: 900,
        windowWidth: 1720,
        windowHeight: 980
      });
      const link = document.createElement("a");
      link.download = `${card.dataset.exportName || "x-card"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    }
    exportButton.textContent = "Done";
  } catch (error) {
    console.error(error);
    exportButton.textContent = "Export failed";
  } finally {
    window.setTimeout(() => {
      exportButton.disabled = false;
      exportButton.textContent = previous;
    }, 1600);
  }
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("html2canvas load failed"));
    document.head.appendChild(script);
  });
}

exportButton?.addEventListener("click", exportCards);
