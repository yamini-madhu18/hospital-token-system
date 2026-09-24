require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const session = require('express-session');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.default || connectMongo;
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(to, subject, content, attachments = [], isHtml = false) {
  if (!to) return;
  try {
    const mailOptions = {
      from: `"Smart Hospital" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      attachments
    };
    if (isHtml) {
      mailOptions.html = content;
    } else {
      mailOptions.text = content;
    }
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error('❌ Email send error:', err.message);
  }
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const DEPARTMENTS = ['General', 'Cardiology', 'Orthopedics', 'Pediatrics'];

const staffSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ['doctor', 'receptionist'] },
  department: String
});
const Staff = mongoose.model('Staff', staffSchema);

const tokenSchema = new mongoose.Schema({
  id: Number,
  name: String,
  email: String,
  department: String,
  status: { type: String, default: 'Waiting' },
  createdAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  doneAt: { type: Date, default: null }
});
const Token = mongoose.model('Token', tokenSchema);

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

app.get('/admin.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
});

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

app.post('/api/tokens', async (req, res) => {
  const { name, department, email } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'Name and department required' });
  if (!DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department' });

  const countInDept = await Token.countDocuments({ department });
  const newToken = new Token({ id: countInDept + 1, name, department, email, status: 'Waiting' });
  await newToken.save();
  await broadcast();

  const avgMinutes = await getAverageMinutes(department);
  const waitingAhead = await Token.countDocuments({
    department,
    status: 'Waiting',
    createdAt: { $lt: newToken.createdAt }
  });
  const estimatedWait = waitingAhead * avgMinutes;

  const statusUrl = `${req.protocol}://${req.get('host')}/status.html?id=${newToken.id}&dept=${encodeURIComponent(department)}`;
  const qrBuffer = await QRCode.toBuffer(statusUrl);

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 400px; margin: auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #667eea;">🏥 Token Confirmed</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your token has been generated!</p>

      <table style="width: 100%; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #6b7280;">Token Number</td><td style="text-align:right; font-weight:bold;">#${newToken.id}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Department</td><td style="text-align:right; font-weight:bold;">${department}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Patients ahead</td><td style="text-align:right; font-weight:bold;">${waitingAhead}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Estimated wait</td><td style="text-align:right; font-weight:bold; color:#059669;">~${estimatedWait} min</td></tr>
      </table>

      <p style="text-align:center; margin: 20px 0;">
        <img src="cid:qrcode" alt="QR Code" style="width:160px; height:160px;" />
      </p>
      <p style="text-align:center; font-size: 13px; color: #6b7280;">
        Scan anytime to check your live status, or
        <a href="${statusUrl}" style="color:#667eea;">tap here</a>.
      </p>

      <p style="font-size: 13px; color: #9ca3af; margin-top: 20px;">We'll email you again when it's almost your turn.</p>
    </div>
  `;

  sendEmail(email, 'Token Confirmed - Your Wait Details', emailHtml, [
    { filename: 'qr.png', content: qrBuffer, cid: 'qrcode' }
  ], true);

  res.json(newToken);
});

app.get('/api/tokens', async (req, res) => {
  const tokens = await Token.find().sort({ createdAt: 1 });
  const withEstimates = await attachEstimates(tokens);
  res.json(withEstimates);
});

app.get('/api/departments', (req, res) => res.json(DEPARTMENTS));

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

    sendEmail(next.email, "It's your turn!", `Hi ${next.name}, please proceed to the ${department} counter now. Your token is #${next.id}.`);

    const upcoming = await Token.findOne({ department, status: 'Waiting' }).sort({ createdAt: 1 });
    if (upcoming) {
      sendEmail(upcoming.email, "You're next!", `Hi ${upcoming.name}, you're next in line for ${department}. Please be ready — token #${upcoming.id}.`);
    }
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