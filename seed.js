require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const staffSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ['doctor', 'receptionist'] },
  department: String
});
const Staff = mongoose.model('Staff', staffSchema);

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);

  const accounts = [
    { username: 'dr.general', password: 'general123', role: 'doctor', department: 'General' },
    { username: 'dr.cardio', password: 'cardio123', role: 'doctor', department: 'Cardiology' },
    { username: 'dr.ortho', password: 'ortho123', role: 'doctor', department: 'Orthopedics' },
    { username: 'dr.pedia', password: 'pedia123', role: 'doctor', department: 'Pediatrics' },
    { username: 'reception', password: 'reception123', role: 'receptionist', department: null }
  ];

  for (const acc of accounts) {
    const exists = await Staff.findOne({ username: acc.username });
    if (exists) { console.log(`Skipped (already exists): ${acc.username}`); continue; }

    const passwordHash = await bcrypt.hash(acc.password, 10);
    await Staff.create({ username: acc.username, passwordHash, role: acc.role, department: acc.department });
    console.log(`✅ Created: ${acc.username} / ${acc.password}`);
  }

  mongoose.disconnect();
}

seed();