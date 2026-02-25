const express = require('express');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sd16_pontianak'
};

let pool;

// Initialize database connection
async function initDatabase() {
    try {
        // First connect without database to create it if needed
        const connection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });
        
        // Create database if not exists
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
        await connection.end();
        
        // Create connection pool
        pool = mysql.createPool(dbConfig);
        
        // Create tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                nama_ortu VARCHAR(255) NOT NULL,
                no_telp VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS siswa (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                nama_anak VARCHAR(255) NOT NULL,
                umur INT NOT NULL,
                alamat TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        console.log('✅ Database connected and tables created!');
    } catch (error) {
        console.error('❌ Database connection error:', error.message);
        // Continue without database for testing
        console.log('⚠️ Running without database - registration will be in-memory only');
    }
}

// In-memory storage fallback (when database is not available)
const users = new Map();
const verificationCodes = new Map();

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'yymyg33@gmail.com',
        pass: 'Selatpanjang'
    }
});

// Generate random 6-digit code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Hash password
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Send verification email
async function sendVerificationEmail(email, code) {
    // Log to console
    console.log(`\n===========================================`);
    console.log(`📧 Verification Code for ${email}: ${code}`);
    console.log(`===========================================\n`);
    
    // Send real email
    const mailOptions = {
        from: 'SD 16 Pontianak <yymyg33@gmail.com>',
        to: email,
        subject: '🔐 Kode Verifikasi - SD 16 Pontianak',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0;">SD 16 Pontianak</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #ddd;">
                    <h2>Verifikasi Email</h2>
                    <p>Terima kasih telah mendaftar di SD 16 Pontianak.</p>
                    <p>Kode verifikasi Anda adalah:</p>
                    <div style="background: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
                        ${code}
                    </div>
                    <p style="color: #666; font-size: 12px;">Kode ini berlaku selama 10 menit.</p>
                </div>
            </div>
        `
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Error sending email:', error.message);
        return false;
    }
}

// Routes

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Send verification code
app.post('/send-code', async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, message: 'Alamat email tidak valid' });
    }
    
    // Generate new code
    const code = generateCode();
    
    // Store code with expiration (10 minutes)
    verificationCodes.set(email, {
        code: code,
        expires: Date.now() + 10 * 60 * 1000
    });
    
    // Send verification code
    const sent = await sendVerificationEmail(email, code);
    
    if (sent) {
        res.json({ success: true, message: 'Kode verifikasi telah dikirim ke email Anda!' });
    } else {
        res.status(500).json({ success: false, message: 'Gagal mengirim kode verifikasi' });
    }
});

// Verify code
app.post('/verify-code', (req, res) => {
    const { email, code } = req.body;
    
    if (!email || !code) {
        return res.status(400).json({ success: false, message: 'Email dan kode diperlukan' });
    }
    
    const storedData = verificationCodes.get(email);
    
    if (!storedData) {
        return res.status(400).json({ success: false, message: 'Kode verifikasi tidak ditemukan' });
    }
    
    // Check if code expired
    if (Date.now() > storedData.expires) {
        verificationCodes.delete(email);
        return res.status(400).json({ success: false, message: 'Kode verifikasi telah kedaluwarsa' });
    }
    
    // Check if code matches
    if (storedData.code === code) {
        verificationCodes.delete(email);
        res.json({ success: true, message: 'Verifikasi berhasil!' });
    } else {
        res.status(400).json({ success: false, message: 'Kode verifikasi salah' });
    }
});

// Register new student
app.post('/register', async (req, res) => {
    const { 
        namaAnak, 
        umur, 
        namaOrtu, 
        noTelp, 
        alamat, 
        email, 
        password 
    } = req.body;
    
    // Validation
    if (!namaAnak || !umur || !namaOrtu || !noTelp || !alamat || !email || !password) {
        return res.status(400).json({ success: false, message: 'Mohon lengkapi semua data!' });
    }
    
    const hashedPassword = hashPassword(password);
    
    try {
        if (pool) {
            // Check if email already exists
            const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUsers.length > 0) {
                return res.status(400).json({ success: false, message: 'Email sudah terdaftar!' });
            }
            
            // Insert user
            const [userResult] = await pool.query(
                'INSERT INTO users (email, password, nama_ortu, no_telp) VALUES (?, ?, ?, ?)',
                [email, hashedPassword, namaOrtu, noTelp]
            );
            
            const userId = userResult.insertId;
            
            // Insert student
            await pool.query(
                'INSERT INTO siswa (user_id, nama_anak, umur, alamat) VALUES (?, ?, ?, ?)',
                [userId, namaAnak, parseInt(umur), alamat]
            );
            
            res.json({ success: true, message: 'Pendaftaran berhasil! Silakan login.' });
        } else {
            // Fallback to in-memory storage
            if (users.has(email)) {
                return res.status(400).json({ success: false, message: 'Email sudah terdaftar!' });
            }
            
            users.set(email, {
                password: hashedPassword,
                namaAnak,
                umur,
                namaOrtu,
                noTelp,
                alamat
            });
            
            res.json({ success: true, message: 'Pendaftaran berhasil! Silakan login.' });
        }
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mendaftar' });
    }
});

// Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email dan password diperlukan' });
    }
    
    const hashedPassword = hashPassword(password);
    
    try {
        if (pool) {
            const [rows] = await pool.query(
                'SELECT users.id, users.email, users.nama_ortu, siswa.nama_anak, siswa.umur FROM users LEFT JOIN siswa ON users.id = siswa.user_id WHERE users.email = ? AND users.password = ?',
                [email, hashedPassword]
            );
            
            if (rows.length === 0) {
                return res.status(400).json({ success: false, message: 'Email atau password salah!' });
            }
            
            res.json({ 
                success: true, 
                message: 'Login berhasil!',
                data: rows[0]
            });
        } else {
            // Fallback to in-memory storage
            const user = users.get(email);
            if (!user || user.password !== hashedPassword) {
                return res.status(400).json({ success: false, message: 'Email atau password salah!' });
            }
            
            res.json({ 
                success: true, 
                message: 'Login berhasil!',
                data: { namaAnak: user.namaAnak, namaOrtu: user.namaOrtu }
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat login' });
    }
});

// Start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🚀 SD 16 Pontianak Server running at http://localhost:${PORT}`);
        console.log(`📝 Register: POST /register`);
        console.log(`🔐 Login: POST /login`);
        console.log(`📧 Verify: POST /verify-code\n`);
    });
});
