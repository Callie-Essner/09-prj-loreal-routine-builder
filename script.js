/* Get references to DOM elements */
const directionToggle = document.getElementById("directionToggle");
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelectedBtn");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");

/* Keys used to save user preferences and selections in localStorage */
const STORAGE_KEY = "lorealSelectedProducts";
const DIRECTION_STORAGE_KEY = "lorealTextDirection";
const RTL_LANGUAGES = new Set(["ar", "arc", "dv", "fa", "ha", "he", "khw", "ks", "ku", "ps", "sd", "ur", "yi"]);

/* Replace this with your deployed Cloudflare Worker URL */
const CLOUDFLARE_WORKER_URL =
  "https://loreal-routine.your-subdomain.workers.dev/";

/* Load saved product selections from localStorage on page load */
function loadSavedSelectedProducts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Could not load saved products from localStorage:", error);
    return [];
  }
}

/* Save the current selectedProducts array to localStorage */
function saveSelectedProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProducts));
  } catch (error) {
    console.warn("Could not save selected products to localStorage:", error);
  }
}

/* Store all loaded products, saved selected products, and expanded descriptions */
let allProducts = [];
let selectedProducts = loadSavedSelectedProducts();
const expandedProductIds = new Set();

/* Apply LTR or RTL direction to the document and update toggle UI */
function applyDirection(dir) {
  const normalizedDir = dir === "rtl" ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", normalizedDir);

  if (directionToggle) {
    const isRtl = normalizedDir === "rtl";
    directionToggle.setAttribute("aria-pressed", String(isRtl));
    directionToggle.setAttribute(
      "aria-label",
      isRtl
        ? "Switch layout direction to left-to-right"
        : "Switch layout direction to right-to-left"
    );
    directionToggle.innerHTML = `
      <i class="fa-solid fa-right-left" aria-hidden="true"></i>
      <span>${isRtl ? "LTR Mode" : "RTL Mode"}</span>
    `;
  }
}

/* Determine initial layout direction from HTML attributes or saved preference */
function initDirection() {
  const htmlLang = (document.documentElement.getAttribute("lang") || "")
    .toLowerCase()
    .split("-")[0];
  const htmlDir = document.documentElement.getAttribute("dir");
  let savedDir = null;

  try {
    savedDir = localStorage.getItem(DIRECTION_STORAGE_KEY);
  } catch {
    savedDir = null;
  }

  if (savedDir === "rtl" || savedDir === "ltr") {
    applyDirection(savedDir);
  } else if (htmlDir === "rtl" || RTL_LANGUAGES.has(htmlLang)) {
    applyDirection("rtl");
  } else {
    applyDirection("ltr");
  }
}

initDirection();

/* Toggle between LTR and RTL mode when the user clicks the header toggle */
if (directionToggle) {
  directionToggle.addEventListener("click", () => {
    const currentDir = document.documentElement.getAttribute("dir");
    const nextDir = currentDir === "rtl" ? "ltr" : "rtl";
    applyDirection(nextDir);

    try {
      localStorage.setItem(DIRECTION_STORAGE_KEY, nextDir);
    } catch (error) {
      console.warn("Could not save direction preference:", error);
    }
  });
}

/* Automatically adapt to RTL if an external translator updates <html lang> */
const htmlObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.attributeName === "lang") {
      const langCode = (document.documentElement.getAttribute("lang") || "")
        .toLowerCase()
        .split("-")[0];
      if (RTL_LANGUAGES.has(langCode)) {
        applyDirection("rtl");
      }
    }
  }
});
htmlObserver.observe(document.documentElement, { attributes: true });

/* Keep the full conversation history for OpenAI (system prompt + user/assistant messages) */
const conversationHistory = [
  {
    role: "system",
    content:
      "You are a L'Oréal skincare, haircare, makeup, fragrance, and beauty advisor. Build clear, personalized step-by-step routines using only the selected products provided by the user, explaining application order and timing (morning, evening, or as needed). For follow-up questions, remember the full conversation and answer ONLY questions related to the user's generated routine or beauty and personal care topics (skincare, haircare, hair color, hair styling, makeup, suncare, fragrance, men's grooming, and L'Oréal products). Respond in the same language the user writes in. If the user asks about anything unrelated to their routine or these beauty topics, politely decline and invite them to ask about their routine or beauty care instead.",
  },
];

/* Store user-friendly messages shown in the chat window */
const chatMessages = [];

/* Announce new chat messages politely to assistive technology */
chatWindow.setAttribute("aria-live", "polite");

/* Show initial placeholder until user selects a category or searches */
function showInitialPlaceholder() {
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      Select a category or type a keyword to view products
    </div>
  `;
}

showInitialPlaceholder();

/* Load product data from JSON file */
async function loadProducts() {
  if (allProducts.length > 0) {
    return allProducts;
  }

  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  return allProducts;
}

/* Check whether a product is currently selected */
function isProductSelected(productId) {
  return selectedProducts.some((product) => product.id === productId);
}

/* Update the Selected Products list in the DOM */
function renderSelectedProducts() {
  /* Only show the Clear All button when at least one product is selected */
  clearSelectedBtn.hidden = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="selected-empty">
        No products selected yet. Click a product card above to add it.
      </p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
    <div class="selected-product-item" data-id="${product.id}">
      <div class="selected-product-text">
        <span class="selected-product-name">${product.name}</span>
        <span class="selected-product-brand">${product.brand}</span>
      </div>
      <button
        type="button"
        class="remove-product-btn"
        data-id="${product.id}"
        aria-label="Remove ${product.name}"
      >
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
  `
    )
    .join("");
}

/* Sync the selected visual state of cards currently shown in the grid */
function syncGridSelectionState() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const productId = Number(card.dataset.id);
    const selected = isProductSelected(productId);
    card.classList.toggle("selected", selected);

    const selectArea = card.querySelector(".product-select-area");
    if (selectArea) {
      selectArea.setAttribute("aria-pressed", String(selected));
    }
  });
}

/* Select or unselect a product by its ID */
function toggleProductSelection(productId) {
  const alreadySelected = isProductSelected(productId);

  if (alreadySelected) {
    /* Remove the product if it is already selected */
    selectedProducts = selectedProducts.filter(
      (product) => product.id !== productId
    );
  } else {
    /* Find the product object and add it to selectedProducts */
    const productToAdd = allProducts.find(
      (product) => product.id === productId
    );
    if (productToAdd) {
      selectedProducts.push(productToAdd);
    }
  }

  saveSelectedProducts();
  syncGridSelectionState();
  renderSelectedProducts();
}

/* Toggle a product's description panel open or closed */
function toggleProductDescription(productId, buttonEl) {
  const descriptionEl = document.getElementById(`product-desc-${productId}`);
  if (!descriptionEl) {
    return;
  }

  const isExpanded = expandedProductIds.has(productId);
  if (isExpanded) {
    expandedProductIds.delete(productId);
    descriptionEl.hidden = true;
    buttonEl.setAttribute("aria-expanded", "false");
    buttonEl.innerHTML = `
      <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
      <span>View Details</span>
    `;
  } else {
    expandedProductIds.add(productId);
    descriptionEl.hidden = false;
    buttonEl.setAttribute("aria-expanded", "true");
    buttonEl.innerHTML = `
      <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
      <span>Hide Details</span>
    `;
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No matching products found. Try a different keyword or category.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const selected = isProductSelected(product.id);
      const expanded = expandedProductIds.has(product.id);
      return `
    <article class="product-card ${selected ? "selected" : ""}" data-id="${product.id}">
      <div
        class="product-select-area"
        tabindex="0"
        role="button"
        aria-pressed="${selected}"
        aria-label="${product.name} by ${product.brand}"
      >
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3>${product.name}</h3>
          <p class="product-brand">${product.brand}</p>
        </div>
      </div>

      <div class="product-card-actions">
        <button
          type="button"
          class="details-toggle-btn"
          data-id="${product.id}"
          aria-expanded="${expanded}"
          aria-controls="product-desc-${product.id}"
        >
          <i class="fa-solid ${expanded ? "fa-chevron-up" : "fa-circle-info"}" aria-hidden="true"></i>
          <span>${expanded ? "Hide Details" : "View Details"}</span>
        </button>
      </div>

      <div
        id="product-desc-${product.id}"
        class="product-description"
        ${expanded ? "" : "hidden"}
      >
        <p>${product.description}</p>
      </div>
    </article>
  `;
    })
    .join("");
}

/* Filter products by both the selected category and the search keyword */
async function filterAndDisplayProducts() {
  const selectedCategory = categoryFilter.value;
  const searchTerm = productSearch.value.trim().toLowerCase();

  /* If neither a category nor a search keyword is active, show the initial prompt */
  if (!selectedCategory && !searchTerm) {
    showInitialPlaceholder();
    return;
  }

  const products = await loadProducts();

  /* Match selected category (or all categories when searching across everything)
     AND match the search keyword against name, brand, category, or description */
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory ||
      selectedCategory === "all" ||
      product.category === selectedCategory;

    const matchesKeyword =
      !searchTerm ||
      product.name.toLowerCase().includes(searchTerm) ||
      product.brand.toLowerCase().includes(searchTerm) ||
      product.category.toLowerCase().includes(searchTerm) ||
      product.description.toLowerCase().includes(searchTerm);

    return matchesCategory && matchesKeyword;
  });

  displayProducts(filteredProducts);
}

/* Update the grid when the category changes or as the user types in the search box */
categoryFilter.addEventListener("change", filterAndDisplayProducts);
productSearch.addEventListener("input", filterAndDisplayProducts);

/* Handle clicks inside the product grid (details toggle vs card selection) */
productsContainer.addEventListener("click", (e) => {
  const detailsBtn = e.target.closest(".details-toggle-btn");
  if (detailsBtn) {
    const productId = Number(detailsBtn.dataset.id);
    toggleProductDescription(productId, detailsBtn);
    return;
  }

  /* Ignore clicks inside the open description text so users can highlight/read text */
  if (e.target.closest(".product-description")) {
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.id);
  toggleProductSelection(productId);
});

/* Allow keyboard selection on product cards with Enter or Space */
productsContainer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") {
    return;
  }

  const selectArea = e.target.closest(".product-select-area");
  if (!selectArea) {
    return;
  }

  e.preventDefault();
  const card = selectArea.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.id);
  toggleProductSelection(productId);
});

/* Remove a product directly from the Selected Products list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-product-btn");
  if (!removeBtn) {
    return;
  }

  const productId = Number(removeBtn.dataset.id);
  selectedProducts = selectedProducts.filter(
    (product) => product.id !== productId
  );

  saveSelectedProducts();
  syncGridSelectionState();
  renderSelectedProducts();
});

/* Clear all selected products at once and update localStorage */
clearSelectedBtn.addEventListener("click", () => {
  selectedProducts = [];
  saveSelectedProducts();
  syncGridSelectionState();
  renderSelectedProducts();
});

/* Render any saved selections loaded from localStorage on page load */
renderSelectedProducts();

/* Escape HTML characters to prevent unsafe HTML injection in chat messages */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Format plain text / basic markdown bold and line breaks for readable chat output */
function formatMessageContent(text) {
  const safeText = escapeHtml(text);
  return safeText
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

/* Render all messages in the chat window */
function renderChatWindow(isLoading = false, loadingText = "Building your personalized routine...") {
  if (chatMessages.length === 0 && !isLoading) {
    chatWindow.innerHTML = `
      <p class="chat-empty">
        Select products above and click <strong>Generate Routine</strong>, then ask follow-up questions about your routine, skincare, haircare, makeup, or fragrance below.
      </p>
    `;
    return;
  }

  const messagesHtml = chatMessages
    .map(
      (msg) => `
    <div class="chat-message ${msg.role}">
      <div class="chat-message-label">
        ${msg.role === "user" ? "You" : msg.role === "error" ? "Notice" : "L'Oréal Advisor"}
      </div>
      <div class="chat-message-body" dir="auto">${formatMessageContent(msg.content)}</div>
    </div>
  `
    )
    .join("");

  const loadingHtml = isLoading
    ? `<div class="chat-loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${escapeHtml(loadingText)}</div>`
    : "";

  chatWindow.innerHTML = `${messagesHtml}${loadingHtml}`;
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Enable or disable routine/chat controls while waiting for the API */
function setRequestInFlight(isBusy) {
  generateRoutineBtn.disabled = isBusy;
  sendBtn.disabled = isBusy;
  userInput.disabled = isBusy;
}

/* Send the conversationHistory array to your Cloudflare Worker endpoint */
async function sendMessagesToWorker() {
  /* Use the configured Cloudflare Worker URL directly, or fall back to /api/chat if still placeholder */
  const isPlaceholderUrl =
    !CLOUDFLARE_WORKER_URL ||
    CLOUDFLARE_WORKER_URL.includes("your-subdomain.workers.dev");
  const endpoint = isPlaceholderUrl ? "/api/chat" : CLOUDFLARE_WORKER_URL;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: conversationHistory,
    }),
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errorMessage =
      (typeof data?.error === "string" && data.error) ||
      data?.error?.message ||
      "Unable to get a response from the Cloudflare Worker.";
    throw new Error(errorMessage);
  }

  /* Extract reply from OpenAI's standard response shape or common Worker formats */
  const reply =
    data?.choices?.[0]?.message?.content ||
    data?.reply ||
    data?.message ||
    data?.response ||
    data?.content ||
    (data === null && rawText.trim() ? rawText.trim() : "");

  if (!reply) {
    throw new Error("Received an empty or invalid response from the Worker.");
  }

  return reply;
}

/* Generate a Personalized Routine from ONLY the selected products */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    chatMessages.push({
      role: "error",
      content: "Please select at least one product above before generating a routine.",
    });
    renderChatWindow();
    return;
  }

  /* Collect only the selected products with their key JSON fields */
  const selectedProductData = selectedProducts.map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));

  /* Display a readable summary in the chat window */
  const productNames = selectedProductData
    .map((product) => `${product.name} (${product.brand})`)
    .join(", ");

  chatMessages.push({
    role: "user",
    content: `Generate a personalized routine for my selected products: ${productNames}`,
  });

  /* Send the full JSON data for each selected product to the OpenAI API */
  const apiPrompt = `Here are the user's selected products in JSON format:\n\n${JSON.stringify(
    selectedProductData,
    null,
    2
  )}\n\nPlease create a personalized step-by-step routine using these products.`;

  conversationHistory.push({
    role: "user",
    content: apiPrompt,
  });

  setRequestInFlight(true);
  renderChatWindow(true, "Generating your personalized L'Oréal routine...");

  try {
    const reply = await sendMessagesToWorker();

    /* Save the assistant's reply so follow-up questions have full context */
    conversationHistory.push({
      role: "assistant",
      content: reply,
    });
    chatMessages.push({
      role: "assistant",
      content: reply,
    });
  } catch (error) {
    /* Remove the unsent/failed prompt from history and show a clear error */
    conversationHistory.pop();
    chatMessages.push({
      role: "error",
      content: error.message,
    });
  } finally {
    setRequestInFlight(false);
    renderChatWindow();
  }
});

/* Chat form submission handler for follow-up questions */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const messageText = userInput.value.trim();
  if (!messageText) {
    return;
  }

  userInput.value = "";
  chatMessages.push({ role: "user", content: messageText });

  /* Push the new user message onto conversationHistory so the API sees the full history */
  conversationHistory.push({ role: "user", content: messageText });

  setRequestInFlight(true);
  renderChatWindow(true, "Thinking...");

  try {
    const reply = await sendMessagesToWorker();

    /* Save the assistant reply to preserve full context for future follow-ups */
    conversationHistory.push({ role: "assistant", content: reply });
    chatMessages.push({ role: "assistant", content: reply });
  } catch (error) {
    /* Remove the failed message so history stays clean if the request errors */
    conversationHistory.pop();
    chatMessages.push({ role: "error", content: error.message });
  } finally {
    setRequestInFlight(false);
    renderChatWindow();
    userInput.focus();
  }
});

/* Show the initial prompt inside the chat window */
renderChatWindow();
