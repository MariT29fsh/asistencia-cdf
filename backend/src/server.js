require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL en las variables de entorno.");
  process.exit(1);
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
  })
);

app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
});

/* =========================================================
   UTILIDADES
========================================================= */
function validateAmount(amount) {
  if (
    amount === null ||
    amount === undefined ||
    amount === ""
  ) {
    return false;
  }

  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }

  /*
   * Máximo 2 decimales.
   */
  if (Math.round(value * 100) !== value * 100) {
    return false;
  }

  return true;
}

function isValidDate(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function requireDate(date) {
  if (!isValidDate(date)) {
    const error = new Error("La fecha debe tener formato YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }
}

function validateMemberData({ full_name, dni, category }) {
  if (!full_name || !String(full_name).trim()) {
    return "El nombre es obligatorio.";
  }

  if (!dni || !String(dni).trim()) {
    return "El DNI es obligatorio.";
  }

  if (!["integrante", "invitado"].includes(category)) {
    return "La categoría debe ser integrante o invitado.";
  }

  return null;
}

function validateAmount(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }

  return true;
}

/* =========================================================
   BASE DE DATOS
========================================================= */

async function initDb() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * =====================================================
     * TABLAS
     * =====================================================
     */

    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        dni TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL
          CHECK (category IN ('integrante', 'invitado')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id SERIAL PRIMARY KEY,
        meeting_date DATE UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL
          REFERENCES members(id)
          ON DELETE CASCADE,
        meeting_id INTEGER NOT NULL
          REFERENCES meetings(id)
          ON DELETE CASCADE,
        attended BOOLEAN NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE(member_id, meeting_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contributions (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL
          REFERENCES members(id)
          ON DELETE CASCADE,
        meeting_id INTEGER NOT NULL
          REFERENCES meetings(id)
          ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL
          CHECK (amount > 0),
        paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE(member_id, meeting_id)
      )
    `);

    /*
     * =====================================================
     * MIGRACIONES
     *
     * CREATE TABLE IF NOT EXISTS NO actualiza tablas
     * existentes. Por eso hacemos ALTER TABLE.
     * =====================================================
     */

    await client.query(`
      ALTER TABLE members
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE contributions
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    /*
     * =====================================================
     * ÍNDICES
     * =====================================================
     */

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_members_active
      ON members(active)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_members_full_name
      ON members(full_name)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_meeting
      ON attendance(meeting_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_member
      ON attendance(member_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contributions_meeting
      ON contributions(meeting_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contributions_member
      ON contributions(member_id)
    `);

    await client.query("COMMIT");

    console.log("Base de datos inicializada correctamente.");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Error inicializando BD:", error);

    throw error;
  } finally {
    client.release();
  }
}



/* =========================================================
   OBTENER / CREAR REUNIÓN
========================================================= */

async function getMeeting(date, client = pool) {
  requireDate(date);

  const result = await client.query(
    `
      INSERT INTO meetings (meeting_date)
      VALUES ($1)
      ON CONFLICT (meeting_date)
      DO NOTHING
      RETURNING *
    `,
    [date]
  );

  if (result.rows.length) {
    return result.rows[0];
  }

  const existing = await client.query(
    `
      SELECT *
      FROM meetings
      WHERE meeting_date = $1
    `,
    [date]
  );

  return existing.rows[0];
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "postgresql",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error",
      message: "No se pudo conectar a PostgreSQL.",
    });
  }
});

app.get("/api/health/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");

    res.json({
      ok: true,
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error",
    });
  }
});

/* =========================================================
   MIEMBROS
========================================================= */

/*
GET /api/members

Obtiene solamente miembros activos.
*/
app.get("/api/members", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        full_name,
        dni,
        category,
        active,
        created_at,
        updated_at
      FROM members
      WHERE active = TRUE
      ORDER BY full_name ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error obteniendo miembros.",
    });
  }
});

/*
GET /api/members/all

Incluye miembros activos e inactivos.
*/
app.get("/api/members/all", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        full_name,
        dni,
        category,
        active,
        created_at,
        updated_at
      FROM members
      ORDER BY active DESC, full_name ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error obteniendo miembros.",
    });
  }
});

/*
POST /api/members
*/
app.post("/api/members", async (req, res) => {
  const full_name = String(req.body.full_name || "").trim();
  const dni = String(req.body.dni || "").trim();
  const category = req.body.category;

  const validationError = validateMemberData({
    full_name,
    dni,
    category,
  });

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO members (
          full_name,
          dni,
          category
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [full_name, dni, category]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "El DNI ya existe.",
      });
    }

    res.status(500).json({
      message: "No se pudo registrar el miembro.",
    });
  }
});

/*
PUT /api/members/:id

Edita los datos de un miembro.
*/
app.put("/api/members/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "ID de miembro inválido.",
    });
  }

  const full_name = String(req.body.full_name || "").trim();
  const dni = String(req.body.dni || "").trim();
  const category = req.body.category;

  const validationError = validateMemberData({
    full_name,
    dni,
    category,
  });

  if (validationError) {
    return res.status(400).json({
      message: validationError,
    });
  }

  try {
    const { rows } = await pool.query(
      `
        UPDATE members
        SET
          full_name = $1,
          dni = $2,
          category = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [full_name, dni, category, id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Miembro no encontrado.",
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "El DNI ya pertenece a otro miembro.",
      });
    }

    res.status(500).json({
      message: "No se pudo actualizar el miembro.",
    });
  }
});

/*
DELETE /api/members/:id

No elimina físicamente al miembro.
Lo desactiva para conservar su historial.
*/
app.delete("/api/members/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "ID de miembro inválido.",
    });
  }

  try {
    const { rows } = await pool.query(
      `
        UPDATE members
        SET
          active = FALSE,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Miembro no encontrado.",
      });
    }

    res.json({
      ok: true,
      member: rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "No se pudo desactivar el miembro.",
    });
  }
});

/*
PATCH /api/members/:id/restore

Reactiva un miembro.
*/
app.patch("/api/members/:id/restore", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "ID de miembro inválido.",
    });
  }

  try {
    const { rows } = await pool.query(
      `
        UPDATE members
        SET
          active = TRUE,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Miembro no encontrado.",
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "No se pudo reactivar el miembro.",
    });
  }
});

/* =========================================================
   ASISTENCIA
========================================================= */

/*
GET /api/attendance?date=2026-09-25

Muestra todos los miembros activos y su estado
de asistencia y pago para ese día.
*/
app.get("/api/attendance", async (req, res) => {
  try {
    const { date } = req.query;

    requireDate(date);

    const meeting = await getMeeting(date);

    const { rows } = await pool.query(
      `
        SELECT
          m.id,
          m.full_name,
          m.dni,
          m.category,

          COALESCE(a.attended, FALSE) AS attended,
          a.id AS attendance_id,

          (c.id IS NOT NULL) AS paid,
          COALESCE(c.amount, 0)::NUMERIC AS amount,
          c.id AS contribution_id,
          c.paid_at

        FROM members m

        LEFT JOIN attendance a
          ON a.member_id = m.id
          AND a.meeting_id = $1

        LEFT JOIN contributions c
          ON c.member_id = m.id
          AND c.meeting_id = $1

        WHERE m.active = TRUE

        ORDER BY
          m.full_name ASC
      `,
      [meeting.id]
    );

    res.json({
      meeting,
      rows,
    });
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message || "Error obteniendo asistencia.",
    });
  }
});

/*
POST /api/attendance

Registra la asistencia completa del día.

member_ids = [1, 2, 5]
*/
app.post("/api/attendance", async (req, res) => {
  const { date, member_ids = [] } = req.body;

  if (!Array.isArray(member_ids)) {
    return res.status(400).json({
      message: "member_ids debe ser un arreglo.",
    });
  }

  const client = await pool.connect();

  try {
    requireDate(date);

    await client.query("BEGIN");

    const meeting = await getMeeting(date, client);

    const members = await client.query(`
      SELECT id
      FROM members
      WHERE active = TRUE
    `);

    const selected = new Set(
      member_ids
        .map(Number)
        .filter(Number.isInteger)
    );

    const savedAttendance = [];

  for (const member of members.rows) {
    const result = await client.query(
      `
        INSERT INTO attendance (
          member_id,
          meeting_id,
          attended
        )
        VALUES ($1, $2, $3)

        ON CONFLICT (member_id, meeting_id)
        DO UPDATE SET
          attended = EXCLUDED.attended,
          updated_at = NOW()

        RETURNING *
      `,
      [
        member.id,
        meeting.id,
        selected.has(member.id),
      ]
    );

    savedAttendance.push(result.rows[0]);
  }

    /*
      Si una persona pasa de asistió = TRUE
      a asistió = FALSE, eliminamos su cuota.

      Esto evita tener:
      asistencia = FALSE
      pago = TRUE
    */
    await client.query(
      `
        DELETE FROM contributions c
        WHERE c.meeting_id = $1
          AND EXISTS (
            SELECT 1
            FROM attendance a
            WHERE a.id = (
              SELECT id
              FROM attendance
              WHERE member_id = c.member_id
                AND meeting_id = c.meeting_id
            )
            AND a.attended = FALSE
          )
      `,
      [meeting.id]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      meeting,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(error.status || 500).json({
      message: error.message || "No se pudo guardar la asistencia.",
    });
  } finally {
    client.release();
  }
});

/*
PUT /api/attendance

Permite corregir individualmente la asistencia.

{
  "date": "2026-09-25",
  "member_id": 5,
  "attended": true
}
*/
app.put("/api/attendance", async (req, res) => {
  const { date, member_id, attended } = req.body;

  const memberId = Number(member_id);

  if (!Number.isInteger(memberId)) {
    return res.status(400).json({
      message: "member_id inválido.",
    });
  }

  if (typeof attended !== "boolean") {
    return res.status(400).json({
      message: "attended debe ser true o false.",
    });
  }

  const client = await pool.connect();

  try {
    requireDate(date);

    await client.query("BEGIN");

    const member = await client.query(
      `
        SELECT id
        FROM members
        WHERE id = $1
      `,
      [memberId]
    );

    if (!member.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Miembro no encontrado.",
      });
    }

    const meeting = await getMeeting(date, client);

    const { rows } = await client.query(
      `
        INSERT INTO attendance (
          member_id,
          meeting_id,
          attended
        )
        VALUES ($1, $2, $3)

        ON CONFLICT (member_id, meeting_id)
        DO UPDATE SET
          attended = EXCLUDED.attended,
          updated_at = NOW()

        RETURNING *
      `,
      [memberId, meeting.id, attended]
    );

    /*
      Si se corrige la asistencia a FALSE,
      también eliminamos cualquier cobro asociado.
    */
    if (!attended) {
      await client.query(
        `
          DELETE FROM contributions
          WHERE member_id = $1
            AND meeting_id = $2
        `,
        [memberId, meeting.id]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      attendance: rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    client.release();
  }
});

/*
DELETE /api/attendance/:member_id?date=YYYY-MM-DD

Elimina el registro de asistencia de una persona
para una fecha determinada.

También elimina el cobro asociado.
*/
app.delete("/api/attendance/:member_id", async (req, res) => {
  const memberId = Number(req.params.member_id);
  const { date } = req.query;

  if (!Number.isInteger(memberId)) {
    return res.status(400).json({
      message: "member_id inválido.",
    });
  }

  const client = await pool.connect();

  try {
    requireDate(date);

    await client.query("BEGIN");

    const meeting = await getMeeting(date, client);

    /*
     * Primero eliminamos el aporte asociado.
     */
    await client.query(
      `
        DELETE FROM contributions
        WHERE member_id = $1
          AND meeting_id = $2
      `,
      [memberId, meeting.id]
    );

    /*
     * Después eliminamos la asistencia.
     */
    const result = await client.query(
      `
        DELETE FROM attendance
        WHERE member_id = $1
          AND meeting_id = $2
        RETURNING *
      `,
      [memberId, meeting.id]
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "No existe registro de asistencia para ese día.",
      });
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      message: "Registro de asistencia eliminado.",
      attendance: result.rows[0],
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error("Error eliminando asistencia:", error);

    res.status(error.status || 500).json({
      message: error.message || "No se pudo eliminar la asistencia.",
    });
  } finally {
    client.release();
  }
});



/*
GET /api/pending-attendance?date=YYYY-MM-DD
*/
app.get("/api/pending-attendance", async (req, res) => {
  try {
    const { date } = req.query;

    requireDate(date);

    const meeting = await getMeeting(date);

    const { rows } = await pool.query(
      `
        SELECT
          m.id,
          m.full_name,
          m.dni,
          m.category
        FROM members m

        LEFT JOIN attendance a
          ON a.member_id = m.id
          AND a.meeting_id = $1

        WHERE m.active = TRUE
          AND a.id IS NULL

        ORDER BY m.full_name ASC
      `,
      [meeting.id]
    );

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/* =========================================================
   CUOTAS / CAJA
========================================================= */

/*
GET /api/cash?date=YYYY-MM-DD

Solo personas que asistieron.
*/
app.get("/api/cash", async (req, res) => {
  try {
    const { date } = req.query;

    requireDate(date);

    const meeting = await getMeeting(date);

    const { rows } = await pool.query(
      `
        SELECT
          m.id,
          m.full_name,
          m.dni,
          m.category,

          a.attended,

          (c.id IS NOT NULL) AS paid,
          COALESCE(c.amount, 0)::NUMERIC AS amount,
          c.id AS contribution_id,
          c.paid_at

        FROM members m

        INNER JOIN attendance a
          ON a.member_id = m.id
          AND a.meeting_id = $1
          AND a.attended = TRUE

        LEFT JOIN contributions c
          ON c.member_id = m.id
          AND c.meeting_id = $1

        WHERE m.active = TRUE

        ORDER BY
          paid ASC,
          m.full_name ASC
      `,
      [meeting.id]
    );

    const summary = await pool.query(
      `
        SELECT
          COUNT(*)::INTEGER AS paid_members,
          COALESCE(SUM(amount), 0)::NUMERIC AS total
        FROM contributions
        WHERE meeting_id = $1
      `,
      [meeting.id]
    );

    res.json({
      meeting,
      rows,
      summary: summary.rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/*
POST /api/contributions

Registra una cuota.
*/
app.post("/api/contributions", async (req, res) => {
  const { date, member_id, amount } = req.body;

  const memberId = Number(member_id);

  if (!Number.isInteger(memberId)) {
    return res.status(400).json({
      message: "member_id inválido.",
    });
  }

  if (!validateAmount(amount)) {
    return res.status(400).json({
      message: "El monto debe ser mayor que cero.",
    });
  }

  try {
    requireDate(date);

    const meeting = await getMeeting(date);

    const attendance = await pool.query(
      `
        SELECT id
        FROM attendance
        WHERE meeting_id = $1
          AND member_id = $2
          AND attended = TRUE
      `,
      [meeting.id, memberId]
    );

    if (!attendance.rows.length) {
      return res.status(400).json({
        message: "Debe registrar asistencia primero.",
      });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO contributions (
          member_id,
          meeting_id,
          amount
        )
        VALUES ($1, $2, $3)

        RETURNING *
      `,
      [memberId, meeting.id, Number(amount).toFixed(2)]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "El aporte ya fue registrado. Use PUT para corregirlo.",
      });
    }

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/*
PUT /api/contributions/:id

Corrige el monto de un cobro.
*/
app.put("/api/contributions/:id", async (req, res) => {
  const contributionId = Number(req.params.id);
  const rawAmount = req.body.amount;

if (!validateAmount(rawAmount)) {
  return res.status(400).json({
    message: "El monto debe ser mayor que cero y tener como máximo 2 decimales.",
  });
}

const amount = Number(rawAmount);

  if (!Number.isInteger(contributionId)) {
    return res.status(400).json({
      message: "ID de aporte inválido.",
    });
  }

  if (!validateAmount(amount)) {
    return res.status(400).json({
      message: "El monto debe ser mayor que cero.",
    });
  }

  try {
    const { rows } = await pool.query(
      `
        UPDATE contributions
        SET
          amount = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [amount.toFixed(2), contributionId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Aporte no encontrado.",
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "No se pudo actualizar el aporte.",
    });
  }
});

/*
DELETE /api/contributions/:id

Elimina un cobro registrado por error.
*/
app.delete("/api/contributions/:id", async (req, res) => {
  const contributionId = Number(req.params.id);

  if (!Number.isInteger(contributionId)) {
    return res.status(400).json({
      message: "ID de aporte inválido.",
    });
  }

  try {
    const { rows } = await pool.query(
      `
        DELETE FROM contributions
        WHERE id = $1
        RETURNING *
      `,
      [contributionId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Aporte no encontrado.",
      });
    }

    res.json({
      ok: true,
      message: "Aporte eliminado.",
      contribution: rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "No se pudo eliminar el aporte.",
    });
  }
});

/* =========================================================
   RESUMEN DE UN DÍA
========================================================= */

/*
GET /api/day/2026-09-25

Devuelve:

- todos los asistentes
- todos los que pagaron
- monto total
- cantidad de asistentes
- cantidad de pagos
- personas pendientes de pago
*/
app.get("/api/day/:date", async (req, res) => {
  const { date } = req.params;

  try {
    requireDate(date);

    const meeting = await getMeeting(date);

    const { rows } = await pool.query(
      `
        SELECT
          m.id,
          m.full_name,
          m.dni,
          m.category,

          a.id AS attendance_id,
          COALESCE(a.attended, FALSE) AS attended,

          c.id AS contribution_id,
          (c.id IS NOT NULL) AS paid,
          COALESCE(c.amount, 0)::NUMERIC AS amount,
          c.paid_at

        FROM members m

        LEFT JOIN attendance a
          ON a.member_id = m.id
          AND a.meeting_id = $1

        LEFT JOIN contributions c
          ON c.member_id = m.id
          AND c.meeting_id = $1

        WHERE m.active = TRUE

        ORDER BY
          COALESCE(a.attended, FALSE) DESC,
          m.full_name ASC
      `,
      [meeting.id]
    );

    const attendees = rows.filter(
      (row) => row.attended === true
    );

    const paid = attendees.filter(
      (row) => row.paid === true
    );

    const pending = attendees.filter(
      (row) => row.paid === false
    );

    const total = paid.reduce(
      (sum, row) => sum + Number(row.amount),
      0
    );

    res.json({
      meeting,

      summary: {
        total_members: rows.length,
        attendees: attendees.length,
        paid_members: paid.length,
        pending_payment: pending.length,
        total: Number(total.toFixed(2)),
      },

      attendees,

      paid,

      pending,

      rows,
    });
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/* =========================================================
   REPORTES POR RANGO
========================================================= */

/*
GET /api/reports?from=2026-09-01&to=2026-09-30
*/
app.get("/api/reports", async (req, res) => {
  const { from, to } = req.query;

  try {
    requireDate(from);
    requireDate(to);

    if (from > to) {
      return res.status(400).json({
        message: "La fecha inicial no puede ser mayor que la fecha final.",
      });
    }

    const { rows } = await pool.query(
      `
        SELECT
          me.meeting_date AS date,

          COUNT(a.id)
            FILTER (WHERE a.attended = TRUE)::INTEGER
            AS attended,

          COUNT(a.id)
            FILTER (WHERE a.attended = FALSE)::INTEGER
            AS absent,

          COUNT(c.id)::INTEGER
            AS paid_members,

          COALESCE(SUM(c.amount), 0)::NUMERIC
            AS total

        FROM meetings me

        LEFT JOIN attendance a
          ON a.meeting_id = me.id

        LEFT JOIN contributions c
          ON c.meeting_id = me.id
          AND c.member_id = a.member_id

        WHERE me.meeting_date BETWEEN $1 AND $2

        GROUP BY
          me.id,
          me.meeting_date

        ORDER BY
          me.meeting_date ASC
      `,
      [from, to]
    );

    const totals = rows.reduce(
      (acc, row) => {
        acc.meetings += 1;
        acc.attendance_records += Number(row.attended);
        acc.absent_records += Number(row.absent);
        acc.contribution_records += Number(row.paid_members);
        acc.total += Number(row.total);

        return acc;
      },
      {
        meetings: 0,
        attendance_records: 0,
        absent_records: 0,
        contribution_records: 0,
        total: 0,
      }
    );

    totals.total = Number(totals.total.toFixed(2));

    res.json({
      rows,
      totals,
    });
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/* =========================================================
   HISTORIAL
========================================================= */

/*
GET /api/history

Opcional:

/api/history?from=2026-09-01&to=2026-09-30

También permite:

/api/history?date=2026-09-25
*/
app.get("/api/history", async (req, res) => {
  const { from, to, date } = req.query;

  try {
    let dateCondition = "";
    const params = [];

    if (date) {
      requireDate(date);

      params.push(date);
      dateCondition = `
        AND me.meeting_date = $1
      `;
    } else if (from || to) {
      if (!from || !to) {
        return res.status(400).json({
          message: "Debe proporcionar from y to.",
        });
      }

      requireDate(from);
      requireDate(to);

      if (from > to) {
        return res.status(400).json({
          message: "from no puede ser mayor que to.",
        });
      }

      params.push(from, to);

      dateCondition = `
        AND me.meeting_date BETWEEN $1 AND $2
      `;
    }

    const { rows } = await pool.query(
      `
        SELECT
          me.id AS meeting_id,
          me.meeting_date AS date,

          m.id AS member_id,
          m.full_name,
          m.dni,
          m.category,

          COALESCE(a.attended, FALSE) AS attended,

          c.id AS contribution_id,
          (c.id IS NOT NULL) AS paid,
          COALESCE(c.amount, 0)::NUMERIC AS amount,
          c.paid_at

        FROM meetings me

        INNER JOIN members m
          ON TRUE

        LEFT JOIN attendance a
          ON a.meeting_id = me.id
          AND a.member_id = m.id

        LEFT JOIN contributions c
          ON c.meeting_id = me.id
          AND c.member_id = m.id

        WHERE
          (
            a.id IS NOT NULL
            OR c.id IS NOT NULL
          )

          ${dateCondition}

        ORDER BY
          me.meeting_date DESC,
          m.full_name ASC
      `,
      params
    );

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      message: error.message,
    });
  }
});

/* =========================================================
   ERRORES
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    message: "Endpoint no encontrado.",
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    message: "Error interno del servidor.",
  });
});

/* =========================================================
   INICIO
========================================================= */

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API ejecutándose en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Error inicializando BD:", error);
    process.exit(1);
  });
