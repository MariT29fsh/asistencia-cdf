import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Checkbox,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Alert,
} from "@mui/material";

/* =========================================================
   API
========================================================= */

const api = axios.create({
  baseURL: `${
    import.meta.env.VITE_API_URL || "http://localhost:4000"
  }/api`,
});

/* =========================================================
   UTILIDADES
========================================================= */

/*
 * Obtiene la fecha local en formato YYYY-MM-DD.
 *
 * No usamos toISOString() porque trabaja con UTC
 * y puede cambiar la fecha cerca de medianoche.
 */
const today = () => {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

/*
 * Formatea un monto proveniente de PostgreSQL.
 *
 * PostgreSQL puede devolver NUMERIC como string.
 */
const formatAmount = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return "0.00";
  }

  return value.toFixed(2);
};

/*
 * Valida que el monto sea:
 *
 * - numérico
 * - mayor que cero
 * - máximo 2 decimales
 */
const isValidAmount = (amount) => {
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

  return Math.round(value * 100) === value * 100;
};

/*
 * Obtiene el mensaje de error enviado por el backend.
 */
const getErrorMessage = (
  error,
  fallback = "Ocurrió un error."
) => {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
};

/* =========================================================
   DATE BAR
========================================================= */

function DateBar({ date, setDate }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        mb: 2,
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1,
      }}
    >
      <TextField
        type="date"
        label="Fecha"
        InputLabelProps={{ shrink: true }}
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />

      <Chip
        label="Admite fechas pasadas"
        color="info"
      />
    </Stack>
  );
}

/* =========================================================
   APP
========================================================= */

function App() {
  /* =======================================================
     ESTADOS
  ======================================================= */

  const [page, setPage] = useState("asistencia");

  const [date, setDate] = useState(today());

  const [rows, setRows] = useState([]);

  const [selected, setSelected] = useState([]);

  const [cash, setCash] = useState({
    rows: [],
    summary: {},
  });

  const [pending, setPending] = useState([]);

  const [report, setReport] = useState({
    rows: [],
    totals: {},
  });

  const [from, setFrom] = useState(today());

  const [to, setTo] = useState(today());

  const [open, setOpen] = useState(false);

  const [pay, setPay] = useState(null);

  /*
   * Importante:
   *
   * El monto se mantiene como string mientras el usuario
   * escribe.
   *
   * No hacemos:
   *
   * setAmount(+e.target.value)
   *
   * porque eso puede producir problemas mientras se escribe.
   */
  const [amount, setAmount] = useState("20");

  const [newM, setNewM] = useState({
    full_name: "",
    dni: "",
    category: "integrante",
  });

  /* =======================================================
     CARGAR DATOS
  ======================================================= */

  const load = async () => {
    try {
      const [
        attendanceResponse,
        cashResponse,
        pendingResponse,
      ] = await Promise.all([
        api.get("/attendance", {
          params: { date },
        }),

        api.get("/cash", {
          params: { date },
        }),

        api.get("/pending-attendance", {
          params: { date },
        }),
      ]);

      /*
       * ASISTENCIA
       */

      const attendanceRows =
        attendanceResponse.data.rows || [];

      setRows(attendanceRows);

      /*
       * Seleccionamos automáticamente los que
       * ya tienen attended = true.
       */
      setSelected(
        attendanceRows
          .filter((member) => member.attended)
          .map((member) => member.id)
      );

      /*
       * CAJA
       */

      setCash(
        cashResponse.data || {
          rows: [],
          summary: {},
        }
      );

      /*
       * PENDIENTES
       */

      setPending(
        pendingResponse.data || []
      );
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudieron cargar los datos."
        )
      );
    }
  };

  useEffect(() => {
    load();
  }, [date]);

  /* =======================================================
     GUARDAR ASISTENCIA
  ======================================================= */

  const saveAtt = async () => {
    try {
      await api.post("/attendance", {
        date,
        member_ids: selected,
      });

      await load();

      alert("Asistencia guardada correctamente.");
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudo guardar la asistencia."
        )
      );
    }
  };

  /* =======================================================
     REGISTRAR PAGO
  ======================================================= */

  const savePay = async () => {
    if (!pay) {
      return;
    }

    /*
     * Validamos el valor como string antes de convertirlo.
     */
    if (!isValidAmount(amount)) {
      alert(
        "El monto debe ser mayor que cero y tener como máximo 2 decimales."
      );
      return;
    }

    const value = Number(amount);

    try {
      await api.post("/contributions", {
        date,
        member_id: pay.id,
        amount: value,
      });

      /*
       * Cerramos diálogo.
       */
      setPay(null);

      /*
       * Restauramos monto por defecto.
       */
      setAmount("20");

      /*
       * Actualizamos asistencia/caja/pendientes.
       */
      await load();

      alert("Pago registrado correctamente.");
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudo registrar el pago."
        )
      );
    }
  };

  /* =======================================================
     REGISTRAR MIEMBRO
  ======================================================= */

  const saveMember = async () => {
    /*
     * Validación básica del frontend.
     *
     * El backend también valida.
     */

    if (!newM.full_name.trim()) {
      alert("El nombre es obligatorio.");
      return;
    }

    if (!newM.dni.trim()) {
      alert("El DNI es obligatorio.");
      return;
    }

    if (
      !["integrante", "invitado"].includes(
        newM.category
      )
    ) {
      alert("La categoría no es válida.");
      return;
    }

    try {
      await api.post("/members", {
        full_name: newM.full_name.trim(),
        dni: newM.dni.trim(),
        category: newM.category,
      });

      /*
       * Cerramos diálogo.
       */
      setOpen(false);

      /*
       * Limpiamos formulario.
       */
      setNewM({
        full_name: "",
        dni: "",
        category: "integrante",
      });

      /*
       * Actualizamos datos.
       */
      await load();

      alert("Miembro registrado correctamente.");
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudo registrar el miembro."
        )
      );
    }
  };

  /* =======================================================
     REPORTES
  ======================================================= */

  const reportLoad = async () => {
    if (!from || !to) {
      return;
    }

    if (from > to) {
      alert(
        "La fecha inicial no puede ser mayor que la fecha final."
      );
      return;
    }

    try {
      const response = await api.get(
        "/reports",
        {
          params: {
            from,
            to,
          },
        }
      );

      setReport(
        response.data || {
          rows: [],
          totals: {},
        }
      );
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudo cargar el reporte."
        )
      );
    }
  };

  useEffect(() => {
    if (page === "reporte") {
      reportLoad();
    }
  }, [page, from, to]);

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      {/* ===================================================
          APP BAR
      =================================================== */}

      <AppBar>
        <Toolbar>
          <Typography
            sx={{
              flexGrow: 1,
            }}
          >
            Control de Agrupación
          </Typography>

          <Button
            color="inherit"
            onClick={() => setOpen(true)}
          >
            + Miembro
          </Button>
        </Toolbar>
      </AppBar>

      {/* ===================================================
          CONTENIDO
      =================================================== */}

      <Container
        sx={{
          py: 3,
          pt: 20,
        }}
      >
        {/* =================================================
            NAVEGACIÓN
        ================================================= */}

        <Stack
          direction="row"
          spacing={1}
          sx={{
            mb: 3,
            flexWrap: "wrap",
          }}
        >
          {[
            ["asistencia", "Asistencia"],
            ["caja", "💰 Caja"],
            ["pendientes", "Falta marcar"],
            ["reporte", "Reportes"],
            ["historial", "Historial"],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant={
                page === value
                  ? "contained"
                  : "text"
              }
              onClick={() => setPage(value)}
            >
              {label}
            </Button>
          ))}
        </Stack>

        {/* =================================================
            ASISTENCIA
        ================================================= */}

        {page === "asistencia" && (
          <>
            <Typography variant="h4">
              Registrar asistencia
            </Typography>

            <DateBar
              date={date}
              setDate={setDate}
            />

            <Paper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      Asistió
                    </TableCell>

                    <TableCell>
                      Nombre completo
                    </TableCell>

                    <TableCell>
                      DNI
                    </TableCell>

                    <TableCell>
                      Categoría
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        align="center"
                      >
                        No hay miembros activos.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Checkbox
                            checked={selected.includes(
                              r.id
                            )}
                            onChange={() =>
                              setSelected((current) =>
                                current.includes(r.id)
                                  ? current.filter(
                                      (id) =>
                                        id !== r.id
                                    )
                                  : [
                                      ...current,
                                      r.id,
                                    ]
                              )
                            }
                          />
                        </TableCell>

                        <TableCell>
                          {r.full_name}
                        </TableCell>

                        <TableCell>
                          {r.dni}
                        </TableCell>

                        <TableCell>
                          {r.category}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <Box p={2}>
                <Button
                  variant="contained"
                  onClick={saveAtt}
                >
                  Guardar asistencia
                </Button>
              </Box>
            </Paper>
          </>
        )}

        {/* =================================================
            CAJA
        ================================================= */}

        {page === "caja" && (
          <>
            <Typography variant="h4">
              💰 Caja
            </Typography>

            <DateBar
              date={date}
              setDate={setDate}
            />

            <Grid
              container
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Grid
                size={{
                  xs: 12,
                  md: 4,
                }}
              >
                <Card>
                  <CardContent>
                    <Typography>
                      Recaudado
                    </Typography>

                    <Typography variant="h4">
                      S/{" "}
                      {formatAmount(
                        cash.summary?.total || 0
                      )}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid
                size={{
                  xs: 12,
                  md: 4,
                }}
              >
                <Card>
                  <CardContent>
                    <Typography>
                      Pendientes
                    </Typography>

                    <Typography variant="h4">
                      {
                        (cash.rows || []).filter(
                          (r) => !r.paid
                        ).length
                      }
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Paper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      Miembro
                    </TableCell>

                    <TableCell>
                      Estado
                    </TableCell>

                    <TableCell />
                  </TableRow>
                </TableHead>

                <TableBody>
                  {(cash.rows || []).length ===
                  0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        align="center"
                      >
                        No hay asistentes para esta
                        fecha.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cash.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.full_name}
                        </TableCell>

                        <TableCell>
                          {r.paid ? (
                            <Chip
                              color="success"
                              label={`Pagó S/ ${formatAmount(
                                r.amount
                              )}`}
                            />
                          ) : (
                            <Chip
                              color="warning"
                              label="Pendiente"
                            />
                          )}
                        </TableCell>

                        <TableCell>
                          {!r.paid && (
                            <Button
                              variant="contained"
                              onClick={() => {
                                setPay(r);

                                /*
                                 * Cada vez que abrimos
                                 * el diálogo empezamos
                                 * con S/ 20.
                                 */
                                setAmount("20");
                              }}
                            >
                              Cobrar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Paper>
          </>
        )}

        {/* =================================================
            PENDIENTES
        ================================================= */}

        {page === "pendientes" && (
          <>
            <Typography variant="h4">
              Miembros que faltan marcar asistencia
            </Typography>

            <DateBar
              date={date}
              setDate={setDate}
            />

            <Alert sx={{ mb: 2 }}>
              Solo aparecen miembros sin registro
              de asistencia para esta fecha.
            </Alert>

            <Paper>
              <Table>
                <TableBody>
                  {pending.length === 0 ? (
                    <TableRow>
                      <TableCell align="center">
                        Todos los miembros tienen
                        asistencia registrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pending.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.full_name}
                        </TableCell>

                        <TableCell>
                          {r.dni}
                        </TableCell>

                        <TableCell>
                          {r.category}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Paper>
          </>
        )}

        {/* =================================================
            REPORTES
        ================================================= */}

        {page === "reporte" && (
          <>
            <Typography variant="h4">
              Reporte semanal / mensual
            </Typography>

            <Stack
              direction="row"
              spacing={2}
              sx={{
                my: 2,
                flexWrap: "wrap",
                gap: 1,
              }}
            >
              <TextField
                type="date"
                label="Desde"
                InputLabelProps={{
                  shrink: true,
                }}
                value={from}
                onChange={(e) =>
                  setFrom(e.target.value)
                }
              />

              <TextField
                type="date"
                label="Hasta"
                InputLabelProps={{
                  shrink: true,
                }}
                value={to}
                onChange={(e) =>
                  setTo(e.target.value)
                }
              />
            </Stack>

            <Grid
              container
              spacing={2}
              sx={{ mb: 2 }}
            >
              {[
                [
                  "Reuniones",
                  report.totals?.meetings || 0,
                ],

                [
                  "Asistencias",
                  report.totals
                    ?.attendance_records || 0,
                ],

                [
                  "Aportes",
                  report.totals
                    ?.contribution_records || 0,
                ],

                [
                  "Recaudado",
                  `S/ ${formatAmount(
                    report.totals?.total || 0
                  )}`,
                ],
              ].map(([label, value]) => (
                <Grid
                  key={label}
                  size={{
                    xs: 6,
                    md: 3,
                  }}
                >
                  <Card>
                    <CardContent>
                      <Typography>
                        {label}
                      </Typography>

                      <Typography variant="h5">
                        {value}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Paper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      Fecha
                    </TableCell>

                    <TableCell>
                      Asistieron
                    </TableCell>

                    <TableCell>
                      Ausentes
                    </TableCell>

                    <TableCell>
                      Aportes
                    </TableCell>

                    <TableCell>
                      Total
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {report.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        align="center"
                      >
                        No hay datos para el período
                        seleccionado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.rows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>
                          {r.date}
                        </TableCell>

                        <TableCell>
                          {r.attended}
                        </TableCell>

                        <TableCell>
                          {r.absent}
                        </TableCell>

                        <TableCell>
                          {r.paid_members}
                        </TableCell>

                        <TableCell>
                          S/{" "}
                          {formatAmount(r.total)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Paper>
          </>
        )}

        {/* =================================================
            HISTORIAL
        ================================================= */}

        {page === "historial" && <History />}
      </Container>

      {/* ===================================================
          DIALOG NUEVO MIEMBRO
      =================================================== */}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
      >
        <DialogTitle>
          Nuevo miembro
        </DialogTitle>

        <DialogContent>
          <Stack
            spacing={2}
            sx={{ pt: 1 }}
          >
            <TextField
              label="Nombre completo"
              value={newM.full_name}
              onChange={(e) =>
                setNewM({
                  ...newM,
                  full_name: e.target.value,
                })
              }
              fullWidth
            />

            <TextField
              label="DNI"
              value={newM.dni}
              onChange={(e) =>
                setNewM({
                  ...newM,
                  dni: e.target.value,
                })
              }
              fullWidth
            />

            <TextField
              select
              label="Categoría"
              value={newM.category}
              onChange={(e) =>
                setNewM({
                  ...newM,
                  category: e.target.value,
                })
              }
              fullWidth
            >
              <MenuItem value="integrante">
                Integrante
              </MenuItem>

              <MenuItem value="invitado">
                Invitado
              </MenuItem>
            </TextField>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>

          <Button
            onClick={saveMember}
            variant="contained"
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================
          DIALOG COBRO
      =================================================== */}

      <Dialog
        open={!!pay}
        onClose={() => setPay(null)}
      >
        <DialogTitle>
          Cobrar aporte
        </DialogTitle>

        <DialogContent>
          <Typography>
            {pay?.full_name}
          </Typography>

          <TextField
            fullWidth
            type="number"
            label="Monto S/"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value)
            }
            inputProps={{
              min: 0.01,
              step: "0.01",
            }}
            sx={{ mt: 2 }}
          />
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setPay(null)}
          >
            Cancelar
          </Button>

          <Button
            onClick={savePay}
            variant="contained"
          >
            Registrar pago
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/* =========================================================
   HISTORIAL
========================================================= */

function History() {
  const [d, setD] = useState([]);

  const loadHistory = async () => {
    try {
      const response = await api.get("/history");

      setD(response.data || []);
    } catch (error) {
      alert(
        getErrorMessage(
          error,
          "No se pudo cargar el historial."
        )
      );
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <>
      <Typography
        variant="h4"
        gutterBottom
      >
        Historial
      </Typography>

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>
                Fecha
              </TableCell>

              <TableCell>
                Miembro
              </TableCell>

              <TableCell>
                Categoría
              </TableCell>

              <TableCell>
                Asistencia
              </TableCell>

              <TableCell>
                Aporte
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {d.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  align="center"
                >
                  No hay registros en el historial.
                </TableCell>
              </TableRow>
            ) : (
              d.map((r, index) => (
                <TableRow
                  key={`${r.meeting_id}-${r.member_id}-${index}`}
                >
                  <TableCell>
                    {r.date}
                  </TableCell>

                  <TableCell>
                    {r.full_name}
                  </TableCell>

                  <TableCell>
                    {r.category}
                  </TableCell>

                  <TableCell>
                    {r.attended
                      ? "✓"
                      : "—"}
                  </TableCell>

                  <TableCell>
                    {r.amount
                      ? `S/ ${formatAmount(
                          r.amount
                        )}`
                      : "Pendiente"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}

/* =========================================================
   ROOT
========================================================= */

createRoot(
  document.getElementById("root")
).render(<App />);
