const socket = io();
let allTokens = [];

async function loadQueue() {
  const res = await fetch('/api/tokens');
  allTokens = await res.json();
  renderQueue();
}

document.getElementById('tokenForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const name = document.getElementById('name').value;
  const department = document.getElementById('department').value;
  const email = document.getElementById('email').value;

  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department, email })
  });

  const newToken = await res.json();

  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `✅ Token #${newToken.id} generated for ${newToken.name} (${newToken.department})`;
  resultDiv.classList.add('show');

  // Fetch and show the QR code for this token
  const qrRes = await fetch(`/api/qrcode/${newToken.id}/${encodeURIComponent(newToken.department)}`);
  const qrData = await qrRes.json();

  const qrContainer = document.getElementById('qrContainer');
  qrContainer.innerHTML = `
    <p style="margin-top:16px; font-size:13px; color:#6b7280;">📱 Scan to track your status live:</p>
    <img src="${qrData.qrDataUrl}" alt="QR Code" style="width:150px; height:150px; margin-top:8px; border-radius:8px;">
    <p style="margin-top:8px;"><a href="${qrData.statusUrl}" target="_blank" style="font-size:12px; color:#667eea;">Or tap here to open status page</a></p>
  `;

  document.getElementById('tokenForm').reset();
});

function renderQueue() {
  const list = document.getElementById('queueList');
  list.innerHTML = '';
  allTokens.forEach(token => {
    const li = document.createElement('li');
    let text = `Token #${token.id} — ${token.name} (${token.department}) — ${token.status}`;
    if (token.status === 'Waiting' && token.estimatedWaitMinutes) {
      text += ` — ~${token.estimatedWaitMinutes} min wait`;
    }
    li.innerText = text;
    li.classList.add(token.status === 'Waiting' ? 'waiting' : token.status === 'In Progress' ? 'inprogress' : 'done');
    list.appendChild(li);
  });
}

socket.on('queueUpdate', function(tokens) {
  allTokens = tokens;
  renderQueue();
});

loadQueue();