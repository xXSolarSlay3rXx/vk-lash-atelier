const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "store.json");
const databaseUrl = process.env.DATABASE_URL;

let pool = null;
let backend = "json";

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

function defaultData() {
  return {
    settings: {
      businessName: "VK Lash Atelier",
      tagline: "Elegante Wimpernlooks. Ruhige Studio-Aesthetik. Edle Online-Buchung.",
      serviceName: "Lash Appointment",
      slotDurationMinutes: 90,
      contactPhone: "+49 170 0000000",
      contactEmail: "hello@vk-lash-atelier.de",
      address: "Musterstrasse 12, 12345 Musterstadt",
      calendarSecret: crypto.randomBytes(18).toString("hex")
    },
    admin: {
      email: "admin@vk-lash-atelier.de",
      passwordHash: hashPassword("change-me-now")
    },
    availability: [],
    bookings: []
  };
}

function ensureFile() {
  ensureDir();
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData(), null, 2), "utf8");
  }
}

function readJsonState() {
  ensureFile();
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeJsonState(data) {
  ensureDir();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8");
}

function createPool() {
  if (!databaseUrl) {
    return null;
  }

  const usesSsl =
    process.env.DATABASE_SSL === "true" ||
    /^postgres(ql)?:\/\/.*supabase\./i.test(databaseUrl) ||
    /^postgres(ql)?:\/\/.*render\.com/i.test(databaseUrl);

  return new Pool({
    connectionString: databaseUrl,
    ssl: usesSsl ? { rejectUnauthorized: false } : false
  });
}

async function initDatabase() {
  pool = createPool();
  if (!pool) {
    backend = "json";
    ensureFile();
    return backend;
  }

  backend = "postgres";

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY,
      business_name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      service_name TEXT NOT NULL,
      slot_duration_minutes INTEGER NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      address TEXT NOT NULL,
      calendar_secret TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability (
      date TEXT PRIMARY KEY,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      slot_duration_minutes INTEGER NOT NULL,
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const state = fs.existsSync(dataFile) ? readJsonState() : defaultData();

  await pool.query(
    `
      INSERT INTO app_settings (
        id, business_name, tagline, service_name, slot_duration_minutes,
        contact_phone, contact_email, address, calendar_secret
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      state.settings.businessName,
      state.settings.tagline,
      state.settings.serviceName,
      state.settings.slotDurationMinutes,
      state.settings.contactPhone,
      state.settings.contactEmail,
      state.settings.address,
      state.settings.calendarSecret
    ]
  );

  await pool.query(
    `
      INSERT INTO admins (id, email, password_hash)
      VALUES (1, $1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [state.admin.email, state.admin.passwordHash]
  );

  const availabilityCount = await pool.query("SELECT COUNT(*)::int AS count FROM availability");
  if (availabilityCount.rows[0].count === 0 && state.availability.length > 0) {
    for (const item of state.availability) {
      await pool.query(
        `
          INSERT INTO availability (date, start_time, end_time, slot_duration_minutes, is_blocked)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (date) DO NOTHING
        `,
        [item.date, item.startTime, item.endTime, item.slotDurationMinutes, item.isBlocked]
      );
    }
  }

  const bookingsCount = await pool.query("SELECT COUNT(*)::int AS count FROM bookings");
  if (bookingsCount.rows[0].count === 0 && state.bookings.length > 0) {
    for (const booking of state.bookings) {
      await pool.query(
        `
          INSERT INTO bookings (
            id, customer_name, customer_phone, note, date, start_time, end_time, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          booking.id,
          booking.customerName,
          booking.customerPhone,
          booking.note || "",
          booking.date,
          booking.startTime,
          booking.endTime,
          booking.createdAt
        ]
      );
    }
  }

  return backend;
}

async function getPostgresState() {
  const settingsResult = await pool.query("SELECT * FROM app_settings WHERE id = 1");
  const adminResult = await pool.query("SELECT * FROM admins WHERE id = 1");
  const availabilityResult = await pool.query("SELECT * FROM availability ORDER BY date ASC");
  const bookingsResult = await pool.query("SELECT * FROM bookings ORDER BY date ASC, start_time ASC");

  const settingsRow = settingsResult.rows[0];
  const adminRow = adminResult.rows[0];

  return {
    settings: {
      businessName: settingsRow.business_name,
      tagline: settingsRow.tagline,
      serviceName: settingsRow.service_name,
      slotDurationMinutes: Number(settingsRow.slot_duration_minutes),
      contactPhone: settingsRow.contact_phone,
      contactEmail: settingsRow.contact_email,
      address: settingsRow.address,
      calendarSecret: settingsRow.calendar_secret
    },
    admin: {
      email: adminRow.email,
      passwordHash: adminRow.password_hash
    },
    availability: availabilityResult.rows.map((row) => ({
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      slotDurationMinutes: Number(row.slot_duration_minutes),
      isBlocked: row.is_blocked
    })),
    bookings: bookingsResult.rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      note: row.note,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      createdAt: row.created_at
    }))
  };
}

async function writePostgresState(state) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE app_settings
        SET business_name = $1,
            tagline = $2,
            service_name = $3,
            slot_duration_minutes = $4,
            contact_phone = $5,
            contact_email = $6,
            address = $7,
            calendar_secret = $8
        WHERE id = 1
      `,
      [
        state.settings.businessName,
        state.settings.tagline,
        state.settings.serviceName,
        state.settings.slotDurationMinutes,
        state.settings.contactPhone,
        state.settings.contactEmail,
        state.settings.address,
        state.settings.calendarSecret
      ]
    );

    await client.query(
      `
        UPDATE admins
        SET email = $1,
            password_hash = $2
        WHERE id = 1
      `,
      [state.admin.email, state.admin.passwordHash]
    );

    await client.query("DELETE FROM availability");
    for (const item of state.availability) {
      await client.query(
        `
          INSERT INTO availability (date, start_time, end_time, slot_duration_minutes, is_blocked)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [item.date, item.startTime, item.endTime, item.slotDurationMinutes, item.isBlocked]
      );
    }

    await client.query("DELETE FROM bookings");
    for (const booking of state.bookings) {
      await client.query(
        `
          INSERT INTO bookings (
            id, customer_name, customer_phone, note, date, start_time, end_time, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          booking.id,
          booking.customerName,
          booking.customerPhone,
          booking.note || "",
          booking.date,
          booking.startTime,
          booking.endTime,
          booking.createdAt
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getState() {
  if (backend === "postgres") {
    return getPostgresState();
  }
  return readJsonState();
}

async function updateState(mutator) {
  const state = await getState();
  const next = (await mutator(state)) || state;

  if (backend === "postgres") {
    await writePostgresState(next);
  } else {
    writeJsonState(next);
  }

  return next;
}

function getBackend() {
  return backend;
}

module.exports = {
  initDatabase,
  getState,
  updateState,
  getBackend,
  hashPassword,
  verifyPassword,
  dataFile
};
