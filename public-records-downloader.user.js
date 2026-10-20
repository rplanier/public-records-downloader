// ==UserScript==
// @name          Public Records Downloader
// @author        Preston Lanier (preston@lanier.email)
// @namespace     https://www.github.com/rplanier
// @source        https://www.github.com/rplanier/public-records-downloader
// @description   Adds download buttons, instrument search, and UI improvements to public records sites. Compiles document page images into single PDFs. Supports GovOS (publicsearch.us), CountyFusion (govos.com), and uslandrecords.com.
// @version       0.3.4
// @match         *://*.publicsearch.us/*
// @match         *://*.uslandrecords.com/*
// @match         *://*.govos.com/*
// @run-at        document-end
// @require       https://unpkg.com/jspdf@4.2.1/dist/jspdf.umd.min.js
// @icon          https://eddy.nm.publicsearch.us/img/favicon-32x32.png
// @updateURL     https://raw.githubusercontent.com/rplanier/public-records-downloader/main/public-records-downloader.user.js
// @downloadURL   https://raw.githubusercontent.com/rplanier/public-records-downloader/main/public-records-downloader.user.js
// @supportURL    https://github.com/rplanier/public-records-downloader/issues
// ==/UserScript==

// ============================================================
// Shared helpers
// ============================================================

const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18" style="margin-right: 6px;"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M18.1716 1C18.702 1 19.2107 1.21071 19.5858 1.58579L22.4142 4.41421C22.7893 4.78929 23 5.29799 23 5.82843V20C23 21.6569 21.6569 23 20 23H4C2.34315 23 1 21.6569 1 20V4C1 2.34315 2.34315 1 4 1H18.1716ZM4 3C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21L5 21L5 15C5 13.3431 6.34315 12 8 12L16 12C17.6569 12 19 13.3431 19 15V21H20C20.5523 21 21 20.5523 21 20V6.82843C21 6.29799 20.7893 5.78929 20.4142 5.41421L18.5858 3.58579C18.2107 3.21071 17.702 3 17.1716 3H17V5C17 6.65685 15.6569 8 14 8H10C8.34315 8 7 6.65685 7 5V3H4ZM17 21V15C17 14.4477 16.5523 14 16 14L8 14C7.44772 14 7 14.4477 7 15L7 21L17 21ZM9 3H15V5C15 5.55228 14.5523 6 14 6H10C9.44772 6 9 5.55228 9 5V3Z" fill="#FFFFFF"></path> </g></svg>`;

const ICON_SEARCH = `<svg viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns" fill="#FFFFFF" width="18" height="18" style="margin-right: 6px;" stroke="#FFFFFF"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>search</title> <desc>Created with Sketch Beta.</desc> <defs> </defs> <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage"> <g id="Icon-Set" sketch:type="MSLayerGroup" transform="translate(-256.000000, -1139.000000)" fill="#FFFFFF"> <path d="M269.46,1163.45 C263.17,1163.45 258.071,1158.44 258.071,1152.25 C258.071,1146.06 263.17,1141.04 269.46,1141.04 C275.75,1141.04 280.85,1146.06 280.85,1152.25 C280.85,1158.44 275.75,1163.45 269.46,1163.45 L269.46,1163.45 Z M287.688,1169.25 L279.429,1161.12 C281.591,1158.77 282.92,1155.67 282.92,1152.25 C282.92,1144.93 276.894,1139 269.46,1139 C262.026,1139 256,1144.93 256,1152.25 C256,1159.56 262.026,1165.49 269.46,1165.49 C272.672,1165.49 275.618,1164.38 277.932,1162.53 L286.224,1170.69 C286.629,1171.09 287.284,1171.09 287.688,1170.69 C288.093,1170.3 288.093,1169.65 287.688,1169.25 L287.688,1169.25 Z" id="search" sketch:type="MSShapeGroup"> </path> </g> </g> </g></svg>`;

/**
 * Fixed-position toast for progress messages. Survives DOM replacement (e.g.,
 * ASP.NET partial-updates) since it lives on document.body.
 **/
function showOverlay(msg) {
  let el = document.getElementById('udd-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'udd-overlay';
    el.style.cssText = 'position: fixed; top: 12px; right: 12px; background: #43966a; color: white; padding: 10px 16px; border-radius: 4px; z-index: 100000; font-family: sans-serif; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.25);';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

function hideOverlay() {
  document.getElementById('udd-overlay')?.remove();
}

// The image servers occasionally accept a connection and then never respond.
// Without a timeout that stalls the whole compile; aborting turns a hang into
// a failed attempt so the retry/back-off loop in compilePdf can recover.
const FETCH_TIMEOUT_MS = 30000;

/**
 * fetch() with an abort timeout. Rejects with an AbortError when the request
 * exceeds FETCH_TIMEOUT_MS.
 **/
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch each page image, compress to JPEG, and compile into a single PDF.
 * Used by every site adapter once it has an ordered list of pages.
 *
 * Each entry in `pages` is either:
 *   - a URL string, fetched directly; or
 *   - an async function returning a Blob, for sites whose image endpoint is
 *     stateful (e.g., CountyFusion selects the page server-side before serving
 *     a fixed image URL). Functions are invoked strictly in order.
 *
 * Options:
 *   onProgress(n, total) — called before each page fetch
 *   greyscale — convert to greyscale (default true; good for text-only docs)
 *   jpegQuality — 0..1 (default 0.85)
 **/
async function compilePdf(pages, fileName, { onProgress, greyscale = true, jpegQuality = 0.85 } = {}) {
  console.log("Compiling page preview images. Please wait...");

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const maxRetries = 3;

  const fetchPage = async (page) => {
    if (typeof page === 'function') return page();
    const response = await fetchWithTimeout(page);
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.blob();
  };

  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(i + 1, pages.length);

    let blob = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log("Fetching page " + (i + 1) + (attempt > 1 ? " (attempt " + attempt + ")" : "") + "...");
        blob = await fetchPage(pages[i]);
        break;
      } catch (err) {
        const reason = err.name === 'AbortError' ? "timed out after " + (FETCH_TIMEOUT_MS / 1000) + "s" : err.message;
        console.warn("Page " + (i + 1) + " fetch error: " + reason + (attempt < maxRetries ? ", retrying..." : ""));
      }
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }

    if (!blob) {
      alert("Download failed: the image server timed out on page " + (i + 1) + ". Please try again later.");
      return false;
    }

    try {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      const compressed = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Failed to load image for page " + (i + 1)));
        img.onload = () => {
          console.log("Page " + (i + 1) + " source: " + img.naturalWidth + "x" + img.naturalHeight);
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (greyscale) ctx.filter = 'grayscale(1)';
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', jpegQuality));
        };
        img.src = base64;
      });

      if (i > 0) pdf.addPage();
      pdf.addImage(compressed, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    } catch (error) {
      console.error("Error processing page " + (i + 1) + ": " + error);
      alert("Download failed on page " + (i + 1) + ": " + error.message + ". Please try again later.");
      return false;
    }
  }

  pdf.save(fileName);
  return true;
}

// ============================================================
// GovOS adapter (publicsearch.us)
// ============================================================

const govosAdapter = {
  match(hostname) {
    return /\.publicsearch\.us$/.test(hostname);
  },

  init() {
    let county = "";
    let domain = "";
    let state = "";
    let downloadButton, searchButton;

    const parseDocumentInfo = () => {
      const url = new URL(window.location.href);
      domain = url.hostname;
      const parts = domain.split(".");
      const countyParts = parts[0].toLowerCase().split(" ");
      for (let i = 0; i < countyParts.length; i++) {
        countyParts[i] = countyParts[i].charAt(0).toUpperCase() + countyParts[i].substring(1);
      }
      county = countyParts.join(" ");
      state = parts[1].toUpperCase();
    };

    const getReduxStore = () => {
      const selectors = [
        'div.doc-preview__summary',
        'article',
        'div.doc-preview-summary__columns',
        'main',
        '#root'
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;

        const reactKey = Object.keys(el).find(k => k.startsWith('__reactInternal') || k.startsWith('__reactFiber'));
        if (!reactKey) continue;

        let node = el[reactKey];
        for (let i = 0; i < 40; i++) {
          if (!node) break;
          if (node.pendingProps?.store?.getState) {
            return node.pendingProps.store;
          }
          const ms = node.memoizedState;
          if (ms?.store?.getState) {
            return ms.store;
          }
          if (ms?.memoizedState?.[0]?.store?.getState) {
            return ms.memoizedState[0].store;
          }
          if (ms?.element?.props?.store?.getState) {
            return ms.element.props.store;
          }
          node = node.return;
        }
      }
      return null;
    };

    const getDocumentName = (docData) => {
      let fileNameParts = [];

      const caseNumber = docData.caseNumber || "";
      const documentNumber = docData.instrumentNumber || docData.docNumber || "";
      const volumeNumber = docData.volume || "";
      const pageNumber = docData.page || "";

      if (caseNumber) {
        fileNameParts.push("Cause No. " + caseNumber);
      } else {
        if (documentNumber) {
          fileNameParts.push(documentNumber);
        }

        if (volumeNumber && pageNumber) {
          fileNameParts.push("V" + volumeNumber + " P" + pageNumber);
        }
      }

      fileNameParts.push(county + " " + state);

      return fileNameParts.join("_") + ".pdf";
    };

    const download = async () => {
      const store = getReduxStore();
      if (!store) {
        console.error("Could not access Redux store");
        return;
      }

      const docData = store.getState().docPreview?.document?.data;
      if (!docData) {
        console.error("Could not access document data");
        return;
      }

      const imageUrls = docData.imageUrls;
      if (!imageUrls || imageUrls.length === 0) {
        console.error("No image URLs found in document data");
        return;
      }

      let fileName = prompt("Save file as:", getDocumentName(docData));
      if (!fileName) {
        return;
      }
      if (!fileName.toLowerCase().endsWith(".pdf")) {
        fileName += ".pdf";
      }

      try {
        await compilePdf(imageUrls, fileName, {
          onProgress: (n, total) => showOverlay(`Compiling page ${n} of ${total}...`)
        });
      } finally {
        hideOverlay();
      }
    };

    const addDownloadButton = async (bar) => {
      const buttonClass = bar.buttonClass;

      downloadButton = document.createElement("button");
      downloadButton.innerHTML = ICON_DOWNLOAD + " Download";
      downloadButton.title = "Download a compiled PDF";
      downloadButton.setAttribute("class", buttonClass);
      downloadButton.style.background = "#43966a";
      downloadButton.style.opacity = 1;
      downloadButton.onclick = function() {
        downloadButton.innerHTML = ICON_DOWNLOAD + " Downloading...";
        downloadButton.disabled = true;
        downloadButton.style.opacity = 0.5;
        downloadButton.style.cursor = "not-allowed";
        download().then(() => {
          downloadButton.innerHTML = ICON_DOWNLOAD + " Download";
          downloadButton.disabled = false;
          downloadButton.style.opacity = 1;
          downloadButton.style.cursor = "pointer";
        });
      };

      bar.append(downloadButton);
    };

    const addSearchForm = async (bar) => {
      const buttonClass = bar.buttonClass;

      let form = document.createElement("form");
      form.style.display = "flex";

      let inputInstNo = document.createElement("input");
      inputInstNo.type = "text";
      inputInstNo.placeholder = "Inst. No.";
      inputInstNo.style.width = "70px";
      inputInstNo.style.border = "thin solid #CCC";
      inputInstNo.style.padding = "8px";
      inputInstNo.style.marginRight = "8px";

      let inputVolume = document.createElement("input");
      inputVolume.type = "text";
      inputVolume.placeholder = "Volume";
      inputVolume.style.width = "50px";
      inputVolume.style.border = "thin solid #CCC";
      inputVolume.style.padding = "8px";
      inputVolume.style.marginRight = "8px";

      let inputPage = document.createElement("input");
      inputPage.type = "text";
      inputPage.placeholder = "Page";
      inputPage.style.width = "50px";
      inputPage.style.border = "thin solid #CCC";
      inputPage.style.padding = "8px";
      inputPage.style.marginRight = "8px";

      searchButton = document.createElement("button");
      searchButton.innerHTML = ICON_SEARCH + " Search";
      searchButton.setAttribute("class", buttonClass);
      searchButton.title = "Search for instrument";
      searchButton.style.opacity = 1;

      form.onsubmit = function(e) {
        e.preventDefault();
        let today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

        const instNo = inputInstNo.value.trim();
        const volume = inputVolume.value.trim();
        const page = inputPage.value.trim();

        // The results page now expects documentNumberRange to be present on
        // every advanced search, even when no instrument number was given.
        // Omitting it yields "No Results Found", so always send it, as an
        // empty JSON array when unused. Mirrors the URL the site's own
        // advanced search form generates.
        const instArray = JSON.stringify(instNo ? [instNo] : []);
        let url = "https://" + domain + "/results?department=RP" +
          "&documentNumberRange=" + encodeURIComponent(instArray) +
          "&recordedDateRange=18000101%2C" + today +
          "&searchType=advancedSearch";

        if (volume) {
          url += "&volume=" + encodeURIComponent(volume);
        }
        if (page) {
          url += "&page=" + encodeURIComponent(page);
        }

        // The app persists its workspace tabs in sessionStorage and restores
        // them on load. When the restored active workspace is a document tab,
        // the /results route ignores the volume/page criteria in the URL and
        // reports "No Results Found" for searches that succeed in a fresh
        // tab. Dropping the saved workspace state before navigating makes
        // the app treat this load like a fresh tab and honour the URL.
        try {
          sessionStorage.removeItem("ko-search:workspaces");
        } catch (err) { /* storage unavailable; proceed anyway */ }

        window.location.href = url;
      };

      form.appendChild(inputInstNo);
      form.appendChild(inputVolume);
      form.appendChild(inputPage);
      form.appendChild(searchButton);
      bar.append(form);
    };

    // Locate the action-button group inside nav#primary and describe how to
    // add to it. GovOS has shipped several layouts for this bar:
    //   - a plain <div> of <button>s (most counties)
    //   - a "Previous in Book / Next in Book" <div> ahead of that group
    //   - a <ul role="list"> with one <li> per button (newer builds)
    // Rather than hard-code any of those, anchor on the Add to Cart button,
    // which exists in every version, and mirror however it is wrapped.
    const findActionBar = () => {
      const nav = document.querySelector("nav#primary");
      if (!nav) return null;

      const buttons = [...nav.querySelectorAll("button")];
      const anchor =
        buttons.find(b => /add to cart/i.test(b.textContent)) ||
        buttons.find(b => /property alert|express checkout/i.test(b.textContent));

      let container = null;
      let wrapInListItem = false;

      if (anchor) {
        if (anchor.parentElement?.tagName === "LI") {
          container = anchor.parentElement.parentElement;
          wrapInListItem = true;
        } else {
          container = anchor.parentElement;
        }
      } else {
        // No recognisable button: fall back to the first non-book-nav <div>.
        container = [...nav.querySelectorAll(":scope > div")]
          .find(d => !d.classList.contains("bookNavContainer")) || null;
      }

      if (!container) return null;

      // Copy the class of a sibling button so the injected buttons pick up
      // the site's own styling. Prefer an enabled one; disabled variants
      // (Express Checkout before sign-in) use a muted class.
      const siblingButtons = [...container.querySelectorAll("button")];
      const styleSource =
        siblingButtons.find(b => !b.disabled) || siblingButtons[siblingButtons.length - 1] || anchor;
      const buttonClass = styleSource?.className || "";

      return {
        container,
        buttonClass,
        append(el) {
          if (wrapInListItem) {
            const li = document.createElement("li");
            li.appendChild(el);
            container.appendChild(li);
          } else {
            container.appendChild(el);
          }
        }
      };
    };

    const evaluate = async () => {
      document.querySelectorAll('.a11y-table table').forEach(table => {
        if (table.style.width !== '100%') {
          table.style.width = '100%';
        }
      });

      const bar = findActionBar();
      if (bar && !downloadButton?.isConnected) {
        parseDocumentInfo();

        console.log("Public Records Downloader is running (" + county + " County, " + state + ")");

        await addDownloadButton(bar);
        await addSearchForm(bar);
      }
    };

    // React re-renders the action bar after the document data loads (and on
    // cart/checkout state changes), which throws away anything we appended.
    // Watch the whole document so we can re-inject whenever our button is
    // gone; evaluate() is idempotent, so extra calls are cheap no-ops.
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        evaluate();
      });
    }).observe(document.documentElement, {
      subtree: true,
      childList: true
    });

    evaluate();
  }
};

// ============================================================
// uslandrecords adapter (i2j.uslandrecords.com)
// ============================================================

const uslandrecordsAdapter = {
  match(hostname) {
    return hostname === 'i2j.uslandrecords.com';
  },

  init() {
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    let downloadLink = null;
    let downloadInProgress = false;

    // The image endpoint accepts plain query params for resolution control:
    // CNTWIDTH/CNTHEIGHT (container size), FITTYPE (Width|Height|Best), ZOOM
    // (multiplier). The encrypted SCTKEY only encodes the document/page; the
    // render dimensions are open. We strip any existing render params from the
    // captured URL and append our high-res versions before fetching.
    const buildHighResUrl = (originalUrl) => {
      const cleaned = originalUrl.replace(/[?&](CNTWIDTH|CNTHEIGHT|FITTYPE|ZOOM)=[^&]*/gi, '');
      const sep = cleaned.includes('?') ? '&' : '?';
      return cleaned + sep + 'CNTWIDTH=2400&CNTHEIGHT=3200&FITTYPE=Width&ZOOM=1.5';
    };

    const isOnImagesTab = () =>
      document.getElementById('TabController1_ImageViewertabitem')?.classList.contains('TabBarActiveCtrl');

    const isOnDetailsTab = () =>
      document.getElementById('TabController1_DocumentDetailstabitem')?.classList.contains('TabBarActiveCtrl');

    // Read the populated DocDetails1 grid into a flat object. Returns null if
    // the user has never visited the View Details tab (the panel is lazy-loaded
    // by ASP.NET — empty until visited at least once for the current document).
    const readDocDetails = () => {
      const grid = document.getElementById('DocDetails1_GridView_Details');
      if (!grid) return null;
      const dataRow = grid.querySelector('tr.DataGridRow');
      if (!dataRow) return null;
      const cells = dataRow.querySelectorAll('td');
      if (cells.length < 7) return null;
      return {
        docNumber: cells[0]?.textContent.trim() || '',
        fileDate: cells[2]?.textContent.trim() || '',
        typeDesc: cells[4]?.textContent.trim() || '',
        pages: cells[5]?.textContent.trim() || '',
        bookVolPage: cells[6]?.textContent.trim() || '',
        instrDate: cells[8]?.textContent.trim() || ''
      };
    };

    // /TX/SanJacinto/D/default.aspx -> { county: 'San Jacinto', state: 'TX' }
    const parseCountyState = () => {
      const segs = window.location.pathname.split('/').filter(Boolean);
      const state = (segs[0] || '').toUpperCase();
      const rawCounty = segs[1] || '';
      const county = rawCounty.replace(/([A-Z])/g, ' $1').trim();
      return { county, state };
    };

    // Match the GovOS naming convention: "<docNum>_V<vol> P<page>_<county> <state>.pdf"
    // Book/Vol/Page like "OR/02020/24858" splits into book=OR, vol=2020 (leading
    // zeros stripped for readability), page=24858. Book code is omitted to match
    // GovOS shape; can be re-added if collisions become a problem.
    const buildFilename = (details) => {
      const parts = [];
      if (details?.docNumber) parts.push(details.docNumber);

      if (details?.bookVolPage) {
        const segs = details.bookVolPage.split('/');
        if (segs.length === 3) {
          const vol = String(parseInt(segs[1], 10) || segs[1]);
          parts.push('V' + vol + ' P' + segs[2]);
        }
      }

      const { county, state } = parseCountyState();
      if (county && state) parts.push(county + ' ' + state);

      return (parts.length ? parts.join('_') : 'document') + '.pdf';
    };

    // Trigger a tab postback and resolve when the partial-update completes.
    const switchTabAndWait = (target) => new Promise((resolve, reject) => {
      const prm = w.Sys.WebForms.PageRequestManager.getInstance();
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        prm.remove_endRequest(handler);
      };

      const handler = (sender, args) => {
        if (args.get_error && args.get_error()) {
          const err = args.get_error();
          if (args.set_errorHandled) args.set_errorHandled(true);
          cleanup();
          reject(new Error('Tab switch error: ' + err.message));
          return;
        }
        cleanup();
        // Brief settle so any post-update inline scripts finish running.
        setTimeout(resolve, 300);
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for tab switch'));
      }, 15000);

      prm.add_endRequest(handler);

      console.log('[uslandrecords] Switching tab:', target);
      try {
        w.__doPostBack(target, '');
      } catch (err) {
        cleanup();
        reject(new Error('__doPostBack failed: ' + err.message));
      }
    });

    // Read DocDetails, auto-switching tabs if needed. Always tries to leave the
    // user back on the Images tab even if reading fails.
    const ensureDocDetails = async () => {
      let details = readDocDetails();
      if (details) return details;

      // Image viewer can be popped into its own window via "Undock Image Viewer";
      // that window has no tab controller, so there's nothing to switch to.
      // Skip the tab dance and let the caller fall back to a generic filename.
      const detailsTab = document.getElementById('TabController1_DocumentDetailstabitem');
      if (!detailsTab) return null;

      const startedOnImages = isOnImagesTab();
      showOverlay('Reading document details...');

      try {
        if (!isOnDetailsTab()) {
          await switchTabAndWait('TabController1$DocumentDetailstabitem');
        }
        details = readDocDetails();
      } finally {
        if (startedOnImages && !isOnImagesTab()) {
          try {
            await switchTabAndWait('TabController1$ImageViewertabitem');
            await new Promise(r => setTimeout(r, 500));
          } catch (e) { /* best-effort */ }
        }
      }

      return details;
    };

    // Save icon embedded as a base64 PNG (32x32 source, displayed at 16x16
    // via background-size for crispness on retina displays). Source file is
    // /assets/img/save-32.png in this repo.
    const DOWNLOAD_ICON_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAADsAAAA7AF5KHG9AAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAA95JREFUWIW9l1tsFFUYx39nZmdmd6a1V2yhayUprdZSirdSUqo1BVtqG8EYgkaaUEi1ofJANKImmPigCT4T44sXEmMbKZTExFTSNLEBRcXLKqXI5aVgsIIrdO+XGR+U0sJuZ7Yt/J82u//z/X853/lOzgqc6VHZrQ4JIRSHfgAsISQLJEn3vJG47H8vlUdc/6AoWrfLrXViIQEIWciyS9EBYuFwXvXLz+bX7dkmZQJwLWbSf+gboj1vRzXFPRS86n8B8E/3uG7Q8s66jq5cl6oCcHSgj5LKanKLFjN+0ockOcv+vfcIZ/uGuH/rUxS21IMkyFlaqhUXetef//E7XzgwuWI6xLSqlnx36b0s8payyFuK5vaQnV9IXvESPNl3OQoPXrrC0df2UV5Sw3D3XuKBEACqYVDb+rQoX7WmxJOV/StQkAJg/gpP/E1OURFLl9dgFOQTufwPCAFCoCoqDzW1iGW1q0uM3Lyh2wKQSnJVOdUdmwFQVYWyh1cTj0Tuu2MAViJJPBRO+/ttBzDHzjH2+cCdAZA9GtFAEMs0iQYCuDya7ZoFBcgt85JTeQ8f7dlFyeMP4ikqsF3jsnVkICFJtPa/SzIaR9YUrsXMuQO4s7I5c3yE8VEfVycuwYUxAuN/poq9cZ3epLBpYY5PkK1nZw5Qv2ETF8+MYZkmUJO2wKySYFlZKd6KyswBVLcHb0Ulpmm/jbMySBKKlv4wpgXwDQ9y6tjXuD36nMOFEETCYarWNFL1WFNmAP4/LrC/7xB19Q1zBogl4fDgCO/vfT2tx3YKQsEgz7Q2kUwkMgqXXS56vxiy9dkC6IbBx70HiUYiGQFobje6bswfAKB48ZKMwq8rlrT32ALE43E+/GAfsWg0o3BV09iyfYetz/YqtixrTqNomiaWZdn6bHdAVVW6d+7KKHz0Nx8PLF+xMC0ACExOkkjOPgW6bqD+/57c2PwEpy9ecVLa2Riub6wjYjMFm57v4NU33wLIqGVTAKvaNn4iu5Semw26YTBy4qSjYolEYur1nEwmSTpowdQhVDVPzFHKLBo40Ef72gZi8RjNDbUMH/nSds3UDoz0f7a9bOUjyK6ZXQkFg3R1bCYSnb0Fre0b6HxxB6FQkNHdPra91MPaljYOD444AwBLwK1joxsGO1/ZTSSc/mEJUFbx30O3o7OL57ZsRVGU+U2BrCj0fbqf7789Zl8F+OWnE7d8FzPh1OlzyEr6v5RpAVY+2c75n3/g7F/HHQGkkyRJVDc1OwKYcXFl5eaxonHdvMJTa2abp55zmq4fSMTibUKkOAgLJiEQuDTD+Cro97cC/AsmbDT6SzEb4wAAAABJRU5ErkJggg==';

    const tryInjectButton = () => {
      if (downloadInProgress) return;
      if (downloadLink?.isConnected) return;

      const lbl = document.getElementById('ImageViewer1_lblPageNum');
      if (!lbl || !/\d+\s+of\s+\d+/.test(lbl.textContent)) return;

      const addToBasketCell = document.getElementById('ImageViewer1_TD_AddToBasket');
      if (!addToBasketCell || !addToBasketCell.parentElement) return;

      // Match the existing toolbar buttons exactly: wrap the input in a
      // <table class="ToolBarItem"> (which provides the rounded frame, border,
      // and background) with the same hidden-link + icon-input structure.
      const cell = document.createElement('td');
      cell.id = 'udd-download-cell';
      cell.innerHTML =
        '<table class="ToolBarItem"><tbody><tr>' +
          '<td style="display: none">' +
            '<a href="javascript:void(0)">Download Document</a>' +
          '</td>' +
          '<td>' +
            '<input id="udd-download-btn" name="udd-download-btn" type="submit" value="" ' +
              'title="Download a compiled PDF of all pages" ' +
              'class="cssButtonImgSmall" style="background-image: url(\'' + DOWNLOAD_ICON_URL + '\'); background-size: 16px 16px; background-repeat: no-repeat;" />' +
          '</td>' +
        '</tr></tbody></table>';

      // Insert as the first cell in the toolbar row (before Add to Basket).
      addToBasketCell.parentElement.insertBefore(cell, addToBasketCell);

      const btn = cell.querySelector('#udd-download-btn');
      btn.onclick = (e) => { e.preventDefault(); download(); };
      downloadLink = btn;
    };

    // Trigger an ASP.NET partial-update postback and resolve with the new
    // docImage src once the partial-update has applied. The image viewer's
    // UpdatePanel replaces its entire subtree on each postback, so we cannot
    // hold an element reference across postbacks — we re-query after the
    // PageRequestManager's endRequest event fires.
    const triggerAndCapture = (target) => new Promise((resolve, reject) => {
      const prm = w.Sys.WebForms.PageRequestManager.getInstance();

      let timeoutId = null;
      let observer = null;

      const cleanup = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        if (observer) { observer.disconnect(); observer = null; }
        prm.remove_endRequest(endHandler);
      };

      const endHandler = (sender, args) => {
        if (args.get_error && args.get_error()) {
          const err = args.get_error();
          if (args.set_errorHandled) args.set_errorHandled(true);
          cleanup();
          reject(new Error('Postback error: ' + err.message));
          return;
        }

        const docImage = document.getElementById('ImageViewer1_docImage');
        if (!docImage) {
          cleanup();
          reject(new Error('docImage not found after postback'));
          return;
        }

        console.log('[uslandrecords] endRequest fired for', target, '— docImage.src =', docImage.src);

        const tryResolve = (src) => {
          if (src && !src.includes('loading.gif')) {
            cleanup();
            resolve(src);
            return true;
          }
          return false;
        };

        if (tryResolve(docImage.src)) return;

        observer = new MutationObserver(() => tryResolve(docImage.src));
        observer.observe(docImage, { attributes: true, attributeFilter: ['src'] });
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for page to load'));
      }, 20000);

      prm.add_endRequest(endHandler);

      console.log('[uslandrecords] Triggering postback:', target);
      try {
        w.__doPostBack(target, '');
      } catch (err) {
        cleanup();
        reject(new Error('__doPostBack failed: ' + err.message));
      }
    });

    const download = async () => {
      const lbl = document.getElementById('ImageViewer1_lblPageNum');
      const m = lbl?.textContent.match(/(\d+)\s+of\s+(\d+)/);
      if (!m) {
        alert('No document is currently loaded in the image viewer.');
        return;
      }

      downloadInProgress = true;
      try {
        // Read details first so the filename prompt has a useful default. This
        // may briefly switch to the Details tab and back.
        let details = null;
        try {
          details = await ensureDocDetails();
        } catch (err) {
          console.warn('[uslandrecords] Could not read doc details:', err);
        }
        hideOverlay();

        // Re-read page count after potential tab switching, in case the
        // ImageViewer state shifted.
        const lbl2 = document.getElementById('ImageViewer1_lblPageNum');
        const m2 = lbl2?.textContent.match(/(\d+)\s+of\s+(\d+)/) || m;
        const startPage = parseInt(m2[1], 10);
        const totalPages = parseInt(m2[2], 10);

        const defaultName = buildFilename(details);
        let fileName = prompt('Save file as:', defaultName);
        if (!fileName) return;
        if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';

        const docImage = document.getElementById('ImageViewer1_docImage');
        if (!docImage) {
          alert('Image viewer element not found.');
          return;
        }


        const urls = [];

        showOverlay(`Loading page 1 of ${totalPages}...`);
        if (startPage !== 1) {
          urls.push(await triggerAndCapture('ImageViewer1$BtnFirst'));
        } else {
          urls.push(docImage.src);
        }

        for (let i = 2; i <= totalPages; i++) {
          showOverlay(`Loading page ${i} of ${totalPages}...`);
          urls.push(await triggerAndCapture('ImageViewer1$BtnNext'));
        }

        const highResUrls = urls.map(buildHighResUrl);

        showOverlay(`Compiling PDF...`);
        await compilePdf(highResUrls, fileName, {
          onProgress: (n, total) => showOverlay(`Compiling page ${n} of ${total}...`),
          greyscale: false,
          jpegQuality: 0.92
        });
      } catch (err) {
        console.error(err);
        alert('Download failed: ' + err.message);
      } finally {
        hideOverlay();
        downloadInProgress = false;
        // The toolbar likely got replaced by partial-updates during the walk;
        // re-inject our button.
        tryInjectButton();
      }
    };

    const setupOnReady = () => {
      if (w.Sys?.WebForms?.PageRequestManager) {
        const prm = w.Sys.WebForms.PageRequestManager.getInstance();
        prm.add_endRequest(() => tryInjectButton());
        tryInjectButton();
        console.log('Public Records Downloader is running (uslandrecords.com)');
      } else {
        setTimeout(setupOnReady, 500);
      }
    };

    setupOnReady();
  }
};

// ============================================================
// CountyFusion adapter (countyfusionNN.govos.com)
// ============================================================
//
// CountyFusion is a frame-heavy Struts app. The document image viewer lives in
// its own frame (search/InstrumentImageViewInternal.jsp), so this adapter only
// activates inside that frame and no-ops everywhere else on the host.
//
// Page images are served statefully: the server session tracks the current
// instrument (set when the document is opened) and the current page.
//   GET /countyweb/imageViewer/getPage.do?pageNumber=N&instnum=<instId>...
//     -> {"numberOfPages": T, "status": "success"}   (selects page N)
//   GET /countyweb/viewImagePNG.do?instnum=<instId>&isPreview=false&ver=<nonce>
//     -> PNG of whichever page was last selected
// The instnum param is echoed but not honoured; the session decides. Pages
// therefore have to be fetched strictly in sequence, which compilePdf supports
// via per-page fetch functions.

const countyfusionAdapter = {
  match(hostname) {
    return /\.govos\.com$/.test(hostname);
  },

  init() {
    if (!/\/InstrumentImageView/i.test(window.location.pathname)) return;

    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const params = new URLSearchParams(window.location.search);
    const instId = params.get('instId');
    const instNum = (params.get('instNum') || '').trim();
    if (!instId) return;

    let downloadButton = null;
    let downloadInProgress = false;

    const getPageUrl = (n) =>
      '/countyweb/imageViewer/getPage.do?addWatermarks=false&isPreview=false&instnum=' +
      encodeURIComponent(instId) + '&pageNumber=' + n;

    const imageUrl = () =>
      '/countyweb/viewImagePNG.do?isPreview=false&instnum=' + encodeURIComponent(instId) +
      '&ver=' + Date.now() + Math.floor(Math.random() * 1000);

    // Select page n server-side. Resolves with the page count.
    const selectPage = async (n) => {
      const response = await fetchWithTimeout(getPageUrl(n), { credentials: 'include' });
      if (!response.ok) throw new Error("getPage HTTP " + response.status);
      const data = await response.json();
      if (data.status !== 'success') throw new Error("getPage failed for page " + n);
      return data.numberOfPages;
    };

    const fetchCurrentImage = async () => {
      const response = await fetchWithTimeout(imageUrl(), { credentials: 'include' });
      if (!response.ok) throw new Error("image HTTP " + response.status);
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error("image endpoint returned " + (type || 'no content-type'));
      return response.blob();
    };

    // Document details live in a sibling frame (docInfoFrame) rendered as
    // label/value table rows. Returns {} when unavailable, e.g. in the
    // pop-out viewer window, which has no parent frames.
    const readDocDetails = () => {
      const details = {};
      let doc = null;
      try { doc = window.parent?.frames?.['docInfoFrame']?.document; } catch (e) { /* cross-origin or absent */ }
      if (!doc) return details;

      const labels = { 'reception no': 'docNumber', 'instrument no': 'docNumber', 'document no': 'docNumber', 'book': 'book', 'page': 'page', 'volume': 'volume', 'doc description': 'typeDesc' };
      for (const td of doc.querySelectorAll('td')) {
        const label = td.textContent.trim().replace(/:$/, '').toLowerCase();
        const key = labels[label];
        if (!key || details[key]) continue;
        const value = td.nextElementSibling?.textContent.trim();
        if (value) details[key] = value;
      }
      return details;
    };

    // "LeaNM" (from the top window title "… LeaNM County" or a countyname=
    // query param) -> { county: 'Lea', state: 'NM' }.
    const parseCountyState = () => {
      let raw = '';
      try {
        raw = new URLSearchParams(window.top.location.search).get('countyname') || '';
        if (!raw) raw = (window.top.document.title.match(/(\S+)\s+County/i) || [])[1] || '';
      } catch (e) { /* pop-out window or cross-origin */ }
      const m = raw.match(/^(.*?)([A-Z]{2})$/);
      if (!m) return { county: '', state: '' };
      return { county: m[1].replace(/([A-Z])/g, ' $1').trim(), state: m[2] };
    };

    // Same shape as the other adapters: "<docNum>_V<book> P<page>_<County> <ST>.pdf"
    const buildFilename = (details) => {
      const parts = [];
      const docNumber = details.docNumber || instNum;
      if (docNumber) parts.push(docNumber);
      if (details.book && details.page) {
        const vol = String(parseInt(details.book, 10) || details.book);
        parts.push('V' + vol + ' P' + details.page);
      }
      const { county, state } = parseCountyState();
      if (county && state) parts.push(county + ' ' + state);
      return (parts.length ? parts.join('_') : 'document') + '.pdf';
    };

    const download = async () => {
      if (downloadInProgress) return;
      downloadInProgress = true;
      const startPage = Number(w.pageNumber) || 1;

      try {
        showOverlay('Reading document...');
        const total = await selectPage(1);
        if (!total || total < 1) throw new Error("Could not determine page count");

        const fileName = prompt("Save file as:", buildFilename(readDocDetails()));
        if (!fileName) return;
        const finalName = fileName.toLowerCase().endsWith('.pdf') ? fileName : fileName + '.pdf';

        const pages = [];
        for (let n = 1; n <= total; n++) {
          pages.push(async () => {
            await selectPage(n);
            return fetchCurrentImage();
          });
        }

        await compilePdf(pages, finalName, {
          onProgress: (n, t) => showOverlay(`Compiling page ${n} of ${t}...`)
        });
      } catch (err) {
        console.error('[countyfusion] download failed:', err);
        alert('Download failed: ' + err.message);
      } finally {
        // Put the server-side page pointer back where the viewer thinks it is.
        try { await selectPage(startPage); } catch (e) { /* best-effort */ }
        hideOverlay();
        downloadInProgress = false;
      }
    };

    const tryInjectButton = () => {
      if (downloadButton?.isConnected) return;
      const toolbar = document.getElementById('toolBarButtons');
      if (!toolbar) return;

      // Mirror the rendered EasyUI linkbutton structure so the button matches
      // the viewer's own toolbar (Font Awesome is already loaded by the page).
      downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.id = 'udd-download-btn';
      downloadButton.title = 'Download a compiled PDF of all pages';
      downloadButton.setAttribute('aria-label', 'Download PDF');
      downloadButton.className = 'buttonsize l-btn l-btn-small';
      downloadButton.style.background = '#43966a';
      downloadButton.innerHTML =
        '<span class="l-btn-left l-btn-icon-left">' +
          '<span class="l-btn-text l-btn-empty">&nbsp;</span>' +
          '<span class="l-btn-icon fa fa-download fa-lg" style="color: white;">&nbsp;</span>' +
        '</span>';
      downloadButton.onclick = (e) => { e.preventDefault(); download(); };

      const spacer = document.createElement('span');
      spacer.className = 'buttonspacer';
      spacer.style.display = 'inline-block';

      toolbar.appendChild(spacer);
      toolbar.appendChild(downloadButton);
      console.log('[countyfusion] Download button added');
    };

    tryInjectButton();
    new MutationObserver(tryInjectButton).observe(document.documentElement, { childList: true, subtree: true });
  }
};

// ============================================================
// Dispatch
// ============================================================

const adapters = [govosAdapter, uslandrecordsAdapter, countyfusionAdapter];
const adapter = adapters.find(a => a.match(window.location.hostname));
if (adapter) {
  adapter.init();
}
