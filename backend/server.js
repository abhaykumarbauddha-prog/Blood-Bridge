// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Middleware
app.use(cors());
app.use(express.json()); 

// Serve the browser application from the dedicated frontend directory.
app.use(express.static(path.resolve(__dirname, '../frontend')));

// Base route test
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../frontend/index.html'));
});

// Import Routes (Inhe hum next step mein banayenge)
// const authRoutes = require('./routes/authRoutes');
 const donorRoutes = require('./routes/donorRoutes');
 const requestRoutes = require('./routes/requestRoutes');
 const hospitalRoutes = require('./routes/hospitalRoutes');

// Use Routes (Abhi inko comment kiya hua hai jab tak files nahi ban jati)
// app.use('/api/auth', authRoutes);
app.use('/api/donors', donorRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/hospitals', hospitalRoutes);
// app.use('/api/hospitals', hospitalRoutes);

// Unknown API routes ko consistent JSON response do.
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// Invalid JSON jaise parsing errors ko bhi JSON response do.
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Request body must contain valid JSON.' });
  }

  next(error);
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

module.exports = app;
