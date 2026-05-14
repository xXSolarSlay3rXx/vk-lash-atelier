const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const {
  initDatabase,
  getState,
  updateState,
  getBackend,
  verifyPassword,
  hashPassword,
  dataFile
} = require("./store");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || "replace-this-session-secret";
const isProduction = process.env.NODE_ENV === "production";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatGermanDate(dateIso) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateIso}T00:00:00`));
}

function formatGermanDateTime(dateIso, time) {
  return `${formatGermanDate(dateIso)} um ${time} Uhr`;
}

function combineDateTime(dateIso, time) {
  return new Date(`${dateIso}T${time}:00`);
}

function toUtcIcs(dateIso, time) {
  const date = combineDateTime(dateIso, time);
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join("") + "T" + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    "00"
  ].join("") + "Z";
}

function plusMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function getAvailabilityMap(data) {
  return new Map(data.availability.map((item) => [item.date, item]));
}

function getBookingMap(data) {
  const map = new Map();
  for (const booking of data.bookings) {
    const key = `${booking.date}|${booking.startTime}`;
    map.set(key, booking);
  }
  return map;
}

function getSlotsForDate(data, dateIso) {
  const settings = data.settings;
  const entry = data.availability.find((item) => item.date === dateIso);
  if (!entry || entry.isBlocked) {
    return [];
  }

  const slots = [];
  const bookingMap = getBookingMap(data);
  const slotDuration = Number(entry.slotDurationMinutes || settings.slotDurationMinutes);
  const totalMinutes = minutesBetween(entry.startTime, entry.endTime);

  for (let offset = 0; offset + slotDuration <= totalMinutes; offset += slotDuration) {
    const startTime = plusMinutes(entry.startTime, offset);
    const endTime = plusMinutes(startTime, slotDuration);
    const isPast = combineDateTime(dateIso, startTime) < new Date();
    const existingBooking = bookingMap.get(`${dateIso}|${startTime}`);

    if (!isPast && !existingBooking) {
      slots.push({
        date: dateIso,
        startTime,
        endTime,
        label: `${startTime} - ${endTime}`
      });
    }
  }

  return slots;
}

function buildPublicCalendar(data, selectedDate) {
  const today = todayIso();
  const dates = [];
  for (let index = 0; index < 45; index += 1) {
    const dateIso = addDays(today, index);
    const slots = getSlotsForDate(data, dateIso);
    if (slots.length > 0) {
      dates.push({
        date: dateIso,
        label: formatGermanDate(dateIso),
        slotCount: slots.length,
        slots
      });
    }
  }

  const activeDate = selectedDate && dates.some((item) => item.date === selectedDate)
    ? selectedDate
    : dates[0]?.date;
  const activeDay = dates.find((item) => item.date === activeDate) || null;

  return { dates, activeDate, activeDay };
}

function requireAdmin(req, res, next) {
  if (!req.session.adminEmail) {
    return res.redirect("/admin/login");
  }
  return next();
}

async function renderPage(res, view, params) {
  const data = await getState();
  return res.render(view, {
    ...params,
    settings: data.settings
  });
}

app.get("/health", (req, res) => {
  return res.status(200).json({ ok: true, backend: getBackend() });
});

app.get("/", async (req, res, next) => {
  try {
    const data = await getState();
    const calendar = buildPublicCalendar(data, req.query.date);
    return res.render("home", {
      settings: data.settings,
      calendar,
      success: req.query.success === "1"
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/book", async (req, res, next) => {
  const { customerName, customerPhone, note, date, startTime } = req.body;

  try {
    if (!customerName || !customerPhone || !date || !startTime) {
      const data = await getState();
      return res.status(400).render("error", {
        settings: data.settings,
        message: "Bitte fuelle Name, Telefonnummer und einen freien Termin aus."
      });
    }

    const data = await getState();
    const validSlot = getSlotsForDate(data, date).find((slot) => slot.startTime === startTime);
    if (!validSlot) {
      return res.status(409).render("error", {
        settings: data.settings,
        message: "Dieser Termin wurde gerade vergeben oder ist nicht mehr verfuegbar."
      });
    }

    await updateState((state) => {
      state.bookings.push({
        id: crypto.randomUUID(),
        customerName,
        customerPhone,
        note: note || "",
        date,
        startTime,
        endTime: validSlot.endTime,
        createdAt: new Date().toISOString()
      });
      return state;
    });

    return res.redirect("/?success=1");
  } catch (error) {
    return next(error);
  }
});

app.get("/admin/login", (req, res) => {
  return renderPage(res, "admin-login", {
    error: null
  });
});

app.post("/admin/login", async (req, res, next) => {
  try {
    const data = await getState();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const matches = email === data.admin.email && verifyPassword(password, data.admin.passwordHash);

    if (!matches) {
      return await renderPage(res, "admin-login", {
        error: "Login fehlgeschlagen. Bitte pruefe E-Mail und Passwort."
      });
    }

    req.session.adminEmail = email;
    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const data = await getState();
    const availability = [...data.availability].sort((a, b) => a.date.localeCompare(b.date));
    const bookings = [...data.bookings].sort((a, b) => {
      const left = `${a.date} ${a.startTime}`;
      const right = `${b.date} ${b.startTime}`;
      return left.localeCompare(right);
    });
    const feedUrl = `${req.protocol}://${req.get("host")}/calendar/${data.settings.calendarSecret}.ics`;

    return res.render("admin-dashboard", {
      settings: data.settings,
      adminEmail: data.admin.email,
      availability,
      bookings,
      feedUrl,
      dataFile,
      formatGermanDate,
      formatGermanDateTime
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/availability", requireAdmin, async (req, res, next) => {
  const { date, startTime, endTime, slotDurationMinutes, isBlocked } = req.body;
  try {
    if (!date) {
      return res.redirect("/admin");
    }

    await updateState((state) => {
      state.availability = state.availability.filter((item) => item.date !== date);
      state.availability.push({
        date,
        startTime: startTime || "09:00",
        endTime: endTime || "18:00",
        slotDurationMinutes: Number(slotDurationMinutes || state.settings.slotDurationMinutes),
        isBlocked: isBlocked === "on"
      });
      return state;
    });

    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/availability/delete", requireAdmin, async (req, res, next) => {
  const { date } = req.body;
  try {
    await updateState((state) => {
      state.availability = state.availability.filter((item) => item.date !== date);
      return state;
    });
    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/bookings/delete", requireAdmin, async (req, res, next) => {
  const { id } = req.body;
  try {
    await updateState((state) => {
      state.bookings = state.bookings.filter((item) => item.id !== id);
      return state;
    });
    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/settings", requireAdmin, async (req, res, next) => {
  try {
    await updateState((state) => {
      state.settings.businessName = String(req.body.businessName || state.settings.businessName).trim();
      state.settings.tagline = String(req.body.tagline || state.settings.tagline).trim();
      state.settings.serviceName = String(req.body.serviceName || state.settings.serviceName).trim();
      state.settings.slotDurationMinutes = Number(req.body.slotDurationMinutes || state.settings.slotDurationMinutes);
      state.settings.contactPhone = String(req.body.contactPhone || "").trim();
      state.settings.contactEmail = String(req.body.contactEmail || "").trim();
      state.settings.address = String(req.body.address || "").trim();

      const nextEmail = String(req.body.adminEmail || state.admin.email).trim().toLowerCase();
      state.admin.email = nextEmail;

      if (req.body.adminPassword) {
        state.admin.passwordHash = hashPassword(String(req.body.adminPassword));
      }

      return state;
    });

    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.get("/calendar/:secret.ics", async (req, res, next) => {
  try {
    const data = await getState();
    if (req.params.secret !== data.settings.calendarSecret) {
      return res.status(404).send("Not found");
    }

    const events = data.bookings
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      .map((booking) => {
        return [
          "BEGIN:VEVENT",
          `UID:${booking.id}@lash-booking-studio`,
          `DTSTAMP:${toUtcIcs(todayIso(), "00:00")}`,
          `DTSTART:${toUtcIcs(booking.date, booking.startTime)}`,
          `DTEND:${toUtcIcs(booking.date, booking.endTime)}`,
          `SUMMARY:${escapeIcs(data.settings.serviceName)} - ${escapeIcs(booking.customerName)}`,
          `DESCRIPTION:${escapeIcs(`Telefon: ${booking.customerPhone}${booking.note ? ` | Notiz: ${booking.note}` : ""}`)}`,
          `LOCATION:${escapeIcs(data.settings.address)}`,
          "END:VEVENT"
        ].join("\r\n");
      })
      .join("\r\n");

    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lash Booking Studio//DE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      events,
      "END:VCALENDAR"
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    return res.send(body);
  } catch (error) {
    return next(error);
  }
});

app.use(async (req, res) => {
  const data = await getState();
  return res.status(404).render("error", {
    settings: data.settings,
    message: "Diese Seite wurde nicht gefunden."
  });
});

app.use(async (error, req, res, next) => {
  console.error(error);
  const data = await getState().catch(() => ({
    settings: defaultErrorSettings()
  }));
  return res.status(500).render("error", {
    settings: data.settings,
    message: "Es ist ein unerwarteter Fehler aufgetreten."
  });
});

function defaultErrorSettings() {
  return {
    businessName: "VK Lash Atelier"
  };
}

async function start() {
  await initDatabase();
  app.listen(port, "0.0.0.0", () => {
    console.log(`Lash booking studio laeuft auf http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Server konnte nicht gestartet werden:", error);
  process.exit(1);
});
