# Holo Room V18 PiAPI / OpenAI relay

This isolated branch powers a Render Node.js service for the Holo Room Android app.
It does **not** run the AI reconstruction; it forwards a small allowlist of HTTPS requests to PiAPI and OpenAI.

Endpoints:
- `GET /health` (does not access provider APIs or spend credits)
- `POST /relay/piapi/upload`
- `POST /relay/piapi/task`
- `GET /relay/piapi/task/:id`
- `POST /relay/openai/responses`

Set `HOLO_RELAY_TOKEN` in Render; never commit that token, a PiAPI key or an OpenAI key. Every forwarding route requires the token, plus the relevant provider key.

Render service: Node, free plan, build `npm install --prefix holo-relay`, start `node holo-relay/server.js`; choose branch `holo-room-relay-v18`.

The Holo Room V18 HTML uses your Render URL and relay token, entered locally on your phone, and PiAPI/OpenAI keys entered only for the session. Initial testing should use GET /health and 1 authorized generation only.
