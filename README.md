# CallWave (WebRTC, LAN + Internet)

Ikki foydalanuvchi ovozli aloqa qilishi uchun WebRTC (P2P) va WebSocket signaling. Lokal WiFi/hotspotda ham, internet orqali TURN/STUN bilan ham ishlaydi. Xona talab qilinmaydi — onlayn ro‘yxatdan foydalanuvchini tanlab qo‘ng‘iroq qiling.

## Fayl tuzilmasi
- package.json
- server/index.js — HTTP/HTTPS + WebSocket signaling (online ro‘yxat, peer-to-peer)
- client/ — statik UI
- cert/ — dev uchun self-signed TLS (prod uchun kerak emas)
- .env.example — sozlamalar namunasi
- Dockerfile, docker-compose.yml — deploy/test uchun

## Konfiguratsiya
- `.env` (namuna: `.env.example`): `PORT`, `HOST`, `USE_HTTPS` (dev’da true, Render/Railway’da false), `TURN_URL/USER/PASS`.
- Dev self-signed sertifikat: `cert/server.crt|key` (TLS kerak bo‘lsa).

## Ishga tushirish (lokal dev, TLS bilan)
```bash
npm install
npm run start:dev   # USE_HTTPS=true, default 4430
# yoki npm start (USE_HTTPS default true)
```
Brauzer: `https://<LAN-IP>:4430` → self-signed ogohlantirishini qabul qiling → “Onlayn bo‘lish” → ro‘yxatdan foydalanuvchini tanlab qo‘ng‘iroq qiling.

## Ishga tushirish (Docker, prod uslubi)
```bash
docker build -t callwave-app .
docker run -p 8080:8080 -e USE_HTTPS=false callwave-app
# yoki docker-compose up --build
```
Brauzer: `http(s)://localhost:8080` (platforma TLS terminatsiya qilsa, https/wss bo‘ladi).

## Render / Railway
- Start: `node server/index.js`
- Env: `USE_HTTPS=false`, `PORT`ni platforma beradi.
- Domen: platforma bergan `https://<app>.onrender.com`, WebSocket avtomatik `wss://<app>.onrender.com/ws`.
- TURN: internet orqali ishlatish uchun `TURN_URL/USER/PASS` ni qo‘ying (UI sahifasida global o‘zgaruvchilar).

## TURN/STUN
- STUN: `stun:stun.l.google.com:19302` default bor.
- TURN kerak bo‘lsa (NAT orti): o‘zingizning coturn serveringizni 3478/5349 portlarda oching va credentiallarni `.env` + `client/index.html` ga (window.TURN_*) kiriting.

### O'z TURN (coturn) serverini ishga tushirish (Docker)
1) `turn/turnserver.conf.example` ni nusxa oling:
```
cp turn/turnserver.conf.example turn/turnserver.conf
```
`realm`, `user`, va parolni yangilang. TLS sertlaringiz bo'lsa, `cert`/`pkey` yo'llarini oching.
2) Docker compose bilan ishga tushiring:
```
docker compose -f docker-compose.turn.yml up -d
```
3) Klientga credentiallarni qo'shing (hozir kodda OpenRelay ishlatilmoqda; o'zingiznikiga o'zgartirmoqchi bo'lsangiz, `client/app.js` dagi iceServers blokini moslang).

## Foydalanish
1) Qurilmalar bir xil tarmoqda (yoki internet + TURN).
2) “Onlayn bo‘lish” tugmasini bosing.
3) Onlayn ro‘yxatdan foydalanuvchini tanlab qo‘ng‘iroq qiling; qabul tomoni avtomatik javob beradi.
4) Mute/Uzish tugmalari mavjud; onlayn ro‘yxat avtomatik yangilanadi.
