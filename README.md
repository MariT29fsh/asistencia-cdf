# Sistema de Asistencia y Aportaciones — PostgreSQL

MVP con React + MUI + Node.js/Express + PostgreSQL.

## Estructura
- `frontend`: React + Vite + MUI
- `backend`: Node.js + Express + PostgreSQL (`pg`)

## Ejecutar localmente
### Backend
1. Instala PostgreSQL y crea una base de datos.
2. Copia `backend/.env.example` a `backend/.env` y coloca tu `DATABASE_URL`.
3. `cd backend`
4. `npm install`
5. `npm run dev`

### Frontend
1. Copia `frontend/.env.example` a `frontend/.env` si deseas cambiar la URL del backend.
2. `cd frontend`
3. `npm install`
4. `npm run dev`

## Despliegue
El backend necesita una variable `DATABASE_URL` proporcionada por tu servicio PostgreSQL. El frontend necesita `VITE_API_URL` con la URL pública del backend.

Variables del backend: `DATABASE_URL`, `NODE_ENV=production`, `CORS_ORIGIN`, `PORT`.
Variable del frontend: `VITE_API_URL`.

Las tablas se crean automáticamente al iniciar el backend.
