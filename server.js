require("dotenv").config();

const crypto = require("crypto");
const path = require("path");

const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const connectMongo = require("connect-mongo");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const AppConfig = require("./src/models/AppConfig");
const Product = require("./src/models/Product");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/landing_auth_db";
const SESSION_SECRET = process.env.SESSION_SECRET || "replace-this-session-secret";
const MongoStore = connectMongo.default || connectMongo.MongoStore || connectMongo;

const defaultProducts = [
  { name: "Sender", category: "tools", url: "https://example.com/sender", isDefault: true },
  { name: "Shortlink", category: "tools", url: "https://example.com/shortlink", isDefault: true },
  { name: "Validator", category: "tools", url: "https://example.com/validator", isDefault: true },
  { name: "Xfinity", category: "script", url: "https://example.com/xfinity", isDefault: true },
  { name: "Chase", category: "script", url: "https://example.com/chase", isDefault: true },
  { name: "TopperPay", category: "script", url: "https://example.com/topperpay", isDefault: true }
];

function requireMasterAccess(req, res, next) {
  if (req.session.masterAccessGranted) return next();
  return res.redirect("/setup-key");
}

async function ensureMasterKey() {
  let config = await AppConfig.findOne({ key: "global_master_access" });
  if (!config) {
    config = new AppConfig({ key: "global_master_access" });
  }

  if (!config.masterKeyHash) {
    const generatedKey = crypto.randomBytes(24).toString("hex");
    const keyHash = await bcrypt.hash(generatedKey, 12);
    config.masterKeyHash = keyHash;
    await config.save();
    console.log("====================================================");
    console.log("MASTER KEY (hanya tampil 1x saat pertama startup):");
    console.log(generatedKey);
    console.log("Simpan key ini dengan aman.");
    console.log("====================================================");
  } else {
    await config.save();
  }
}

async function ensureDefaultProducts() {
  const ops = defaultProducts.map((item) => ({
    updateOne: {
      filter: { name: item.name, category: item.category, isDefault: true },
      update: { $setOnInsert: item },
      upsert: true
    }
  }));

  if (ops.length > 0) {
    await Product.bulkWrite(ops);
  }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 150,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    },
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: "sessions"
    })
  })
);

app.use((req, res, next) => {
  res.locals.masterAccessGranted = Boolean(req.session.masterAccessGranted);
  next();
});

app.get("/", async (req, res) => {
  const products = await Product.find().sort({ category: 1, createdAt: 1 }).lean();
  const tools = products.filter((p) => p.category === "tools");
  const scripts = products.filter((p) => p.category === "script");

  res.render("landing", {
    tools,
    scripts
  });
});

app.get("/setup-key", async (req, res) => {
  res.render("setup-key", { error: null, success: null });
});

app.post("/setup-key", async (req, res) => {
  const { masterKey } = req.body;
  const config = await AppConfig.findOne({ key: "global_master_access" }).lean();
  if (!config || !config.masterKeyHash) {
    return res.status(500).render("setup-key", {
      error: "Master key belum siap. Restart server dan coba lagi.",
      success: null
    });
  }

  const isMatch = await bcrypt.compare(masterKey || "", config.masterKeyHash);
  if (!isMatch) {
    return res.status(401).render("setup-key", {
      error: "Master key salah.",
      success: null
    });
  }

  req.session.masterAccessGranted = true;
  return res.redirect("/panel");
});

app.get("/panel", requireMasterAccess, async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).lean();
  res.render("dashboard", { products, error: null, success: null });
});

app.post("/products", requireMasterAccess, async (req, res) => {
  const { name, category, url } = req.body;
  if (!name || !url || !["tools", "script"].includes(category)) {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    return res.status(400).render("dashboard", {
      products,
      error: "Data product tidak valid.",
      success: null
    });
  }

  await Product.create({
    name: name.trim(),
    category,
    url: url.trim(),
    isDefault: false
  });

  const products = await Product.find().sort({ createdAt: -1 }).lean();
  return res.render("dashboard", {
    products,
    error: null,
    success: "Product berhasil ditambahkan."
  });
});

app.post("/logout", (req, res) => {
  req.session.masterAccessGranted = false;
  return res.redirect("/");
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).send("Terjadi error pada server.");
});

async function start() {
  await mongoose.connect(MONGO_URI);
  await ensureMasterKey();
  await ensureDefaultProducts();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Gagal menjalankan server:", err);
  process.exit(1);
});
