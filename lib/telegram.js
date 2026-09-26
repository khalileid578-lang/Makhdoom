// دالة مساعدة لإرسال رسالة عبر بوت تليجرام
async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return await r.json();
  } catch (e) {
    console.error('Telegram send error:', e);
    return { ok: false, error: String(e) };
  }
}

function telegramDeepLink(code) {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username || !code) return null;
  return `https://t.me/${username}?start=${code}`;
}

function generateTelegramCode() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

module.exports = { sendTelegramMessage, telegramDeepLink, generateTelegramCode };
