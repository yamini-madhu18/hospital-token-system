const socket = io();
let allTokens = [];
let myDepartment = null;

async function init() {
  const res = await fetch('/api/me', { credentials: 'include' });
  const me = await res.json();

  if (!me) {
    window.location.href = '/login.html';
    return;
  }

  myDepartment = me.department;
  document.getElementById('whoAmI').innerText = `Logged in as ${me.username} (${me.department})`;

  loadQueue();
}

async function loadQueue() {
  const res = await fetch('/api/tokens');
  allTokens = await res.json();
  renderAdminQueue();
}

document.getElementById('callNextBtn').addEventListener('click', async function() {
  const res = await fetch('/api/call-next', {
    method: 'POST',
    credentials: 'include'
  });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  await res.json();
});

document.getElementById('resetBtn').addEventListener('click', async function() {
  if (confirm('Reset the ENTIRE queue for ALL departments? This cannot be undone.')) {
    await fetch('/api/reset', { method: 'POST', credentials: 'include' });
  }
});

document.getElementById('logoutBtn').addEventListener('click', async function() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
});

function renderAdminQueue() {
  const deptTokens = allTokens.filter(t => t.department === myDepartment);

  const list = document.getElementById('adminQueueList');
  list.innerHTML = '';
  deptTokens.forEach(token => {
    const li = document.createElement('li');
    let text = `Token #${token.id} — ${token.name} — ${token.status}`;
    if (token.status === 'Waiting' && token.estimatedWaitMinutes) {
      text += ` — ~${token.estimatedWaitMinutes} min wait`;
    }
    li.innerText = text;
    li.classList.add(token.status === 'Waiting' ? 'waiting' : token.status === 'In Progress' ? 'inprogress' : 'done');
    list.appendChild(li);
  });

  const inProgress = deptTokens.find(t => t.status === 'In Progress');
  document.getElementById('nowServing').innerText = inProgress
    ? `Now Serving: Token #${inProgress.id} — ${inProgress.name}`
    : `Now Serving: None`;
}

socket.on('queueUpdate', function(tokens) {
  allTokens = tokens;
  renderAdminQueue();
});

init();