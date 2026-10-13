/** The one-line website chat bubble: <script src="https://<worker>/widget.js" defer></script> */
export function widgetScript(origin: string, businessName: string): string {
  return `(() => {
  const ORIGIN = ${JSON.stringify(origin)}, NAME = ${JSON.stringify(businessName)};
  const history = [];
  const css = '#ajna-c{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:15px/1.45 system-ui,sans-serif}' +
    '#ajna-c button.o{width:56px;height:56px;border-radius:50%;border:0;background:#111;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25)}' +
    '#ajna-c .p{display:none;width:min(360px,calc(100vw - 32px));height:480px;background:#fff;color:#111;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.25);flex-direction:column;overflow:hidden}' +
    '#ajna-c .h{padding:12px 14px;background:#111;color:#fff;font-weight:600}#ajna-c .l{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '#ajna-c .m{max-width:85%;padding:8px 12px;border-radius:12px;white-space:pre-wrap}#ajna-c .u{align-self:flex-end;background:#111;color:#fff}#ajna-c .a{align-self:flex-start;background:#f1f1f4}' +
    '#ajna-c form{display:flex;gap:6px;padding:10px;border-top:1px solid #eee}#ajna-c input{flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;font:inherit}';
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'ajna-c';
  root.innerHTML = '<div class="p" role="dialog" aria-label="Mesaj"><div class="h"></div><div class="l" aria-live="polite"></div><form><input maxlength="600" aria-label="Mesajınız" placeholder="Mesajınızı yazın"><button>Gönder</button></form></div><button class="o" aria-label="Mesaj gönder">💬</button>';
  document.body.appendChild(root);
  const panel = root.querySelector('.p'), log = root.querySelector('.l'), input = root.querySelector('input');
  root.querySelector('.h').textContent = NAME;
  const add = (c, t) => { const d = document.createElement('div'); d.className = 'm ' + c; d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  root.querySelector('.o').onclick = () => { panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex'; if (!log.children.length) add('a', 'Merhaba! Size nasıl yardımcı olabilirim?'); };
  root.querySelector('form').onsubmit = async (e) => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; add('u', text);
    try {
      const r = await fetch(ORIGIN + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, history }) });
      const j = await r.json(); add('a', j.reply || 'Şu an cevap veremiyorum.');
      if (j.reply) history.push({ role: 'user', content: text }, { role: 'assistant', content: j.reply });
    } catch { add('a', 'Bağlantı hatası, tekrar deneyin.'); }
  };
})();`;
}
