let pdfDoc = null,
    pageNum = 1,
    searchTerm = '',
    matches = [];

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const pageInfo = document.getElementById('pageInfo');
const matchesList = document.getElementById('matchesList');

const url = "data/books/YourBook.pdf"; // path to your book

// Load PDF
pdfjsLib.getDocument(url).promise.then(doc => {
  pdfDoc = doc;
  renderPage(pageNum);
});

// Render page with highlights
function renderPage(num) {
  pdfDoc.getPage(num).then(page => {
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    page.render(renderContext).promise.then(() => {
      if (searchTerm) {
        highlightMatchesOnPage(page, viewport, searchTerm);
      }
    });

    pageInfo.textContent = `Page ${num} of ${pdfDoc.numPages}`;
  });
}

// Highlight text on page
function highlightMatchesOnPage(page, viewport, term) {
  page.getTextContent().then(textContent => {
    ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
    textContent.items.forEach(item => {
      if (item.str.toLowerCase().includes(term.toLowerCase())) {
        const tx = pdfjsLib.Util.transform(
          pdfjsLib.Util.transform(viewport.transform, item.transform),
          [1, 0, 0, -1, 0, 0]
        );
        ctx.fillRect(tx[4], tx[5], item.width, item.height);
      }
    });
  });
}

// Search function
document.getElementById('searchButton').addEventListener('click', () => {
  searchTerm = document.getElementById('searchBox').value.trim();
  matches = [];
  matchesList.innerHTML = "";

  if (!searchTerm) return;

  // Search all pages
  const promises = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    promises.push(
      pdfDoc.getPage(i).then(page =>
        page.getTextContent().then(tc => {
          const text = tc.items.map(it => it.str).join(" ");
          if (text.toLowerCase().includes(searchTerm.toLowerCase())) {
            matches.push({ page: i });
          }
        })
      )
    );
  }

  Promise.all(promises).then(() => {
    matches.forEach(m => {
      const li = document.createElement("li");
      li.textContent = `Page ${m.page}`;
      li.addEventListener("click", () => {
        pageNum = m.page;
        renderPage(pageNum);
      });
      matchesList.appendChild(li);
    });
    if (matches.length) {
      pageNum = matches[0].page;
      renderPage(pageNum);
    }
  });
});

// Navigation
document.getElementById('prev').addEventListener('click', () => {
  if (pageNum <= 1) return;
  pageNum--;
  renderPage(pageNum);
});
document.getElementById('next').addEventListener('click', () => {
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++;
  renderPage(pageNum);
});

// Drawer controls
const drawer = document.getElementById("drawer");
document.getElementById("openDrawer").addEventListener("click", () => drawer.classList.add("open"));
document.getElementById("closeDrawer").addEventListener("click", () => drawer.classList.remove("open"));
