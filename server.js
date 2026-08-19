require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const multer = require("multer");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// Render runs the app behind a reverse proxy.
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

// Make sure our persistent directories exist.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --------------------------------------------------
// Database
// --------------------------------------------------

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

// --------------------------------------------------
// Express configuration
// --------------------------------------------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------------------------------------------------
// Sessions
// --------------------------------------------------

app.use(
  session({
    store: new SQLiteStore({
      dir: DATA_DIR,
      db: "sessions.sqlite"
    }),

    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    proxy: true,

    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// --------------------------------------------------
// Static files
// --------------------------------------------------

// Uploaded listing images.
app.use("/uploads", express.static(UPLOAD_DIR));

// Everything inside public/ is available from the site root.
//
// public/style.css       -> /style.css
// public/images/foo.svg  -> /images/foo.svg
app.use(express.static(path.join(__dirname, "public")));

// Browsers sometimes request /favicon.ico automatically.
app.get("/favicon.ico", (req, res) => {
  res.redirect("/images/favicon.svg");
});

// --------------------------------------------------
// Image uploads
// --------------------------------------------------

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

// --------------------------------------------------
// Authentication middleware
// --------------------------------------------------

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) {
    return next();
  }

  res.redirect("/admin/login");
}

// --------------------------------------------------
// Public pages
// --------------------------------------------------

app.get("/", (req, res) => {
  const listings = db
    .prepare(`
      SELECT *
      FROM listings
      WHERE active = 1
      ORDER BY created_at DESC
    `)
    .all();

  res.render("index", {
    listings
  });
});

app.get("/item/:id", (req, res) => {
  const listing = db
    .prepare(`
      SELECT *
      FROM listings
      WHERE id = ? AND active = 1
    `)
    .get(req.params.id);

  if (!listing) {
    return res.status(404).send("Item not found");
  }

  res.render("listing", {
    listing
  });
});

// --------------------------------------------------
// Login
// --------------------------------------------------

app.get("/admin/login", (req, res) => {
  if (req.session && req.session.authenticated === true) {
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

  // Explicitly persist the session before redirecting.
  req.session.save((err) => {
    if (err) {
      console.error("Session save failed:", err);

      return res
        .status(500)
        .send("Could not create login session.");
    }

    res.redirect("/admin");
  });
});

app.post("/admin/logout", requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destroy failed:", err);
    }

    res.redirect("/");
  });
});

// --------------------------------------------------
// Admin dashboard
// --------------------------------------------------

app.get("/admin", requireAuth, (req, res) => {
  const listings = db
    .prepare(`
      SELECT *
      FROM listings
      ORDER BY active DESC, created_at DESC
    `)
    .all();

  res.render("admin", {
    listings
  });
});

// --------------------------------------------------
// Create listing
// --------------------------------------------------

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

// --------------------------------------------------
// Edit listing page
// --------------------------------------------------

app.get("/admin/listings/:id/edit", requireAuth, (req, res) => {
  const listing = db
    .prepare(`
      SELECT *
      FROM listings
      WHERE id = ?
    `)
    .get(req.params.id);

  if (!listing) {
    return res.status(404).send("Item not found");
  }

  res.render("edit", {
    listing
  });
});

// --------------------------------------------------
// Save edited listing
// --------------------------------------------------

app.post(
  "/admin/listings/:id/edit",
  requireAuth,
  upload.single("image"),
  (req, res) => {
    const existing = db
      .prepare(`
        SELECT *
        FROM listings
        WHERE id = ?
      `)
      .get(req.params.id);

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

    if (!name || !name.trim()) {
      return res.status(400).send("Name is required.");
    }

    let image = existing.image;

    // If a new image was uploaded, remove the old one.
    if (req.file) {
      image = req.file.filename;

      if (existing.image) {
        const oldPath = path.join(
          UPLOAD_DIR,
          existing.image
        );

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

// --------------------------------------------------
// Unlist
// --------------------------------------------------

app.post(
  "/admin/listings/:id/unlist",
  requireAuth,
  (req, res) => {
    db.prepare(`
      UPDATE listings
      SET
        active = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    res.redirect("/admin");
  }
);

// --------------------------------------------------
// Relist
// --------------------------------------------------

app.post(
  "/admin/listings/:id/relist",
  requireAuth,
  (req, res) => {
    db.prepare(`
      UPDATE listings
      SET
        active = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    res.redirect("/admin");
  }
);

// --------------------------------------------------
// Error handling
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    return res.status(400).send(err.message);
  }

  res.status(500).send("Something went wrong.");
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `My Stuff is running on port ${PORT}`
  );

  console.log(
    `Data directory: ${DATA_DIR}`
  );
});