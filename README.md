# WiFi Call App (WebRTC, LAN + Internet)

Ikki foydalanuvchi ovozli aloqa qilishi uchun WebRTC (P2P) va WebSocket signaling. Lokal WiFi/hotspotda ham, internet orqali TURN/STUN bilan ham ishlashi mumkin.

## Fayl tuzilmasi
- package.json
- server/index.js — HTTP/HTTPS + WebSocket signaling (rooms, 2 peer limit)
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
Brauzer: `https://<LAN-IP>:4430` → self-signed ogohlantirishini qabul qiling → xona nomi → Ulanish → Qongiroq.

## Ishga tushirish (Docker, prod uslubi)
```bash
docker build -t wifi-call-app .
docker run -p 8080:8080 -e USE_HTTPS=false wifi-call-app
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

## Foydalanish
1) Qurilmalar bir xil tarmoqda (yoki internet + TURN).
2) Xona nomi kiriting, “Ulanish” bosing.
3) Bir tomonda “Qong‘iroq” bosing, ikkinchisida offer kelganda avtomatik javob beradi.
4) Mute/Uzish tugmalari mavjud; 3-foydalanuvchi kirsa, `room-full` xatosi.
