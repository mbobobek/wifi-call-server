import fetch from 'node-fetch';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN kerak');

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

let offset = 0;
async function loop() {
  try {
    const res = await api('getUpdates', { timeout: 30, offset });
    const data = await res.json();
    for (const u of data.result || []) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (msg?.text === '/start') {
        await api('sendMessage', {
          chat_id: msg.chat.id,
          text: 'WiFi Call: pastdagi “WiFi Call” tugmasini bosing, sahifa ochilgach Connect ni bosing va qo‘ng‘iroq qiling.'
        });
      }
    }
  } catch (err) {
    console.error(err);
    await new Promise((r) => setTimeout(r, 3000));
  }
  setImmediate(loop);
}

loop();
