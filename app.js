let listings = [];
let selectedCategory = "All";
let searchTerm = "";

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const response = await fetch("listings.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Could not load listings.json");
    }

    listings = await response.json();

    const listingId = new URLSearchParams(window.location.search).get("id");

    if (listingId) {
      renderListingPage(listingId);
    } else {
      initializeCatalog();
    }

  } catch (error) {
    console.error(error);

    const container =
      document.getElementById("listings") ||
      document.getElementById("listing-container");

    if (container) {
      container.innerHTML = `
        <div class="error-message">
          <h2>Something went wrong</h2>
          <p>We couldn't load the listings.</p>
        </div>
      `;
    }
  }
});


/* --------------------------------
   Catalog
-------------------------------- */

function initializeCatalog() {
  const search = document.getElementById("search");

  if (search) {
    search.addEventListener("input", () => {
      searchTerm = search.value.trim().toLowerCase();
      renderCatalog();
    });
  }

  renderCategories();
  renderCatalog();
}


function getActiveListings() {
  return listings.filter(listing => listing.active !== false);
}


function getCategories() {
  const categories = new Set();

  getActiveListings().forEach(listing => {
    if (Array.isArray(listing.categories)) {
      listing.categories.forEach(category => {
        categories.add(category);
      });
    }
  });

  return [...categories].sort((a, b) =>
    a.localeCompare(b)
  );
}


function renderCategories() {
  const container = document.getElementById("category-filters");

  if (!container) {
    return;
  }

  const categories = getCategories();

  container.innerHTML = "";

  const allButton = createCategoryButton("All");

  container.appendChild(allButton);

  categories.forEach(category => {
    container.appendChild(
      createCategoryButton(category)
    );
  });
}


function createCategoryButton(category) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "category-button";

  if (category === selectedCategory) {
    button.classList.add("selected");
  }

  button.textContent = category;

  button.addEventListener("click", () => {
    selectedCategory = category;

    renderCategories();
    renderCatalog();
  });

  return button;
}


function renderCatalog() {
  const container = document.getElementById("listings");
  const count = document.getElementById("listing-count");
  const empty = document.getElementById("empty-state");

  if (!container) {
    return;
  }

  let filtered = getActiveListings();

  if (selectedCategory !== "All") {
    filtered = filtered.filter(listing =>
      Array.isArray(listing.categories) &&
      listing.categories.includes(selectedCategory)
    );
  }

  if (searchTerm) {
    filtered = filtered.filter(listing => {
      const searchable = [
        listing.name,
        listing.description,
        listing.condition,
        ...(listing.categories || []),
        ...(listing.labels || [])
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(searchTerm);
    });
  }

  count.textContent =
    `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;

  container.innerHTML = "";

  if (filtered.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  filtered.forEach(listing => {
    container.appendChild(createListingCard(listing));
  });
}


function createListingCard(listing) {
  const card = document.createElement("a");

  card.className = "listing-card";
  card.href =
    `listing.html?id=${encodeURIComponent(listing.id)}`;

  const image =
    Array.isArray(listing.images) &&
    listing.images.length > 0
      ? listing.images[0]
      : null;

  const imageHTML = image
    ? `
      <div class="card-image">
        <img
          src="${escapeAttribute(image)}"
          alt="${escapeAttribute(listing.name)}"
          loading="lazy"
        >
      </div>
    `
    : `
      <div class="card-image card-image-empty">
        No photo
      </div>
    `;

  const labels = (listing.labels || [])
    .map(label => `
      <span class="label">
        ${escapeHTML(label)}
      </span>
    `)
    .join("");

  const categories = (listing.categories || [])
    .map(category => `
      <span class="category-tag">
        ${escapeHTML(category)}
      </span>
    `)
    .join("");

  const price = formatPrice(listing.askingPrice);

  const originalPrice =
    listing.originalPrice != null &&
    listing.originalPrice > listing.askingPrice
      ? `
        <span class="original-price">
          ${formatPrice(listing.originalPrice)}
        </span>
      `
      : "";

  card.innerHTML = `
    ${imageHTML}

    <div class="card-content">

      <div class="card-labels">
        ${labels}
      </div>

      <h3>${escapeHTML(listing.name)}</h3>

      <div class="card-price">
        ${price}
        ${originalPrice}
      </div>

      <div class="card-meta">
        <span>${escapeHTML(listing.condition || "")}</span>
        <span>·</span>
        <span>
          ${listing.quantity || 1}
          available
        </span>
      </div>

      <div class="card-categories">
        ${categories}
      </div>

    </div>
  `;

  return card;
}


/* --------------------------------
   Individual listing
-------------------------------- */

function renderListingPage(id) {
  const container =
    document.getElementById("listing-container");

  const listing = listings.find(item =>
    item.id === id && item.active !== false
  );

  if (!listing) {
    document.title = "Item Not Found · My Stuff";

    container.innerHTML = `
      <div class="not-found">
        <p class="eyebrow">404</p>
        <h1>Item not found</h1>
        <p>
          This item may have already been sold or removed.
        </p>
        <a class="button button-primary" href="index.html">
          Back to listings
        </a>
      </div>
    `;

    return;
  }

  document.title =
    `${listing.name} · My Stuff`;

  const images =
    Array.isArray(listing.images)
      ? listing.images
      : [];

  const categories = (listing.categories || [])
    .map(category => `
      <span class="category-tag">
        ${escapeHTML(category)}
      </span>
    `)
    .join("");

  const labels = (listing.labels || [])
    .map(label => `
      <span class="label">
        ${escapeHTML(label)}
      </span>
    `)
    .join("");

  const originalPrice =
    listing.originalPrice != null &&
    listing.originalPrice > listing.askingPrice
      ? `
        <span class="detail-original-price">
          ${formatPrice(listing.originalPrice)}
        </span>
      `
      : "";

  container.innerHTML = `
    <div class="detail-layout">

      <section class="gallery">

        <div class="gallery-main">
          ${
            images.length
              ? `
                <img
                  id="gallery-main-image"
                  src="${escapeAttribute(images[0])}"
                  alt="${escapeAttribute(listing.name)}"
                >
              `
              : `
                <div class="gallery-empty">
                  No photo available
                </div>
              `
          }
        </div>

        ${
          images.length > 1
            ? `
              <div class="gallery-thumbnails">
                ${images.map((image, index) => `
                  <button
                    type="button"
                    class="gallery-thumbnail ${index === 0 ? "selected" : ""}"
                    data-image="${escapeAttribute(image)}"
                  >
                    <img
                      src="${escapeAttribute(image)}"
                      alt="${escapeAttribute(listing.name)} photo ${index + 1}"
                    >
                  </button>
                `).join("")}
              </div>
            `
            : ""
        }

      </section>

      <section class="detail-info">

        <div class="detail-labels">
          ${labels}
        </div>

        <div class="detail-categories">
          ${categories}
        </div>

        <h1>${escapeHTML(listing.name)}</h1>

        <div class="detail-price">
          ${formatPrice(listing.askingPrice)}
          ${originalPrice}
        </div>

        <div class="detail-facts">

          <div>
            <span>Condition</span>
            <strong>
              ${escapeHTML(listing.condition || "Not specified")}
            </strong>
          </div>

          <div>
            <span>Quantity</span>
            <strong>
              ${listing.quantity || 1}
            </strong>
          </div>

        </div>

        <div class="detail-description">
          ${formatDescription(listing.description)}
        </div>

        <div class="detail-actions">
          <a
            class="button button-primary"
            href="index.html"
          >
            ← Back to all items
          </a>
        </div>

      </section>

    </div>
  `;

  initializeGallery();
}


function initializeGallery() {
  const mainImage =
    document.getElementById("gallery-main-image");

  const thumbnails =
    document.querySelectorAll(".gallery-thumbnail");

  if (!mainImage || thumbnails.length === 0) {
    return;
  }

  thumbnails.forEach(thumbnail => {
    thumbnail.addEventListener("click", () => {
      const image =
        thumbnail.dataset.image;

      mainImage.src = image;

      thumbnails.forEach(item =>
        item.classList.remove("selected")
      );

      thumbnail.classList.add("selected");
    });
  });
}


/* --------------------------------
   Helpers
-------------------------------- */

function formatPrice(value) {
  if (value == null || value === "") {
    return "Price TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value));
}


function formatDescription(text) {
  if (!text) {
    return "<p>No description provided.</p>";
  }

  return text
    .split(/\n\s*\n/)
    .map(paragraph =>
      `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}


function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function escapeAttribute(value) {
  return escapeHTML(value);
}