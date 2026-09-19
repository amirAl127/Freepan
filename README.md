# VLESS Panel

پنل سبک مدیریت کاربران VLESS/Xray.

## Features

- Persian RTL dashboard
- User management
- UUID generation
- Enable/disable users
- Delete users
- VLESS link generation
- Xray configuration endpoint
- Railway deployment
- Health check
- WebSocket + TLS
- No UDP
- No QUIC
- No WireGuard

## Environment Variables

PANEL_SECRET=your-secret
PUBLIC_HOST=example.com
PUBLIC_PORT=443
WS_PATH=/ws
SNI=example.com

PORT توسط Railway تنظیم می‌شود و نیازی به تعریف دستی آن نیست.

## Local installation

```bash
npm install
npm start
