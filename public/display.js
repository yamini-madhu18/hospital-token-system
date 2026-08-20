const socket = io();

function updateDisplay(tokens) {
  const currentToken = tokens.find(t => t.status === 'In Progress');
  const waitingTokens = tokens.filter(t => t.status === 'Waiting');

  const servingDiv = document.getElementById('displayServing');
  servingDiv.innerHTML = currentToken
    ? `<span class="statusDot"></span> Token #${currentToken.id} — ${currentToken.name}`
    : 'No patient currently being served';

  const list = document.getElementById('displayQueue');
  list.innerHTML = '';
  waitingTokens.forEach(t => {
    const li = document.createElement('li');
    let text = `Token #${t.id} — ${t.name} (${t.department})`;
    if (t.estimatedWaitMinutes) text += ` — ~${t.estimatedWaitMinutes} min`;
    li.innerText = text;
    list.appendChild(li);
  });
}

socket.on('queueUpdate', updateDisplay);

fetch('/api/tokens').then(res => res.json()).then(updateDisplay);