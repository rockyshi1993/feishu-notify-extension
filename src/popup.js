// Popup: status, queue, recent events and pause/resume controls.
const $ = (id) => document.getElementById(id);
const MODES = {
  running: 'Running', disabled: 'Disabled', authInvalid: 'Key invalid – auto-push paused',
  snoozed: 'Paused', outsideHours: 'Outside work hours – queueing', notConfigured: 'Not configured',
};
const send = (m) => chrome.runtime.sendMessage(m);

function render(s) {
  $('mode').textContent = MODES[s.mode] || s.mode;
  $('queue').textContent = s.queue;
  $('dropped').textContent = s.dropped;
  $('last').textContent = s.lastSend ? `${s.lastSendTime} ${s.lastSend.ok ? 'OK' : 'FAIL'} (${s.lastSend.status || s.lastSend.error})` : '-';
  const ul = $('log'); ul.textContent = '';
  for (const l of s.log) {
    const li = document.createElement('li');
    li.textContent = `${l.time} ${l.kind}${l.chat ? ` · ${l.chat}` : ''}${l.note ? ` · ${l.note}` : ''}`;
    ul.appendChild(li);
  }
}

/** Next local morning 09:00 in the configured time zone, as an ISO instant. */
function tomorrowMorning(tz) {
  const now = new Date();
  for (let h = 1; h <= 48; h++) {
    const t = new Date(now.getTime() + h * 3600e3);
    const hh = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(t);
    if (hh === '09') { t.setMinutes(0, 0, 0); return t.toISOString(); }
  }
  return new Date(now.getTime() + 16 * 3600e3).toISOString();
}

let tz = 'Asia/Shanghai';
document.querySelectorAll('[data-snooze]').forEach((b) => {
  b.onclick = async () => {
    const v = b.dataset.snooze;
    const until = v === 'morning' ? tomorrowMorning(tz) : new Date(Date.now() + 60 * 60000).toISOString();
    render(await send({ type: 'snooze', until }));
  };
});
$('resume').onclick = async () => render(await send({ type: 'resume' }));
$('flush').onclick = async () => render(await send({ type: 'flush-now' }));
send({ type: 'status' }).then((s) => { tz = s.timezone; render(s); });
