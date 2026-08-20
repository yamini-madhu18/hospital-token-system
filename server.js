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
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(to, subject, text) {
  if (!to) return; // skip if patient didn't provide an email
  try {
    await transporter.sendMail({
      from: `"Smart Hospital" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text
    });
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error('❌ Email send error:', err.message);
  }
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(session({
  secret: 'hospital-token-secret-key-change-later',
  resave: false,
  saveUninitialized: false,
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
  if (!req.session.staff) return