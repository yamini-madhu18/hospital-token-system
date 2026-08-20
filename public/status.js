const params = new URLSearchParams(window.location.search);
const tokenId = params.get('id');
const department = params.get('dept');

const socket = io();

async function loadStatus() {
  const res = await fetch(`/api/token-status/${tokenId}/${encodeURIComponent(department)}`);
  if (!res.ok) {
    document.getElementById('statusContent').innerText = 'Token not found.';
    return;
  }
  const data = await res.json();
  render(data);
}

function render(data) {
  const { token, currentServingId, peopleAhead, estimatedWaitMinutes } = data;
  const container = document.getElementById('statusContent');

  let statusHtml = '';
  if (token.status === 'Done') {
    statusHtml = `<p style="font-size:18px; color:#10b981; font-weight:700;">✅ Your consultation is complete</p>`;
  } else if (token.status === 'In Progress') {
    statusHtml = `<p style="font-size:20px; color:#ea580c; font-weight:700;">🔔 It's your turn now!</p>`;
  } else {
    statusHtml = `
      <p style="font-size:16px; color:#374151;">Token <strong>#${token.id}</strong> — ${token.department}</p>
      <p style="font-size:14px; color:#6b7280; margin-top:8px;">Now serving: Token #${currentServingId || '—'}</p>
      <p style="font-size:22px; color:#667eea; font-weight:700; margin-top:14px;">${peopleAhead} patient${peopleAhead === 1 ? '' : 's'} ahead of you</p>
      <p style="font-size:16px; color:#6b7280; margin-top:6px;">~${estimatedWaitMinutes} min estimated wait</p>
    `;
  }

  container.innerHTML = statusHtml;
}

// Refresh whenever the queue changes anywhere in the system
socket.on('queueUpdate', loadStatus);

loadStatus();