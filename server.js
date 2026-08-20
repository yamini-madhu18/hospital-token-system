require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(session({
  secret: 'hospital-token-secret-key-change-later',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hour login session
}));

app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const DEPARTMENTS = ['General', 'Cardiology', 'Orthopedics', 'Pediatrics'];

// ----- Staff Schema -----
const staffSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ['doctor', 'receptionist'] },
  department: String // only relevant for doctors
});
const Staff = mongoose.model('Staff', staffSchema);

// ----- Token Schema -----
const tokenSchema = new mongoose.Schema({
  id: Number,
  name: String,
  department: String,
  status: { type: String, default: 'Waiting' },
  createdAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  doneAt: { type: Date, default: null }
});
const Token = mongoose.model('Token', tokenSchema);

// ----- Auth middleware -----
function requireLogin(req, res, next) {
  if (!req.session.staff) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireDoctor(req, res, next) {
  if (!req.session.staff || req.session.staff.role !== 'doctor') {
    return res.status(403).json({ error: 'Doctors only' });
  }
  next();
}

// ----- Auth routes -----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const staff = await Staff.findOne({ username });
  if (!staff) return res.status(401).json({ error: 'Invalid username or password' });

  const match = await bcrypt.compare(password, staff.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid username or password' });

  req.session.staff = { username: staff.username, role: staff.role, department: staff.department };
  res.json({ success: true, role: staff.role, department: staff.department });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', (req, res) => {
  res.json(req.session.staff || null);
});

// ----- Protected page: doctor admin console -----
app.get('/admin.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
});

// ----- Token estimate helpers -----
const DEFAULT_AVG_MINUTES = 5;

async function getAverageMinutes(department) {
  const recentDone = await Token.find({ department, status: 'Done', startedAt: { $ne: null }, doneAt: { $ne: null } })
    .sort({ doneAt: -1 })
    .limit(5);
  if (recentDone.length === 0) return DEFAULT_AVG_MINUTES;
  const totalMinutes = recentDone.reduce((sum, t) => sum + (t.doneAt - t.startedAt) / 60000, 0);
  return Math.round(totalMinutes / recentDone.length) || DEFAULT_AVG_MINUTES;
}

async function attachEstimates(tokens) {
  const positionCounters = {};
  const avgCache = {};
  const result = [];
  for (const t of tokens) {
    const obj = t.toObject();
    if (obj.status === 'Waiting') {
      if (!(obj.department in avgCache)) avgCache[obj.department] = await getAverageMinutes(obj.department);
      positionCounters[obj.department] = (positionCounters[obj.department] || 0) + 1;
      obj.estimatedWaitMinutes = positionCounters[obj.department] * avgCache[obj.department];
    } else {
      obj.estimatedWaitMinutes = null;
    }
    result.push(obj);
  }
  return result;
}

async function broadcast() {
  const tokens = await Token.find().sort({ createdAt: 1 });
  const withEstimates = await attachEstimates(tokens);
  io.emit('queueUpdate', withEstimates);
}

// ----- Token routes -----
app.post('/api/tokens', async (req, res) => {
  const { name, department } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'Name and department required' });
  if (!DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department' });

  const countInDept = await Token.countDocuments({ department });
  const newToken = new Token({ id: countInDept + 1, name, department, status: 'Waiting' });
  await newToken.save();
  await broadcast();
  res.json(newToken);
});

app.get('/api/tokens', async (req, res) => {
  const tokens = await Token.find().sort({ createdAt: 1 });
  const withEstimates = await attachEstimates(tokens);
  res.json(withEstimates);
});

app.get('/api/departments', (req, res) => res.json(DEPARTMENTS));

// Generate a QR code (as an image) linking to a token's live status page
app.get('/api/qrcode/:tokenId/:department', async (req, res) => {
  const { tokenId, department } = req.params;
  const statusUrl = `${req.protocol}://${req.get('host')}/status.html?id=${tokenId}&dept=${encodeURIComponent(department)}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(statusUrl);
    res.json({ qrDataUrl, statusUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Get a single token's live status (for the mobile status page)
app.get('/api/token-status/:tokenId/:department', async (req, res) => {
  const { tokenId, department } = req.params;
  const myToken = await Token.findOne({ id: Number(tokenId), department });
  if (!myToken) return res.status(404).json({ error: 'Token not found' });

  const currentServing = await Token.findOne({ department, status: 'In Progress' });
  const waitingAhead = await Token.countDocuments({
    department,
    status: 'Waiting',
    createdAt: { $lt: myToken.createdAt }
  });

  const avgMinutes = await getAverageMinutes(department);

  res.json({
    token: myToken,
    currentServingId: currentServing ? currentServing.id : null,
    peopleAhead: myToken.status === 'Waiting' ? waitingAhead : 0,
    estimatedWaitMinutes: myToken.status === 'Waiting' ? waitingAhead * avgMinutes : 0
  });
});


// Doctor calls next patient — ONLY in their own department, enforced by session
app.post('/api/call-next', requireDoctor, async (req, res) => {
  const department = req.session.staff.department;

  const current = await Token.findOne({ department, status: 'In Progress' });
  if (current) {
    current.status = 'Done';
    current.doneAt = new Date();
    await current.save();
  }

  const next = await Token.findOne({ department, status: 'Waiting' }).sort({ createdAt: 1 });
  if (next) {
    next.status = 'In Progress';
    next.startedAt = new Date();
    await next.save();
  }

  await broadcast();
  res.json(next || null);
});

app.post('/api/reset', requireLogin, async (req, res) => {
  await Token.deleteMany({});
  await broadcast();
  res.json({ message: 'Queue reset' });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});