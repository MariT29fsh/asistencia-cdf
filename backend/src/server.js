require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL en las variables de entorno.");
  process.exit(1);
}

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});


async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      dni TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('integrante', 'invitado')),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      meeting_date DATE UNIQUE NOT NULL,
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id),
      meeting_id INTEGER NOT NULL REFERENCES meetings(id),
      attended BOOLEAN NOT NULL,
      UNIQUE(member_id, meeting_id)
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id),
      meeting_id INTEGER NOT NULL REFERENCES meetings(id),
      amount NUMERIC(12,2) NOT NULL,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(member_id, meeting_id)
    );
  `);
}

async function getMeeting(date) {
  const result = await pool.query(`
    INSERT INTO meetings (meeting_date)
    VALUES ($1)
    ON CONFLICT (meeting_date) DO NOTHING
    RETURNING *
  `, [date]);

  if (result.rows.length) {
    return result.rows[0];
  }

  const existing = await pool.query(
    "SELECT * FROM meetings WHERE meeting_date = $1",
    [date]
  );

  return existing.rows[0];
}


app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "postgresql" });
  } catch (error) {
    res.status(500).json({ ok: false, message: "No se pudo conectar a PostgreSQL" });
  }
});
app.get("/api/health/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      database: "connected",
      time: result.rows[0].now
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error"
    });
  }
});

app.get("/api/members", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM members WHERE active = TRUE ORDER BY full_name");
    res.json(rows);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post("/api/members", async (req, res) => {
  const { full_name, dni, category } = req.body;
  try {
    const { rows } = await pool.query(
      "INSERT INTO members(full_name, dni, category) VALUES($1,$2,$3) RETURNING *",
      [full_name, dni, category]
    );
    res.json(rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "El DNI ya existe" });
    res.status(400).json({ message: error.message });
  }
});

app.get("/api/attendance", async (req, res) => {
  try {
    const meeting = await getMeeting(req.query.date);
    const { rows } = await pool.query(`
      SELECT m.*,
        a.id AS attendance_id,
        a.attended,
        CASE WHEN c.id IS NULL THEN FALSE ELSE TRUE END AS paid,
        COALESCE(c.amount, 0) AS amount
      FROM members m
      LEFT JOIN attendance a ON a.member_id = m.id AND a.meeting_id = $1
      LEFT JOIN contributions c ON c.member_id = m.id AND c.meeting_id = $1
      WHERE m.active = TRUE
      ORDER BY m.full_name
    `, [meeting.id]);
    res.json({ meeting, rows });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post("/api/attendance", async (req, res) => {
  const { date, member_ids = [] } = req.body;
  const client = await pool.connect();
  try {
    const meeting = await getMeeting(date);
    await client.query("BEGIN");
    const members = await client.query("SELECT id FROM members WHERE active = TRUE");
    const selected = new Set(member_ids.map(Number));
    for (const member of members.rows) {
      await client.query(`
        INSERT INTO attendance(member_id, meeting_id, attended)
        VALUES($1,$2,$3)
        ON CONFLICT(member_id, meeting_id)
        DO UPDATE SET attended = EXCLUDED.attended
      `, [member.id, meeting.id, selected.has(member.id)]);
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally { client.release(); }
});

app.get("/api/pending-attendance", async (req, res) => {
  try {
    const meeting = await getMeeting(req.query.date);
    const { rows } = await pool.query(`
      SELECT m.*
      FROM members m
      LEFT JOIN attendance a ON a.member_id = m.id AND a.meeting_id = $1
      WHERE m.active = TRUE AND a.id IS NULL
      ORDER BY m.full_name
    `, [meeting.id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get("/api/cash", async (req, res) => {
  try {
    const meeting = await getMeeting(req.query.date);
    const { rows } = await pool.query(`
      SELECT m.*,
        CASE WHEN c.id IS NULL THEN FALSE ELSE TRUE END AS paid,
        COALESCE(c.amount, 0) AS amount
      FROM members m
      JOIN attendance a ON a.member_id = m.id AND a.meeting_id = $1 AND a.attended = TRUE
      LEFT JOIN contributions c ON c.member_id = m.id AND c.meeting_id = $1
      WHERE m.active = TRUE
      ORDER BY paid, m.full_name
    `, [meeting.id]);
    const summary = await pool.query(`
      SELECT COUNT(*)::INTEGER AS count, COALESCE(SUM(amount),0) AS total
      FROM contributions WHERE meeting_id = $1
    `, [meeting.id]);
    res.json({ rows, summary: summary.rows[0] });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post("/api/contributions", async (req, res) => {
  const { date, member_id, amount } = req.body;
  try {
    const meeting = await getMeeting(date);
    const attendance = await pool.query(
      "SELECT id FROM attendance WHERE meeting_id=$1 AND member_id=$2 AND attended=TRUE",
      [meeting.id, member_id]
    );
    if (!attendance.rows.length) return res.status(400).json({ message: "Debe registrar asistencia primero" });

    await pool.query(
      "INSERT INTO contributions(member_id, meeting_id, amount) VALUES($1,$2,$3)",
      [member_id, meeting.id, amount]
    );
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "El aporte ya fue registrado" });
    res.status(400).json({ message: error.message });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT meeting_date AS date,
        COUNT(*) FILTER (WHERE attendance.attended = TRUE)::INTEGER AS attended,
        COUNT(*) FILTER (WHERE attendance.attended = FALSE)::INTEGER AS absent,
        COUNT(contributions.id)::INTEGER AS paid_members,
        COALESCE(SUM(contributions.amount),0) AS total
      FROM meetings
      LEFT JOIN attendance ON attendance.meeting_id = meetings.id
      LEFT JOIN contributions ON contributions.meeting_id = meetings.id
        AND contributions.member_id = attendance.member_id
      WHERE meeting_date BETWEEN $1 AND $2
      GROUP BY meetings.id
      ORDER BY meeting_date
    `, [req.query.from, req.query.to]);
    res.json({
      rows,
      totals: {
        meetings: rows.length,
        attendance_records: rows.reduce((a, x) => a + Number(x.attended), 0),
        contribution_records: rows.reduce((a, x) => a + Number(x.paid_members), 0),
        total: rows.reduce((a, x) => a + Number(x.total), 0)
      }
    });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get("/api/history", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT me.meeting_date AS date, m.full_name, m.dni, m.category,
        a.attended, COALESCE(c.amount,0) AS amount
      FROM meetings me
      JOIN members m ON TRUE
      LEFT JOIN attendance a ON a.meeting_id = me.id AND a.member_id = m.id
      LEFT JOIN contributions c ON c.meeting_id = me.id AND c.member_id = m.id
      WHERE a.id IS NOT NULL OR c.id IS NOT NULL
      ORDER BY me.meeting_date DESC, m.full_name
    `);
    res.json(rows);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`API ejecutándose en puerto ${PORT}`)))
  .catch(error => { console.error("Error inicializando BD:", error); process.exit(1); });
