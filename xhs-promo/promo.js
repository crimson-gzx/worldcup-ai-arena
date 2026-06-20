const exportButton = document.querySelector("#export-all");
const cardParam = new URLSearchParams(window.location.search).get("card");

if (cardParam) {
  const card = document.querySelector(`.xhs-card[data-export-name="${CSS.escape(cardParam)}"]`);
  document.body.classList.add("single-card");
  card?.classList.add("is-single-export");
}

async function exportCards() {
  const cards = Array.from(document.querySelectorAll(".xhs-card"));
  if (!cards.length) return;

  const previous = exportButton.textContent;
  exportButton.disabled = true;
  exportButton.textContent = "正在导出...";

  try {
    const html2canvas = await loadHtml2Canvas();
    for (const card of cards) {
      const canvas = await html2canvas(card, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
        width: 1080,
        height: 1440,
        windowWidth: 1180,
        windowHeight: 1600
      });
      const link = document.createElement("a");
      link.download = `${card.dataset.exportName || "xhs-card"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    }
    exportButton.textContent = "导出完成";
  } catch (error) {
    console.error(error);
    exportButton.textContent = "导出失败，见控制台";
  } finally {
    window.setTimeout(() => {
      exportButton.disabled = false;
      exportButton.textContent = previous;
    }, 1800);
  }
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("html2canvas 加载失败"));
    document.head.appendChild(script);
  });
}

exportButton?.addEventListener("click", exportCards);
