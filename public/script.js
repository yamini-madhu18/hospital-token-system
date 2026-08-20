const socket = io();

async function loadQueue() {
  const res = await fetch('/api/tokens');
  const tokens = await res.json();
  renderQueue(tokens);
}

document.getElementById('tokenForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const name = document.getElementById('name').value;
  const department = document.getElementById('department').value;

  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department })
  });

  const newToken = await res.json();

  const resultDiv = document.getElementById('result');
  resultDiv.innerText = `✅ Token #${newToken.id} generated for ${newToken.name} (${newToken.department})`;
  resultDiv.classList.add('show');

  document.getElementById('tokenForm').reset();
});

function renderQueue(tokens) {
  const list = document.getElementById('queueList');
  list.innerHTML = '';
  tokens.forEach(token => {
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
// Live updates from server — no refresh needed
socket.on('queueUpdate', renderQueue);

loadQueue();