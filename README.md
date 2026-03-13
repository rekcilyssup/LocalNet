<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# LocalNet

LocalNet now uses a separated frontend and backend:

- React + Vite frontend in the project root.
- Java Spring Boot backend in [backend](backend).

## Frontend

Prerequisite: Node.js

1. Install dependencies:
   `npm install`
2. Start the frontend:
   `npm run dev`

The Vite dev server proxies `/api` requests to `http://localhost:8080` by default.

## Backend

Prerequisite: Java 17+ and Maven

1. Open a terminal in [backend](backend)
2. Start the Spring Boot API:
   `mvn spring-boot:run`

The backend exposes the same API surface the UI expects:

- `GET /api/status`
- `GET /api/peers`
- `POST /api/peers/broadcast`
- `GET /api/messages/{peerId}?viewerPeerId=...`
- `POST /api/messages/send`
- `DELETE /api/messages/{id}`
- `POST /api/files/request`
- `POST /api/files/upload`
- `GET /api/files/download/{id}`

## Notes

- Uploaded files are stored under `backend/storage/uploads`.
- Message state is currently in-memory, so restarting the Spring Boot app clears peers and messages.
- The old Node mock server is still available with `npm run dev:mock` if you need the previous preview flow.
