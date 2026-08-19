require("dotenv").config();

const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const multer = require("multer");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "listings.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    original_price REAL,
    asking_price REAL,
    condition TEXT DEFAULT '',
    category TEXT DEFAULT 'Other',
    image TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${crypto.randomUUID()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  }
});

function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }

  res.redirect("/admin/login");
}

function requireMethod(method) {
  return (req, res, next) => {
    if (req.method !== method) {
      return res.status(405).send("Method not allowed");
    }
    next();
  };
}

// -------------------------
// Public pages
// -------------------------

app.get("/", (req, res) => {
  const listings = db.prepare(`
    SELECT *
    FROM listings
    WHERE active = 1
    ORDER BY created_at DESC
  `).all();

  res.render("index", {
    listings
  });
});

app.get("/item/:id", (req, res) => {
  const listing = db.prepare(`
    SELECT *
    FROM listings
    WHERE id = ? AND active = 1
  `).get(req.params.id);

  if (!listing) {
    return res.status(404).send("Item not found");
  }

  res.render("listing", {
    listing
  });
});

// -------------------------
// Authentication
// -------------------------

app.get("/admin/login", (req, res) => {
  if (req.session.authenticated) {
    return res.redirect("/admin");
  }

  res.render("login", {
    error: null
  });
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  const validUsername =
    username === process.env.ADMIN_USERNAME;

  const validPassword =
    password === process.env.ADMIN_PASSWORD;

  if (!validUsername || !validPassword) {
    return res.status(401).render("login", {
      error: "Incorrect username or password."
    });
  }

  req.session.authenticated = true;

  res.redirect("/admin");
});

app.post("/admin/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// -------------------------
// Admin
// -------------------------

app.get("/admin", requireAuth, (req, res) => {
  const listings = db.prepare(`
    SELECT *
    FROM listings
    ORDER BY active DESC, created_at DESC
  `).all();

  res.render("admin", {
    listings
  });
});

app.post(
  "/admin/listings",
  requireAuth,
  upload.single("image"),
  (req, res) => {
    const {
      name,
      description,
      original_price,
      asking_price,
      condition,
      category
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).send("Name is required.");
    }

    const image = req.file ? req.file.filename : null;

    db.prepare(`
      INSERT INTO listings (
        name,
        description,
        original_price,
        asking_price,
        condition,
        category,
        image
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      description || "",
      original_price || null,
      asking_price || null,
      condition || "",
      category || "Other",
      image
    );

    res.redirect("/admin");
  }
);

app.get("/admin/listings/:id/edit", requireAuth, (req, res) => {
  const listing = db.prepare(`
    SELECT *
    FROM listings
    WHERE id = ?
  `).get(req.params.id);

  if (!listing) {
    return res.status(404).send("Item not found");
  }

  res.send(renderEditPage(listing));
});

app.post(
  "/admin/listings/:id/edit",
  requireAuth,
  upload.single("image"),
  (req, res) => {
    const existing = db.prepare(`
      SELECT *
      FROM listings
      WHERE id = ?
    `).get(req.params.id);

    if (!existing) {
      return res.status(404).send("Item not found");
    }

    const {
      name,
      description,
      original_price,
      asking_price,
      condition,
      category
    } = req.body;

    let image = existing.image;

    if (req.file) {
      image = req.file.filename;

      if (existing.image) {
        const oldPath = path.join(UPLOAD_DIR, existing.image);

        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    }

    db.prepare(`
      UPDATE listings
      SET
        name = ?,
        description = ?,
        original_price = ?,
        asking_price = ?,
        condition = ?,
        category = ?,
        image = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name.trim(),
      description || "",
      original_price || null,
      asking_price || null,
      condition || "",
      category || "Other",
      image,
      req.params.id
    );

    res.redirect("/admin");
  }
);

app.post("/admin/listings/:id/unlist", requireAuth, (req, res) => {
  db.prepare(`
    UPDATE listings
    SET active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  res.redirect("/admin");
});

app.post("/admin/listings/:id/relist", requireAuth, (req, res) => {
  db.prepare(`
    UPDATE listings
    SET active = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  res.redirect("/admin");
});

// -------------------------
// Edit page helper
// -------------------------

function renderEditPage(listing) {
  const imageHtml = listing.image
    ? `<img class="edit-preview" src="/uploads/${escapeHtml(listing.image)}" alt="">`
    : "";

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Edit ${escapeHtml(listing.name)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>

<header class="site-header">
  <a href="/admin" class="logo">My Stuff</a>
  <a href="/" class="header-link">View site →</a>
</header>

<main class="admin-page narrow">

  <a class="back-link" href="/admin">← Back to dashboard</a>

  <div class="admin-heading">
    <div>
      <p class="eyebrow">Edit listing</p>
      <h1>${escapeHtml(listing.name)}</h1>
    </div>
  </div>

  <form
    class="listing-form"
    method="POST"
    action="/admin/listings/${listing.id}/edit"
    enctype="multipart/form-data"
  >

    <label>
      Item name
      <input
        name="name"
        value="${escapeAttr(listing.name)}"
        required
      >
    </label>

    <label>
      Description
      <textarea name="description" rows="5">${escapeHtml(listing.description || "")}</textarea>
    </label>

    <div class="form-grid">

      <label>
        Original price
        <input
          type="number"
          step="0.01"
          name="original_price"
          value="${listing.original_price ?? ""}"
        >
      </label>

      <label>
        Asking price
        <input
          type="number"
          step="0.01"
          name="asking_price"
          value="${listing.asking_price ?? ""}"
        >
      </label>

    </div>

    <div class="form-grid">

      <label>
        Condition
        <select name="condition">
          ${conditionOptions(listing.condition)}
        </select>
      </label>

      <label>
        Category
        <select name="category">
          ${categoryOptions(listing.category)}
        </select>
      </label>

    </div>

    ${imageHtml}

    <label>
      Replace image
      <input
        type="file"
        name="image"
        accept="image/jpeg,image/png,image/webp,image/gif"
      >
      <small>Maximum 10 MB.</small>
    </label>

    <button class="button button-primary" type="submit">
      Save changes
    </button>

  </form>

</main>

</body>
</html>
  `;
}

function conditionOptions(selected) {
  const options = [
    "New",
    "Like New",
    "Excellent",
    "Very Good",
    "Good",
    "Fair",
    "For Parts"
  ];

  return options
    .map(option => `
      <option
        value="${escapeAttr(option)}"
        ${option === selected ? "selected" : ""}
      >
        ${escapeHtml(option)}
      </option>
    `)
    .join("");
}

function categoryOptions(selected) {
  const options = [
    "Furniture",
    "Electronics",
    "Kitchen",
    "Clothing",
    "Books",
    "Outdoor",
    "Other"
  ];

  return options
    .map(option => `
      <option
        value="${escapeAttr(option)}"
        ${option === selected ? "selected" : ""}
      >
        ${escapeHtml(option)}
      </option>
    `)
    .join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

// -------------------------
// Error handler
// -------------------------

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    return res.status(400).send(err.message);
  }

  res.status(500).send("Something went wrong.");
});

app.listen(PORT, () => {
  console.log(`My Stuff is running at http://localhost:${PORT}`);
});