const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 2213; // port dari Pterodactyl

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database (file database.db akan dibuat otomatis)
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Gagal konek database:', err.message);
  } else {
    console.log('Database siap.');

    // Buat tabel games jika belum ada
    db.run(`CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      image TEXT,
      category TEXT,
      nominals TEXT,
      discount INTEGER
    )`);

    // Buat tabel orders jika belum ada
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_name TEXT,
      player_id TEXT,
      nominal INTEGER,
      payment_method TEXT,
      status TEXT DEFAULT 'pending',
      snap_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed data game (jika tabel masih kosong)
    db.get("SELECT COUNT(*) as count FROM games", (err, row) => {
      if (row && row.count === 0) {
        console.log('Menambahkan data game...');
        const games = [
          ["Mobile Legends", "https://play-lh.googleusercontent.com/KLe3Grp6RflxNHkSAQ8d3qUVaSfWYdNyYw_s9J0UqRQ4JU8xQFm_X0eQ_Ke1j6pAKiE", "mobile", "[86,172,344,516,860]", 20],
          ["Free Fire", "https://play-lh.googleusercontent.com/Yd9QOdK8BL6iVUFd7Sx_R8WlDnXoWBzFyYiDdYtPR1RVrHXmJLSRSTX4BKqF_zP4bw", "mobile", "[70,140,355,710]", 15],
          ["PUBG Mobile", "https://play-lh.googleusercontent.com/0FJqNW8p5jUQUvIBGFqDYJ_J1_mkHAqD3nGzYbDNO4bIhHxZmPO2BXgW6EJDnLxGWtk", "mobile", "[135,270,540,1350]", 10],
          ["Valorant", "https://play-lh.googleusercontent.com/bYQ7vVJ0dXgH4l_qvY3g1nEefVG5e7aBD8eJ4_9F1G9FR8o1QGWL4Z7aAXRBjK_RtQ", "pc", "[125,250,625,1250]", 5],
          ["Steam Wallet", "https://store.cloudflare.steamstatic.com/public/shared/images/header/globalheader_logo.png?t=155015", "voucher", "[60000,120000,250000]", 15],
          ["Google Play", "https://play-lh.googleusercontent.com/1-hPxaf6dGxh0ZgIl0fUkpWJqF4QHf5OQrYiVq1X0M8_nNR9Qp0xJfQK0A4_yX4aLg", "voucher", "[50000,100000,150000]", 10]
        ];
        const stmt = db.prepare("INSERT INTO games (name, image, category, nominals, discount) VALUES (?,?,?,?,?)");
        games.forEach(g => stmt.run(g[0], g[1], g[2], g[3], g[4]));
        stmt.finalize();
      }
    });
  }
});

// ================== API ROUTES ==================

// GET /api/games?category=all
app.get('/api/games', (req, res) => {
  const category = req.query.category || 'all';
  let query = "SELECT * FROM games";
  const params = [];
  if (category !== 'all') {
    query += " WHERE category = ?";
    params.push(category);
  }
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const games = rows.map(row => ({
      ...row,
      nominals: JSON.parse(row.nominals)
    }));
    res.json(games);
  });
});

// POST /api/orders
app.post('/api/orders', (req, res) => {
  const { game_name, player_id, nominal, payment_method } = req.body;
  if (!game_name || !player_id || !nominal || !payment_method) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }
  db.run("INSERT INTO orders (game_name, player_id, nominal, payment_method) VALUES (?,?,?,?)",
    [game_name, player_id, nominal, payment_method],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        id: this.lastID,
        game_name,
        player_id,
        nominal,
        payment_method,
        status: 'pending'
      });
    }
  );
});

// POST /api/create-transaction
app.post('/api/create-transaction', (req, res) => {
  const { order_id } = req.body;
  const token = `snap-${order_id}-${Date.now()}`;
  db.run("UPDATE orders SET snap_token = ? WHERE id = ?", [token, order_id]);
  res.json({
    token,
    redirect_url: `/payment?token=${token}&order_id=${order_id}`
  });
});

// POST /api/midtrans/notification
app.post('/api/midtrans/notification', (req, res) => {
  const { order_id, transaction_status } = req.body;
  const status = transaction_status === 'settlement' ? 'success' : 'failed';
  db.run("UPDATE orders SET status = ? WHERE id = ?", [status, order_id]);
  res.json({ status: 'ok' });
});

// GET /payment?token=...&order_id=...
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// GET /admin (panel sederhana)
app.get('/admin', (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 30", (err, orders) => {
    if (err) return res.send('Error database');
    let html = `<html><head><title>Admin LuxTopup</title><meta charset="utf-8"><style>body{font-family:sans-serif;background:#1a1035;color:white;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:8px}th{background:#7c3aed}</style></head><body>`;
    html += '<h1>📋 Admin - Pesanan</h1>';
    html += '<table><tr><th>ID</th><th>Game</th><th>ID Pemain</th><th>Nominal</th><th>Pembayaran</th><th>Status</th><th>Waktu</th></tr>';
    orders.forEach(o => {
      html += `<tr>
        <td>${o.id}</td>
        <td>${o.game_name}</td>
        <td>${o.player_id}</td>
        <td>Rp${o.nominal.toLocaleString('id-ID')}</td>
        <td>${o.payment_method}</td>
        <td>${o.status}</td>
        <td>${o.created_at}</td>
      </tr>`;
    });
    html += '</table></body></html>';
    res.send(html);
  });
});

// Fallback untuk SPA (opsional)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== START SERVER ==================
const PORT = process.env.PORT || 2213;
app.listen(PORT, '0.0.0.0', () => {
  console.log(` Server ZyppaStore berjalan di port ${PORT}`);
});