const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this-in-production";

// Use /tmp for Render dynamic file storage to avoid read-only filesystem errors
const DB_PATH = process.env.RENDER ? "/tmp/db.json" : path.join(__dirname, "db.json");
const UPLOADS_DIR = process.env.RENDER ? "/tmp/uploads_data" : path.join(__dirname, "uploads_data");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      users: [], brands: [], churches: [], memberships: [], tags: [],
      tagAssignments: [], gcMessages: [], stories: [], posts: [], likes: [],
      media: [], speakers: [], events: [], threads: [], replies: [],
      groups: [], groupJoins: [], prayerRequests: [], prayerSupports: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {
      users: [], brands: [], churches: [], memberships: [], tags: [],
      tagAssignments: [], gcMessages: [], stories: [], posts: [], likes: [],
      media: [], speakers: [], events: [], threads: [], replies: [],
      groups: [], groupJoins: [], prayerRequests: [], prayerSupports: []
    };
  }
}

let db = loadDb();

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/media", express.static(UPLOADS_DIR));

const upload = multer({ dest: UPLOADS_DIR });

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    is_platform_admin: u.is_platform_admin,
    created_at: u.created_at,
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ detail: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ detail: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

app.get("/", (_req, res) => res.json({ status: "ok", message: "FaithConnect API is running" }));

app.post("/auth/register", (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(422).json({ detail: "name, email, and password are required" });
  }
  if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ detail: "An account with this email already exists" });
  }

  const user = {
    id: id(),
    name,
    email,
    phone: phone || null,
    password_hash: bcrypt.hashSync(password, 10),
    is_platform_admin: db.users.length === 0,
    created_at: now(),
  };
  db.users.push(user);
  save();

  res.status(201).json({ access_token: signToken(user.id), token_type: "bearer" });
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.email.toLowerCase() === String(username).toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(400).json({ detail: "Incorrect email or password" });
  }
  res.json({ access_token: signToken(user.id), token_type: "bearer" });
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

app.listen(PORT, () => {
  console.log(`FaithConnect dev backend running on port ${PORT}`);
  console.log(`Data file: ${DB_PATH}`);
});
