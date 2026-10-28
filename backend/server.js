// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const allowedOrigin = process.env.CORS_ORIGIN || `http://${HOST}:${PORT}`;

// Security middleware configured for local development and CDN assets
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: [
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://api.mapbox.com",
        "https://*.tile.openstreetmap.org",
        "https://nominatim.openstreetmap.org",
        "https://*.nrsc.gov.in",
        "https://bhuvan.nrsc.gov.in",
        "https://generativelanguage.googleapis.com",
        "http://127.0.0.1:*",
        "http://localhost:*"
      ],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  strictTransportSecurity: false
}));

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, skip: (req) => req.method === 'GET' }));

// Serve the browser application from the dedicated frontend directory.
app.use(express.static(path.resolve(__dirname, '../frontend')));

// Base route test
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../frontend/index.html'));
});

// Friendly auth shortcuts
app.get('/signup', (req, res) => {
  res.redirect('/auth.html?mode=signup');
});
app.get('/login', (req, res) => {
  res.redirect('/auth.html?mode=login');
});

// Import Routes (Inhe hum next step mein banayenge)
// const authRoutes = require('./routes/authRoutes');
 const donorRoutes = require('./routes/donorRoutes');
 const requestRoutes = require('./routes/requestRoutes');
 const hospitalRoutes = require('./routes/hospitalRoutes');
 const smartMatchRoutes = require('./routes/smartMatchRoutes');
 const chatRoutes = require('./routes/chatRoutes');

// Use Routes (Abhi inko comment kiya hua hai jab tak files nahi ban jati)
// app.use('/api/auth', authRoutes);
app.use('/api/donors', donorRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/smart-match', smartMatchRoutes);
app.use('/api/chat', chatRoutes);

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
