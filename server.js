const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
require('dotenv').config();

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (err) {
    console.warn('nodemailer РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ, email-РєРѕРґС‹ Р±СѓРґСѓС‚ РІС‹РІРѕРґРёС‚СЊСЃСЏ РІ РєРѕРЅСЃРѕР»СЊ');
}

const app = express();
const PORT = 3000;
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'sozvezdie_secret_key_2026';
const sessionDbDir = process.env.SESSION_DB_DIR || __dirname;

if (!fs.existsSync(sessionDbDir)) {
    fs.mkdirSync(sessionDbDir, { recursive: true });
}

app.set('trust proxy', 1);

// =============================================
// РќРђРЎРўР РћР™РљРђ РџРЈРўР•Р™
// =============================================


const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// =============================================
// РџРћР”РљР›Р®Р§Р•РќРР• Рљ Р‘Р”
// =============================================
const db = new sqlite3.Database('./soz.db', (err) => {
    if (err) {
        console.error('РћС€РёР±РєР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє Р‘Р”:', err.message);
    } else {
        console.log('РџРѕРґРєР»СЋС‡РµРЅРѕ Рє SQLite Р±Р°Р·Рµ РґР°РЅРЅС‹С…');
    }
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

function slugify(value, fallback = 'user') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/С‘/g, 'Рµ')
        .replace(/[^a-z0-9Р°-СЏ_-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
    return slug || fallback;
}

function getDefaultAvatar(user) {
    const seed = Number(user?.id || 1) % 70;
    return user?.avatar || `https://i.pravatar.cc/160?img=${seed || 44}`;
}

function publicUser(user) {
    if (!user) return null;
    const name = user.full_name || user.email || 'Пользователь';
    const memberships = user.memberships_json
        ? String(user.memberships_json).split('||').filter(Boolean).map((item) => {
            const [id, name, shortName] = item.split('::');
            return { id: Number(id), name, shortName };
        })
        : [];
    return {
        id: user.id,
        full_name: name,
        name,
        email: user.email,
        phone: user.phone,
        username: user.username || slugify(name, `user${user.id}`),
        handle: user.username || slugify(name, `user${user.id}`),
        avatar: getDefaultAvatar(user),
        cover: user.cover || '',
        bio: user.bio || '',
        points: Number(user.points || 0),
        role: user.role || 'user',
        isAdmin: user.role === 'admin' || user.email === 'ultrasecret@admin.com',
        isBanned: Boolean(user.is_banned),
        bannedAt: user.banned_at || null,
        memberships
    };
}

async function getCurrentUser(req) {
    if (!req.session.userId) return null;
    const user = await dbGet(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.avatar, u.username, u.bio, u.cover, u.points,
                u.is_banned, u.banned_at,
                GROUP_CONCAT(usm.squad_id || '::' || s.name || '::' || s.short_name, '||') AS memberships_json
         FROM users u
         LEFT JOIN user_squad_memberships usm ON usm.user_id = u.id
         LEFT JOIN squads s ON s.id = usm.squad_id
         WHERE u.id = ?
         GROUP BY u.id`,
        [req.session.userId]
    );
    return publicUser(user);
}

async function requireUser(req, res) {
    const user = await getCurrentUser(req);
    if (!user) {
        res.status(401).json({ error: 'Не авторизован' });
        return null;
    }
    if (user.isBanned) {
        res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
        return null;
    }
    return user;
}

function isAdminUser(user) {
    return Boolean(user && (user.role === 'admin' || user.email === 'ultrasecret@admin.com'));
}

async function addColumnIfMissing(table, column, definition) {
    const columns = await dbAll(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) {
        await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

function generateSixDigitCode() {
    return String(crypto.randomInt(100000, 1000000));
}

async function sendMail(to, subject, text) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;

    if (!nodemailer || !smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
        throw new Error('РџРѕС‡С‚Р° РЅРµ РЅР°СЃС‚СЂРѕРµРЅР°. Р—Р°РїРѕР»РЅРёС‚Рµ SMTP-РЅР°СЃС‚СЂРѕР№РєРё РІ .env');
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true',
        auth: { user: smtpUser, pass: smtpPass }
    });

    await transporter.sendMail({
        from: smtpFrom,
        to,
        subject,
        text
    });
    return { sent: true };
}

async function createEmailCode({ email, purpose, payload = null, userId = null }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const code = generateSixDigitCode();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const mail = await sendMail(
        normalizedEmail,
        'РљРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РЎРѕР·РІРµР·РґРёРµ',
        `Р’Р°С€ РєРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ: ${code}. РћРЅ РґРµР№СЃС‚РІСѓРµС‚ 10 РјРёРЅСѓС‚.`
    );

    await dbRun(
        `INSERT INTO email_verification_codes (user_id, email, purpose, code_hash, payload_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, normalizedEmail, purpose, codeHash, payload ? JSON.stringify(payload) : null, expiresAt]
    );

    return {
        email: normalizedEmail,
        expiresAt,
        sent: mail.sent
    };
}

async function verifyEmailCode({ email, purpose, code, userId = null }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const codeHash = crypto.createHash('sha256').update(String(code || '')).digest('hex');
    const row = await dbGet(
        `SELECT * FROM email_verification_codes
         WHERE email = ? AND purpose = ? AND used_at IS NULL
           AND (? IS NULL OR user_id = ?)
         ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
        [normalizedEmail, purpose, userId, userId]
    );
    if (!row) {
        throw new Error('РљРѕРґ РЅРµ РЅР°Р№РґРµРЅ. Р—Р°РїСЂРѕСЃРёС‚Рµ РЅРѕРІС‹Р№ РєРѕРґ.');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
        throw new Error('РЎСЂРѕРє РґРµР№СЃС‚РІРёСЏ РєРѕРґР° РёСЃС‚С‘Рє.');
    }
    if (row.code_hash !== codeHash) {
        throw new Error('РќРµРІРµСЂРЅС‹Р№ РєРѕРґ.');
    }
    await dbRun(`UPDATE email_verification_codes SET used_at = datetime('now') WHERE id = ?`, [row.id]);
    return row.payload_json ? JSON.parse(row.payload_json) : {};
}

async function initSocialSchema() {
    await addColumnIfMissing('users', 'username', 'TEXT');
    await addColumnIfMissing('users', 'bio', 'TEXT');
    await addColumnIfMissing('users', 'cover', 'TEXT');
    await addColumnIfMissing('users', 'points', 'INTEGER DEFAULT 1000');
    await addColumnIfMissing('users', 'is_profile_complete', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('users', 'is_banned', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('users', 'banned_at', 'TEXT');
    await addColumnIfMissing('users', 'banned_reason', 'TEXT');
    await addColumnIfMissing('users', 'banned_by', 'INTEGER');

    await dbRun(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL,
        wall_owner_id INTEGER NOT NULL,
        text TEXT,
        status TEXT NOT NULL DEFAULT 'published',
        source TEXT NOT NULL DEFAULT 'own',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (wall_owner_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS post_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS post_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        actor_id INTEGER,
        type TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        action_state TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS social_tests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        reward INTEGER NOT NULL,
        questions_json TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS user_test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        test_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        max_score INTEGER NOT NULL,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, test_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (test_id) REFERENCES social_tests(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS merch_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        is_active INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS merch_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        merch_item_id INTEGER NOT NULL,
        squad TEXT,
        role TEXT,
        buyer_name TEXT,
        price INTEGER NOT NULL,
        status TEXT DEFAULT 'created',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (merch_item_id) REFERENCES merch_items(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS points_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_type TEXT,
        ref_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('direct','group')),
        title TEXT,
        slug TEXT,
        avatar TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS chat_members (
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_read_at TEXT,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS chat_message_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        payload_json TEXT,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS user_squad_memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        squad_id INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'admin',
        application_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, squad_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
    )`);

    const adminEmail = 'ultrasecret@admin.com';
    const adminPasswordHash = await bcrypt.hash('adminpass567', 10);
    const existingAdmin = await dbGet(`SELECT id FROM users WHERE email = ?`, [adminEmail]);
    if (existingAdmin) {
        await dbRun(
            `UPDATE users SET role = 'admin', password_hash = ?, is_banned = 0, banned_at = NULL, updated_at = datetime('now') WHERE id = ?`,
            [adminPasswordHash, existingAdmin.id]
        );
    } else {
        await dbRun(
            `INSERT INTO users (full_name, email, phone, password_hash, role, username, points, created_at, updated_at)
             VALUES ('Администратор', ?, 'email:ultrasecret@admin.com', ?, 'admin', 'admin', 1000, datetime('now'), datetime('now'))`,
            [adminEmail, adminPasswordHash]
        );
    }

    const testsCount = await dbGet(`SELECT COUNT(*) AS count FROM social_tests`);
    if (!testsCount.count) {
        const tests = [
            { id: 'safety', title: 'Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ РІ СЃРµС‚Рё', reward: 12, order: 1, questions: [
                { text: 'РљР°РєРѕР№ РїР°СЂРѕР»СЊ СЃС‡РёС‚Р°РµС‚СЃСЏ РЅР°РґС‘Р¶РЅС‹Рј?', options: ['12345678', 'qwerty2024', 'РЎР»СѓС‡Р°Р№РЅС‹Р№ РґР»РёРЅРЅС‹Р№ РїР°СЂРѕР»СЊ СЃ СЂР°Р·РЅС‹РјРё СЃРёРјРІРѕР»Р°РјРё'], correctIndex: 2 },
                { text: 'Р§С‚Рѕ РґРµР»Р°С‚СЊ, РµСЃР»Рё РїСЂРёС€Р»Р° РїРѕРґРѕР·СЂРёС‚РµР»СЊРЅР°СЏ СЃСЃС‹Р»РєР°?', options: ['РћС‚РєСЂС‹С‚СЊ Рё РїСЂРѕРІРµСЂРёС‚СЊ', 'РРіРЅРѕСЂРёСЂРѕРІР°С‚СЊ Рё СѓРґР°Р»РёС‚СЊ', 'РџРµСЂРµСЃР»Р°С‚СЊ РІСЃРµРј РґСЂСѓР·СЊСЏРј'], correctIndex: 1 },
                { text: 'Р”Р»СЏ С‡РµРіРѕ РЅСѓР¶РЅР° РґРІСѓС…С„Р°РєС‚РѕСЂРЅР°СЏ Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ?', options: ['Р”Р»СЏ РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕР№ Р·Р°С‰РёС‚С‹ Р°РєРєР°СѓРЅС‚Р°', 'Р”Р»СЏ РєСЂР°СЃРѕС‚С‹ РїСЂРѕС„РёР»СЏ', 'Р§С‚РѕР±С‹ Р±С‹СЃС‚СЂРµРµ РІС…РѕРґРёС‚СЊ Р±РµР· РїР°СЂРѕР»СЏ'], correctIndex: 0 }
            ] },
            { id: 'content', title: 'Р­С‚РёС‡РЅС‹Р№ РєРѕРЅС‚РµРЅС‚', reward: 8, order: 2, questions: [
                { text: 'РњРѕР¶РЅРѕ Р»Рё РїСѓР±Р»РёРєРѕРІР°С‚СЊ С‡СѓР¶РѕРµ С„РѕС‚Рѕ Р±РµР· СЂР°Р·СЂРµС€РµРЅРёСЏ?', options: ['Р”Р°, РµСЃР»Рё С„РѕС‚Рѕ РєСЂР°СЃРёРІРѕРµ', 'РќРµС‚, РЅСѓР¶РЅРѕ СЂР°Р·СЂРµС€РµРЅРёРµ', 'Р”Р°, РµСЃР»Рё СѓРґР°Р»РёС‚СЊ Р°РІС‚РѕСЂР°'], correctIndex: 1 },
                { text: 'РљР°Рє СЂРµР°РіРёСЂРѕРІР°С‚СЊ РЅР° С‚РѕРєСЃРёС‡РЅС‹Рµ РєРѕРјРјРµРЅС‚Р°СЂРёРё?', options: ['РћС‚РІРµС‚РёС‚СЊ Р°РіСЂРµСЃСЃРёРµР№', 'РџРѕР¶Р°Р»РѕРІР°С‚СЊСЃСЏ Рё РЅРµ СЂР°Р·Р¶РёРіР°С‚СЊ РєРѕРЅС„Р»РёРєС‚', 'РџСѓР±Р»РёРєРѕРІР°С‚СЊ СЃРєСЂРёРЅС‹ СЃ РѕСЃРєРѕСЂР±Р»РµРЅРёСЏРјРё'], correctIndex: 1 }
            ] },
            { id: 'creative', title: 'РљСЂРµР°С‚РёРІРЅС‹Р№ РјРёРЅРё-С‚РµСЃС‚', reward: 15, order: 3, questions: [
                { text: 'Р§С‚Рѕ РІР°Р¶РЅРµРµ РІ РїРµСЂРІРѕРј РєР°РґСЂРµ СЂРѕР»РёРєР°?', options: ['РЎРёР»СЊРЅС‹Р№ С…СѓРє Рё РїРѕРЅСЏС‚РЅР°СЏ РёРґРµСЏ', 'РЎР»СѓС‡Р°Р№РЅС‹Р№ РєР°РґСЂ', 'РўРѕР»СЊРєРѕ РјСѓР·С‹РєР°'], correctIndex: 0 },
                { text: 'РљР°Рє РїРѕРІС‹СЃРёС‚СЊ РІРѕРІР»РµС‡РµРЅРёРµ РІ РїРѕСЃС‚Рµ?', options: ['Р—Р°РґР°С‚СЊ РІРѕРїСЂРѕСЃ Р°СѓРґРёС‚РѕСЂРёРё', 'РЎРґРµР»Р°С‚СЊ РґР»РёРЅРЅС‹Р№ Р·Р°РіРѕР»РѕРІРѕРє Р±РµР· СЃРјС‹СЃР»Р°', 'РћС‚РєР»СЋС‡РёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёРё'], correctIndex: 0 },
                { text: 'Р—Р°С‡РµРј РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РµРґРёРЅС‹Р№ РІРёР·СѓР°Р»СЊРЅС‹Р№ СЃС‚РёР»СЊ РїСЂРѕС„РёР»СЏ?', options: ['Р§С‚РѕР±С‹ РїСЂРѕС„РёР»СЊ Р»РµРіС‡Рµ Р·Р°РїРѕРјРёРЅР°Р»СЃСЏ', 'Р­С‚Рѕ РЅРёРєР°Рє РЅРµ РІР»РёСЏРµС‚', 'Р§С‚РѕР±С‹ СЃРєСЂС‹С‚СЊ С‚РµРєСЃС‚'], correctIndex: 0 },
                { text: 'Р§С‚Рѕ Р»СѓС‡С€Рµ РґР»СЏ РїРѕРЅСЏС‚РЅРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ?', options: ['РћРґРёРЅ РіР»Р°РІРЅС‹Р№ С‚РµР·РёСЃ', 'РЎСЂР°Р·Сѓ 10 СЂР°Р·РЅС‹С… РјС‹СЃР»РµР№', 'РўРѕР»СЊРєРѕ СЌРјРѕРґР·Рё'], correctIndex: 0 }
            ] }
        ];
        for (const test of tests) {
            await dbRun(
                `INSERT INTO social_tests (id, title, reward, questions_json, order_index) VALUES (?, ?, ?, ?, ?)`,
                [test.id, test.title, test.reward, JSON.stringify(test.questions), test.order]
            );
        }
    }

    const merchCount = await dbGet(`SELECT COUNT(*) AS count FROM merch_items`);
    if (!merchCount.count) {
        const merch = [
            ['Р¤СѓС‚Р±РѕР»РєР°', 4000, '/images/С„СѓС‚Р±РѕР»РєР°.png', 1],
            ['РўРµСЂРјРѕРєСЂСѓР¶РєР°', 1000, '/images/С‚РµСЂРјРѕРєСЂСѓР¶РєР°.png', 2],
            ['РЁРѕРїРїРµСЂ', 7000, '/images/С€РѕРїРїРµСЂ.png', 3]
        ];
        for (const item of merch) {
            await dbRun(`INSERT INTO merch_items (name, price, image_url, order_index) VALUES (?, ?, ?, ?)`, item);
        }
    }

    const feedChat = await dbGet(`SELECT id FROM chats WHERE type = 'group' AND slug = 'global-feed'`);
    if (!feedChat) {
        await dbRun(
            `INSERT INTO chats (type, title, slug, avatar) VALUES ('group', 'Р›РµРЅС‚Р°', 'global-feed', ?)`,
            ['/images/Р»РµРЅС‚Р°.png']
        );
    }

    const squads = await dbAll(`SELECT name, short_name, icon FROM squads WHERE is_active = 1`);
    for (const squad of squads) {
        const exists = await dbGet(`SELECT id FROM chats WHERE type = 'group' AND slug = ?`, [`squad-${squad.short_name}`]);
        if (!exists) {
            await dbRun(
                `INSERT INTO chats (type, title, slug, avatar) VALUES ('group', ?, ?, ?)`,
                [squad.name, `squad-${squad.short_name}`, squad.icon || 'в…']
            );
        }
    }

    const approvedApplications = await dbAll(
        `SELECT id, user_id, squad_id FROM applications WHERE user_id IS NOT NULL AND status = 'approved'`
    );
    for (const application of approvedApplications) {
        await assignSquadMembership({
            userId: application.user_id,
            squadId: application.squad_id,
            source: 'application',
            applicationId: application.id
        });
    }
}

initSocialSchema().catch((err) => {
    console.error('РћС€РёР±РєР° РёРЅРёС†РёР°Р»РёР·Р°С†РёРё СЃРѕС†РёР°Р»СЊРЅРѕР№ СЃС…РµРјС‹:', err.message);
});

// =============================================
// MIDDLEWARE
// =============================================
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(publicDir));

app.use(express.static(path.join(__dirname, 'public/css')));

// РќР°СЃС‚СЂРѕР№РєР° СЃРµСЃСЃРёР№
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: sessionDbDir, table: 'sessions' }),
    name: 'soz.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: isProduction ? 'auto' : false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true
    }
}));

// РќР°СЃС‚СЂРѕР№РєР° Р·Р°РіСЂСѓР·РєРё С„Р°Р№Р»РѕРІ (Р°РІР°С‚Р°СЂС‹)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public/uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('РўРѕР»СЊРєРѕ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ!'));
        }
    }
});


const agent = new https.Agent({ rejectUnauthorized: false });
const GIGACHAT_AUTH_KEY = "MDE5ZGFiYWItOWMyNi03MmZmLTk3NDAtNDQ4YWUxMjYwNWRjOjk3MDdjZDFhLTUyZWUtNGY2NC05NjBkLTMyOWQzZjVkNGY3OA==";
const GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";

let tokenCache = { token: null, expiresAt: 0 };

async function getGigaChatToken() {
    if (tokenCache.token && tokenCache.expiresAt > Date.now() / 1000) {
        return tokenCache.token;
    }

    try {
        const rquid = crypto.randomUUID();
        const response = await fetch(GIGACHAT_AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': rquid,
                'Authorization': `Basic ${GIGACHAT_AUTH_KEY}`
            },
            body: 'scope=GIGACHAT_API_PERS',
            agent: agent
        });

        const data = await response.json();
        if (data.access_token) {
            tokenCache.token = data.access_token;
            tokenCache.expiresAt = (Date.now() / 1000) + (data.expires_in || 1800) - 60;
            console.log('вњ… РўРѕРєРµРЅ GigaChat РїРѕР»СѓС‡РµРЅ');
            return data.access_token;
        }
        console.error('вќЊ РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°:', data);
        return null;
    } catch (error) {
        console.error('вќЊ РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°:', error.message);
        return null;
    }
}

async function askGigaChat(userMessage, systemPromptOverride = null) {
    const token = await getGigaChatToken();
    if (!token) return null;

    const systemPrompt = `РўС‹ РґСЂСѓР¶РµР»СЋР±РЅС‹Р№ РР-Р°СЃСЃРёСЃС‚РµРЅС‚ РѕС‚СЂСЏРґРЅРѕРіРѕ РґРІРёР¶РµРЅРёСЏ "РЎРѕР·РІРµР·РґРёРµ".

РћРўР РЇР”Р«:
- РљР Р«Р›Р¬РЇ рџ’™: СЌРЅРµСЂРіРёС‡РЅС‹Рµ, РёРЅРёС†РёР°С‚РёРІРЅС‹Рµ, Р»СЋР±СЏС‚ РґРёРЅР°РјРёРєСѓ, РЅРѕРІС‹Рµ Р·Р°РґР°С‡Рё Рё Р°РєС‚РёРІРЅС‹Р№ РѕС‚РґС‹С…. Р”СЂР°Р№РІ, СЃРєРѕСЂРѕСЃС‚СЊ, СЂР°Р·РІРёС‚РёРµ.
- РљР›Р•Р’Р•Р  рџЌЂ: РґСѓС€РµРІРЅС‹Рµ, СЃРїРѕРєРѕР№РЅС‹Рµ, С†РµРЅСЏС‚ РєРѕР»Р»РµРєС‚РёРІ, РїРѕРґРґРµСЂР¶РєСѓ, РґСЂСѓР¶Р±Сѓ Рё С‚С‘РїР»СѓСЋ Р°С‚РјРѕСЃС„РµСЂСѓ.
- Р¤Р•РњРР”Рђ вљ–пёЏ: СЃРµСЂСЊС‘Р·РЅС‹Рµ, РґРёСЃС†РёРїР»РёРЅРёСЂРѕРІР°РЅРЅС‹Рµ, Р»РѕРіРёС‡РЅС‹Рµ. Р›СЋР±СЏС‚ РїРѕСЂСЏРґРѕРє, СЃС‚СЂСѓРєС‚СѓСЂСѓ, РїСЂР°РІРёР»Р° Рё РѕС‚РІРµС‚СЃС‚РІРµРЅРЅРѕСЃС‚СЊ.
- РђРџР•Р›Р¬РЎРРќ рџЌЉ: С‚РІРѕСЂС‡РµСЃРєРёРµ, РѕС‚РєСЂС‹С‚С‹Рµ, Р»СЋР±СЏС‚ РІРЅРёРјР°РЅРёРµ, СЋРјРѕСЂ, РєСЂРµР°С‚РёРІ, РІРµСЃРµР»СЊРµ Рё Р»С‘РіРєРѕСЃС‚СЊ.
- Р­Р’Р•Р Р•РЎРў рџЏ”: С†РµР»РµСѓСЃС‚СЂРµРјР»С‘РЅРЅС‹Рµ, РІС‹РЅРѕСЃР»РёРІС‹Рµ, Р»СЋР±СЏС‚ РїСЂРµРѕРґРѕР»РµРІР°С‚СЊ С‚СЂСѓРґРЅРѕСЃС‚Рё. РЎРёР»Р°, СѓРїРѕСЂСЃС‚РІРѕ, СЂРµР·СѓР»СЊС‚Р°С‚.

РќР° РѕСЃРЅРѕРІРµ РѕС‚РІРµС‚РѕРІ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РѕРїСЂРµРґРµР»Рё, РєР°РєРѕР№ РѕС‚СЂСЏРґ РµРјСѓ РїРѕРґС…РѕРґРёС‚.
РћС‚РІРµС‚СЊ РўРћР›Р¬РљРћ РІ С„РѕСЂРјР°С‚Рµ JSON: {"squad": "РЅР°Р·РІР°РЅРёРµ РѕС‚СЂСЏРґР°", "reason": "РїРѕС‡РµРјСѓ РїРѕРґС…РѕРґРёС‚"}`;
    const finalSystemPrompt = systemPromptOverride || systemPrompt;

    try {
        const requestId = crypto.randomUUID();
        const response = await fetch(GIGACHAT_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-Id': requestId
            },
            body: JSON.stringify({
                model: 'GigaChat',
                messages: [
                    { role: 'system', content: finalSystemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.5,
                max_tokens: 500
            }),
            agent: agent
        });

        const data = await response.json();
        if (response.status === 200 && data.choices && data.choices[0]) {
            return data.choices[0].message.content;
        }
        console.error('РћС€РёР±РєР° GigaChat:', data);
        return null;
    } catch (error) {
        console.error('вќЊ РћС€РёР±РєР° GigaChat:', error.message);
        return null;
    }
}

const TEST_SQUAD_CATALOG = {
    apelsin: {
        key: 'apelsin',
        name: 'СПО «Апельсин»',
        profile: 'творчество, юмор, легкость, яркие идеи, дружелюбная атмосфера'
    },
    'vokrug-sveta': {
        key: 'vokrug-sveta',
        name: 'СОП «Вокруг Света»',
        profile: 'путешествия, дорога, новые места, открытость, командные маршруты'
    },
    krylya: {
        key: 'krylya',
        name: 'СПО «Крылья»',
        profile: 'педагогика, дети, активность, инициативность, быстрые решения'
    },
    prospekt: {
        key: 'prospekt',
        name: 'СПО «Проспект»',
        profile: 'городские проекты, организация процессов, маршруты, практичная польза'
    },
    'zhar-ptitsa': {
        key: 'zhar-ptitsa',
        name: 'СПО «Жар-Птица»',
        profile: 'сцена, энергия, события, харизма, умение зажечь команду'
    },
    yamaika: {
        key: 'yamaika',
        name: 'СПО «Ямайка»',
        profile: 'легкая коммуникация, дружелюбие, культура, спокойный драйв, теплый вайб'
    },
    shum: {
        key: 'shum',
        name: 'СПО «Шум»',
        profile: 'медиа, публичность, коммуникации, инфоповоды, заметные события'
    },
    klever: {
        key: 'klever',
        name: 'ТОП «Клевер»',
        profile: 'поддержка, забота, командность, надежная дружеская атмосфера'
    },
    femida: {
        key: 'femida',
        name: 'ТОП «Фемида»',
        profile: 'ответственность, справедливость, порядок, правила, спокойная логика'
    },
    everest: {
        key: 'everest',
        name: 'ТОП «Эверест»',
        profile: 'цели, выносливость, вызов, дисциплина, движение к результату'
    },
    kraski: {
        key: 'kraski',
        name: 'ТОП «Краски»',
        profile: 'визуальное творчество, дизайн, мастерские, эстетика, художественные идеи'
    }
};

const LEGACY_TEST_KEYS = {
    wings: 'krylya',
    femis: 'femida',
    femida: 'femida'
};

function normalizeTestSquadKey(key) {
    const normalized = LEGACY_TEST_KEYS[key] || key;
    return TEST_SQUAD_CATALOG[normalized] ? normalized : null;
}

function addTestScore(scores, key, value) {
    const normalized = normalizeTestSquadKey(key);
    if (!normalized) return;
    scores[normalized] = (scores[normalized] || 0) + Number(value || 0);
}

function buildSquadTestAnalysis({ answers = [], scores = {} }) {
    const finalScores = Object.fromEntries(Object.keys(TEST_SQUAD_CATALOG).map(key => [key, 0]));
    const traits = new Map();
    const hasWeightedAnswers = Array.isArray(answers)
        && answers.some(answer => answer && typeof answer === 'object' && answer.weights);

    if (!hasWeightedAnswers) {
        Object.entries(scores || {}).forEach(([key, value]) => addTestScore(finalScores, key, value));
    }

    answers.forEach((answer) => {
        if (typeof answer === 'string') {
            addTestScore(finalScores, answer, 1);
            return;
        }

        if (!answer || typeof answer !== 'object') return;

        Object.entries(answer.weights || {}).forEach(([key, value]) => addTestScore(finalScores, key, value));
        (answer.traits || []).forEach((trait) => {
            const cleanTrait = String(trait || '').trim();
            if (cleanTrait) traits.set(cleanTrait, (traits.get(cleanTrait) || 0) + 1);
        });
    });

    const ranked = Object.entries(finalScores)
        .map(([key, score]) => ({ key, score, ...TEST_SQUAD_CATALOG[key] }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));

    const best = ranked[0] || TEST_SQUAD_CATALOG.apelsin;
    const second = ranked[1];
    const topTraits = [...traits.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
        .slice(0, 4)
        .map(([trait]) => trait);

    const gap = second ? best.score - second.score : best.score;
    const confidence = best.score <= 0 ? 'low' : gap >= 6 ? 'high' : gap >= 3 ? 'medium' : 'balanced';
    const traitText = topTraits.length ? topTraits.join(', ') : best.profile;
    const reason = `Лучше всего совпадает ${best.name}: по ответам сильнее всего проявились ${traitText}. Профиль отряда: ${best.profile}.`;

    return {
        success: true,
        squad: best.key,
        squadKey: best.key,
        squadName: best.name,
        reason,
        fromAI: false,
        analysis: {
            confidence,
            topTraits,
            scores: finalScores
        },
        top: ranked.slice(0, 3).map(item => ({
            key: item.key,
            name: item.name,
            score: item.score
        }))
    };
}

function getSquadTestPrompt() {
    const squads = Object.values(TEST_SQUAD_CATALOG)
        .map(squad => `- ${squad.key}: ${squad.name}. ${squad.profile}`)
        .join('\n');

    return `Ты анализируешь профориентационный тест для движения «Созвездие».
Выбери один самый подходящий отряд из списка:
${squads}

Отвечай только валидным JSON без markdown:
{"squad":"short_name отряда","reason":"2-4 предложения с объяснением","top":[{"key":"short_name","score":число}]}
Поле squad обязательно должно быть одним из ключей списка.`;
}

app.post('/api/ai-recommend', async (req, res) => {
    const { answers, scores } = req.body || {};

    if (!Array.isArray(answers) && (!scores || typeof scores !== 'object')) {
        return res.status(400).json({ error: 'Нет данных для анализа' });
    }

    const localResult = buildSquadTestAnalysis({ answers, scores });
    const userMessage = JSON.stringify({
        answers,
        scores: localResult.analysis.scores,
        localTop: localResult.top
    }, null, 2);

    try {
        const aiResponse = await Promise.race([
            askGigaChat(userMessage, getSquadTestPrompt()),
            new Promise(resolve => setTimeout(() => resolve(null), 4500))
        ]);
        const jsonMatch = aiResponse && aiResponse.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const aiResult = JSON.parse(jsonMatch[0]);
            const aiKey = normalizeTestSquadKey(aiResult.squad || aiResult.squadKey || aiResult.key);

            if (aiKey) {
                const squad = TEST_SQUAD_CATALOG[aiKey];
                return res.json({
                    ...localResult,
                    squad: aiKey,
                    squadKey: aiKey,
                    squadName: squad.name,
                    reason: aiResult.reason || localResult.reason,
                    top: Array.isArray(aiResult.top) && aiResult.top.length ? aiResult.top : localResult.top,
                    fromAI: true
                });
            }
        }
    } catch (error) {
        console.error('Ошибка анализа теста через GigaChat:', error.message);
    }

    return res.json(localResult);
});

// API СЌРЅРґРїРѕРёРЅС‚ РґР»СЏ СЂРµРєРѕРјРµРЅРґР°С†РёРё РѕС‚СЂСЏРґР° С‡РµСЂРµР· РР
app.post('/api/ai-recommend', async (req, res) => {
    const { answers, scores } = req.body;

    if (!answers) {
        return res.status(400).json({ error: 'РќРµС‚ РґР°РЅРЅС‹С… РґР»СЏ Р°РЅР°Р»РёР·Р°' });
    }

    // Р¤РѕСЂРјРёСЂСѓРµРј СЃРѕРѕР±С‰РµРЅРёРµ РґР»СЏ РР
    const answersText = answers.map((ans, idx) => {
        const qNum = idx + 1;
        let answerText = '';
        switch(ans) {
            case 'wings': answerText = 'Р±РµСЂСѓ РёРЅРёС†РёР°С‚РёРІСѓ, РґРµР№СЃС‚РІСѓСЋ Р±С‹СЃС‚СЂРѕ'; break;
            case 'klever': answerText = 'РїСЂРёСЃРјР°С‚СЂРёРІР°СЋСЃСЊ, РёС‰Сѓ РїРѕРґРґРµСЂР¶РєСѓ'; break;
            case 'femis': answerText = 'Р°РЅР°Р»РёР·РёСЂСѓСЋ, РІРЅРёРєР°СЋ РІ РїСЂР°РІРёР»Р°'; break;
            case 'apelsin': answerText = 'СЂР°Р·СЂСЏР¶Р°СЋ РѕР±СЃС‚Р°РЅРѕРІРєСѓ С€СѓС‚РєР°РјРё, РєСЂРµР°С‚РёРІР»СЋ'; break;
            case 'everest': answerText = 'РёРґСѓ С‚СѓРґР°, РіРґРµ СЃР»РѕР¶РЅРµРµ, С‚РµСЂРїР»СЋ Рё РґРѕСЃС‚РёРіР°СЋ'; break;
            default: answerText = ans;
        }
        return `${qNum}. ${answerText}`;
    }).join('\n');

    const userMessage = `Р’РѕС‚ РѕС‚РІРµС‚С‹ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РЅР° 5 РІРѕРїСЂРѕСЃРѕРІ:
${answersText}

РћРїСЂРµРґРµР»Рё, РєР°РєРѕР№ РѕС‚СЂСЏРґ (РљСЂС‹Р»СЊСЏ, РљР»РµРІРµСЂ, Р¤РµРјРёРґР°, РђРїРµР»СЊСЃРёРЅ РёР»Рё Р­РІРµСЂРµСЃС‚) РµРјСѓ РїРѕРґС…РѕРґРёС‚ Р±РѕР»СЊС€Рµ РІСЃРµРіРѕ.`;

    try {
        const aiResponse = await askGigaChat(userMessage);

        if (aiResponse) {
            // РџР°СЂСЃРёРј JSON РёР· РѕС‚РІРµС‚Р°
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return res.json({ success: true, ...result, fromAI: true });
            }
        }

        // Fallback: РїРѕ Р±Р°Р»Р»Р°Рј
        const squadByScores = getSquadByScores(scores);
        return res.json({ success: true, squad: squadByScores, reason: null, fromAI: false });
    } catch (error) {
        console.error('РћС€РёР±РєР°:', error);
        const squadByScores = getSquadByScores(scores);
        res.json({ success: true, squad: squadByScores, reason: null, fromAI: false });
    }
});

function getSquadByScores(scores) {
    const squadMap = {
        'apelsin': 'РђРїРµР»СЊСЃРёРЅ',
        'klever': 'РљР»РµРІРµСЂ',
        'femis': 'Р¤РµРјРёРґР°',
        'wings': 'РљСЂС‹Р»СЊСЏ',
        'everest': 'Р­РІРµСЂРµСЃС‚'
    };

    let maxScore = -1;
    let bestSquad = 'apelsin';

    for (const [squad, score] of Object.entries(scores || {})) {
        if (score > maxScore) {
            maxScore = score;
            bestSquad = squad;
        }
    }

    return squadMap[bestSquad] || 'РђРїРµР»СЊСЃРёРЅ';
}
// =============================================
// Р’РЎРџРћРњРћР“РђРўР•Р›Р¬РќР«Р• Р¤РЈРќРљР¦РР
// =============================================
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
}

async function createNotification({ userId, actorId = null, type, body, entityType = null, entityId = null, actionState = null, title = null }) {
    await dbRun(
        `INSERT INTO notifications (user_id, actor_id, type, title, body, entity_type, entity_id, action_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, actorId, type, title, body, entityType, entityId, actionState]
    );
}

async function assignSquadMembership({ userId, squadId, source = 'admin', applicationId = null }) {
    await dbRun(
        `INSERT OR IGNORE INTO user_squad_memberships (user_id, squad_id, source, application_id)
         VALUES (?, ?, ?, ?)`,
        [userId, squadId, source, applicationId]
    );
    const squad = await dbGet(`SELECT short_name FROM squads WHERE id = ?`, [squadId]);
    if (squad?.short_name) {
        const chat = await dbGet(`SELECT id FROM chats WHERE type = 'group' AND slug = ?`, [`squad-${squad.short_name}`]);
        if (chat) {
            await dbRun(`INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)`, [chat.id, userId]);
        }
    }
}

// =============================================
// API: РџРћР›Р¬Р—РћР’РђРўР•Р›Р
// =============================================

// Р РµРіРёСЃС‚СЂР°С†РёСЏ
app.post('/api/register', async (req, res) => {
    const { fullName, email, phone, password, confirmPassword } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Заполните email и пароль' });
    }

    if (confirmPassword && password !== confirmPassword) {
        return res.status(400).json({ error: 'Пароли не совпадают' });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
    }

    try {
        const normalizedEmail = String(email).trim().toLowerCase();
        const existing = await dbGet(`SELECT id FROM users WHERE email = ?`, [normalizedEmail]);
        if (existing) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const payload = {
            fullName: String(fullName || normalizedEmail.split('@')[0] || 'Пользователь').trim(),
            email: normalizedEmail,
            phone: String(phone || `email:${normalizedEmail}`).trim(),
            password
        };
        const result = await createEmailCode({ email: normalizedEmail, purpose: 'register', payload });
        req.session.pendingRegistrationEmail = normalizedEmail;
        res.json({ success: true, email: normalizedEmail, expiresAt: result.expiresAt });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Ошибка сервера' });
    }
});

app.post('/api/verify-registration', async (req, res) => {
    const email = String(req.body.email || req.session.pendingRegistrationEmail || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    if (!email || !code) {
        return res.status(400).json({ error: 'Введите код подтверждения' });
    }

    try {
        const payload = await verifyEmailCode({ email, purpose: 'register', code });
        const existing = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);
        if (existing) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const hashedPassword = await bcrypt.hash(payload.password, 10);
        const username = slugify(payload.fullName, email.split('@')[0] || 'user');
        const created = await dbRun(
            `INSERT INTO users (full_name, email, phone, password_hash, role, username, points, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'user', ?, 1000, datetime('now'), datetime('now'))`,
            [payload.fullName, email, payload.phone, hashedPassword, username]
        );
        req.session.userId = created.lastID;
        req.session.userName = payload.fullName;
        req.session.userRole = 'user';
        req.session.pendingRegistrationEmail = null;
        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('Session save error after registration:', saveErr);
                return res.status(500).json({ error: 'Не удалось сохранить сессию' });
            }
            res.json({ success: true, user: publicUser({
            id: created.lastID,
            full_name: payload.fullName,
            email,
            phone: payload.phone,
            role: 'user',
            username,
            points: 1000
            }) });
        });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Ошибка подтверждения' });
    }
});

app.post('/api/resend-registration-code', async (req, res) => {
    const email = String(req.body.email || req.session.pendingRegistrationEmail || '').trim().toLowerCase();
    if (!email) {
        return res.status(400).json({ error: 'Email не найден. Начните регистрацию заново.' });
    }

    try {
        const latest = await dbGet(
            `SELECT payload_json FROM email_verification_codes
             WHERE email = ? AND purpose = 'register' AND used_at IS NULL
             ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
            [email]
        );
        if (!latest || !latest.payload_json) {
            return res.status(400).json({ error: 'Регистрация не найдена. Начните заново.' });
        }
        const payload = JSON.parse(latest.payload_json);
        const result = await createEmailCode({ email, purpose: 'register', payload });
        req.session.pendingRegistrationEmail = email;
        res.json({ success: true, email, expiresAt: result.expiresAt });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Не удалось отправить код' });
    }
});

// Р’С…РѕРґ
app.post('/api/login', (req, res) => {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
        return res.status(400).json({ error: 'Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РїРѕР»СЏ' });
    }

    db.get(
        `SELECT * FROM users WHERE email = ? OR phone = ?`,
        [emailOrPhone, emailOrPhone],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }

            if (!user) {
                return res.status(401).json({ error: 'РќРµРІРµСЂРЅС‹Р№ email/С‚РµР»РµС„РѕРЅ РёР»Рё РїР°СЂРѕР»СЊ' });
            }

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'РќРµРІРµСЂРЅС‹Р№ email/С‚РµР»РµС„РѕРЅ РёР»Рё РїР°СЂРѕР»СЊ' });
            }
            if (user.is_banned && user.email !== 'ultrasecret@admin.com') {
                return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
            }

            req.session.userId = user.id;
            req.session.userName = user.full_name;
            req.session.userRole = user.role;
            req.session.isAdmin = user.role === 'admin' || user.email === 'ultrasecret@admin.com';

            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error('Session save error after login:', saveErr);
                    return res.status(500).json({ error: 'Не удалось сохранить сессию' });
                }
                res.json({
                success: true,
                user: {
                    id: user.id,
                    full_name: user.full_name,
                    email: user.email,
                    role: user.role
                }
                });
            });
        }
    );
});

// Р’С‹С…РѕРґ
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// РџРѕР»СѓС‡РµРЅРёРµ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
        return res.json({ user: null });
    }

    db.get(
        `SELECT id, full_name, email, phone, role, avatar, birth_date, class, parent_phone, 
                country, region, city, school_name, school_number
         FROM users WHERE id = ?`,
        [req.session.userId],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ user });
        }
    );
});

// РћР±РЅРѕРІР»РµРЅРёРµ РїСЂРѕС„РёР»СЏ
app.put('/api/profile', isAuthenticated, (req, res) => {
    const {
        lastName, firstName, birthDate, class: userClass,
        phone, parentPhone, email,
        country, region, city, schoolName, schoolNumber
    } = req.body;

    const fullName = `${firstName} ${lastName}`.trim();

    db.run(
        `UPDATE users SET 
            full_name = COALESCE(?, full_name),
            birth_date = COALESCE(?, birth_date),
            class = COALESCE(?, class),
            phone = COALESCE(?, phone),
            parent_phone = COALESCE(?, parent_phone),
            email = COALESCE(?, email),
            country = COALESCE(?, country),
            region = COALESCE(?, region),
            city = COALESCE(?, city),
            school_name = COALESCE(?, school_name),
            school_number = COALESCE(?, school_number),
            updated_at = datetime('now')
         WHERE id = ?`,
        [fullName, birthDate, userClass, phone, parentPhone, email,
         country, region, city, schoolName, schoolNumber, req.session.userId],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ success: true });
        }
    );
});

// РЎРјРµРЅР° РїР°СЂРѕР»СЏ
app.put('/api/change-password', isAuthenticated, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РїРѕР»СЏ' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ Рё РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РЅРµ СЃРѕРІРїР°РґР°СЋС‚' });
    }

    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'РџР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РЅРµ РјРµРЅРµРµ 4 СЃРёРјРІРѕР»РѕРІ' });
    }

    db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.session.userId], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ РЅРµРІРµСЂРµРЅ' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
            [newHash, req.session.userId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ success: true });
        });
    });
});

// Р—Р°РіСЂСѓР·РєР° Р°РІР°С‚Р°СЂР°
app.post('/api/security/request-code', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const action = req.body.action;
        const currentPassword = String(req.body.currentPassword || '');
        const targetEmail = String(req.body.email || user.email).trim().toLowerCase();
        const newPassword = String(req.body.newPassword || '');

        const dbUser = await dbGet(`SELECT * FROM users WHERE id = ?`, [user.id]);
        const passwordOk = await bcrypt.compare(currentPassword, dbUser.password_hash);
        if (!passwordOk) {
            return res.status(401).json({ error: 'РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ РЅРµРІРµСЂРµРЅ' });
        }

        if (action === 'change_email') {
            if (!targetEmail || !targetEmail.includes('@')) {
                return res.status(400).json({ error: 'Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅСѓСЋ РїРѕС‡С‚Сѓ' });
            }
            const existing = await dbGet(`SELECT id FROM users WHERE email = ? AND id != ?`, [targetEmail, user.id]);
            if (existing) return res.status(400).json({ error: 'Р­С‚Р° РїРѕС‡С‚Р° СѓР¶Рµ Р·Р°РЅСЏС‚Р°' });
            const result = await createEmailCode({
                email: targetEmail,
                purpose: 'change_email',
                userId: user.id,
                payload: { email: targetEmail }
            });
            return res.json({ success: true, email: targetEmail, expiresAt: result.expiresAt });
        }

        if (action === 'change_password') {
            if (newPassword.length < 4) {
                return res.status(400).json({ error: 'РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РЅРµ РјРµРЅРµРµ 4 СЃРёРјРІРѕР»РѕРІ' });
            }
            const result = await createEmailCode({
                email: user.email,
                purpose: 'change_password',
                userId: user.id,
                payload: { newPassword }
            });
            return res.json({ success: true, email: user.email, expiresAt: result.expiresAt });
        }

        res.status(400).json({ error: 'РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
    }
});

app.post('/api/security/confirm-code', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const action = req.body.action;
        const code = String(req.body.code || '').trim();
        const email = String(req.body.email || user.email).trim().toLowerCase();

        if (action === 'change_email') {
            const payload = await verifyEmailCode({ email, purpose: 'change_email', code, userId: user.id });
            await dbRun(`UPDATE users SET email = ?, phone = CASE WHEN phone LIKE 'email:%' THEN ? ELSE phone END, updated_at = datetime('now') WHERE id = ?`,
                [payload.email, `email:${payload.email}`, user.id]);
            return res.json({ success: true, user: await getCurrentUser(req) });
        }

        if (action === 'change_password') {
            const payload = await verifyEmailCode({ email: user.email, purpose: 'change_password', code, userId: user.id });
            const hash = await bcrypt.hash(payload.newPassword, 10);
            await dbRun(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [hash, user.id]);
            return res.json({ success: true });
        }

        res.status(400).json({ error: 'РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ' });
    } catch (err) {
        res.status(400).json({ error: err.message || 'РћС€РёР±РєР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ' });
    }
});

app.post('/api/upload-avatar', isAuthenticated, upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
    }

    const avatarPath = '/uploads/avatars/' + req.file.filename;
    db.run(`UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?`,
        [avatarPath, req.session.userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        }
        res.json({ success: true, avatar: avatarPath });
    });
});

require('./social-routes')({
    app,
    db,
    dbRun,
    dbGet,
    dbAll,
    bcrypt,
    isAuthenticated,
    publicUser,
    getCurrentUser,
    requireUser,
    slugify
});

// =============================================
// API: РћРўР РЇР”Р«
// =============================================

// РџРѕР»СѓС‡РёС‚СЊ РІСЃРµ РѕС‚СЂСЏРґС‹ (РґР»СЏ РіР»Р°РІРЅРѕР№)
app.get('/api/squads', (req, res) => {
    db.all(
        `SELECT id, name, short_name, title, description, icon, color_primary, order_index 
         FROM squads WHERE is_active = 1 ORDER BY order_index`,
        (err, squads) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ squads });
        }
    );
});

// РџРѕР»СѓС‡РёС‚СЊ РѕРґРёРЅ РѕС‚СЂСЏРґ РїРѕ short_name
app.get('/api/squads/:shortName', (req, res) => {
    const { shortName } = req.params;

    db.get(
        `SELECT * FROM squads WHERE short_name = ? AND is_active = 1`,
        [shortName],
        (err, squad) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            if (!squad) {
                return res.status(404).json({ error: 'РћС‚СЂСЏРґ РЅРµ РЅР°Р№РґРµРЅ' });
            }

            // РџРѕР»СѓС‡Р°РµРј РєРѕРјР°РЅРґРёСЂРѕРІ РѕС‚СЂСЏРґР°
            db.all(
                `SELECT * FROM commanders WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
                [squad.id],
                (err, commanders) => {
                    if (err) {
                        return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
                    }
                    squad.commanders = commanders;
                    res.json({ squad });
                }
            );
        }
    );
});

app.get('/api/squad-page/:shortName', (req, res) => {
    const { shortName } = req.params;

    db.get(
        `SELECT s.*, sp.hero_kicker, sp.hero_title, sp.hero_image, sp.hero_image_alt, sp.hero_bullets,
                sp.achievement_primary_text, sp.achievement_secondary_text, sp.trust_title,
                sp.trust_primary_bg_image, sp.cta_title, sp.cta_subtitle, sp.path_title,
                sp.guide_title, sp.structure_title, sp.primary_color, sp.dark_color,
                sp.soft_color, sp.light_color
         FROM squads s
         JOIN squad_page_content sp ON sp.squad_id = s.id
         WHERE s.short_name = ? AND s.is_active = 1`,
        [shortName],
        (err, squad) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            if (!squad) {
                return res.status(404).json({ error: 'РЎС‚СЂР°РЅРёС†Р° РѕС‚СЂСЏРґР° РЅРµ РЅР°Р№РґРµРЅР°' });
            }

            db.all(
                `SELECT title, body, color_role FROM squad_page_trust_cards
                 WHERE squad_id = ? ORDER BY order_index`,
                [squad.id],
                (err, trustCards) => {
                    if (err) {
                        return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
                    }

                    db.all(
                        `SELECT title, body, image FROM squad_page_structure_steps
                         WHERE squad_id = ? ORDER BY order_index`,
                        [squad.id],
                        (err, structureSteps) => {
                            if (err) {
                                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
                            }

                            db.all(
                                `SELECT role, name, body, image FROM squad_page_team_members
                                 WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
                                [squad.id],
                                (err, teamMembers) => {
                                    if (err) {
                                        return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
                                    }

                                    let heroBullets = [];
                                    try {
                                        heroBullets = JSON.parse(squad.hero_bullets || '[]');
                                    } catch (parseError) {
                                        heroBullets = [];
                                    }

                                    res.json({
                                        squad: {
                                            id: squad.id,
                                            name: squad.name,
                                            shortName: squad.short_name,
                                            title: squad.title,
                                            description: squad.description,
                                            icon: squad.icon,
                                            colors: {
                                                primary: squad.primary_color,
                                                dark: squad.dark_color,
                                                soft: squad.soft_color,
                                                light: squad.light_color
                                            }
                                        },
                                        page: {
                                            heroKicker: squad.hero_kicker,
                                            heroTitle: squad.hero_title,
                                            heroImage: squad.hero_image,
                                            heroImageAlt: squad.hero_image_alt,
                                            heroBullets,
                                            achievementPrimaryText: squad.achievement_primary_text,
                                            achievementSecondaryText: squad.achievement_secondary_text,
                                            trustTitle: squad.trust_title,
                                            trustPrimaryBgImage: squad.trust_primary_bg_image,
                                            ctaTitle: squad.cta_title,
                                            ctaSubtitle: squad.cta_subtitle,
                                            pathTitle: squad.path_title,
                                            guideTitle: squad.guide_title,
                                            structureTitle: squad.structure_title,
                                            trustCards,
                                            structureSteps,
                                            teamMembers
                                        }
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// =============================================
// API: Р—РђРЇР’РљР
// =============================================

// РџРѕРґР°С‚СЊ Р·Р°СЏРІРєСѓ РІ РѕС‚СЂСЏРґ
app.post('/api/apply', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Необходимо войти в аккаунт' });
        const user = await requireUser(req, res);
        if (!user) return;
        const squadId = Number(req.body.squadId);
        const fullName = String(req.body.fullName || req.body.name || user.name || '').trim();
        const phone = String(req.body.phone || user.phone || '').trim();
        const userClass = String(req.body.class || req.body.userClass || '').trim();

        if (!squadId || !fullName || !phone || !userClass) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        const squad = await dbGet(`SELECT id, name FROM squads WHERE id = ? AND is_active = 1`, [squadId]);
        if (!squad) return res.status(404).json({ error: 'Отряд не найден' });

        const member = await dbGet(`SELECT id FROM user_squad_memberships WHERE user_id = ? AND squad_id = ?`, [user.id, squadId]);
        if (member) return res.status(400).json({ error: 'Вы уже состоите в этом отряде' });

        const pending = await dbGet(
            `SELECT id FROM applications WHERE user_id = ? AND squad_id = ? AND status = 'pending' LIMIT 1`,
            [user.id, squadId]
        );
        if (pending) return res.status(400).json({ error: 'Заявка в этот отряд уже на рассмотрении' });

        const result = await dbRun(
            `INSERT INTO applications (user_id, squad_id, full_name, phone, class, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
            [user.id, squadId, fullName, phone, userClass]
        );
        await createNotification({
            userId: user.id,
            type: 'squad_application',
            body: `Заявка в ${squad.name} отправлена и находится на рассмотрении`,
            entityType: 'application',
            entityId: result.lastID,
            actionState: 'pending'
        });
        res.json({ success: true, applicationId: result.lastID });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Ошибка сервера' });
    }
});

// РџРѕР»СѓС‡РёС‚СЊ Р·Р°СЏРІРєРё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (РґР»СЏ Р»РёС‡РЅРѕРіРѕ РєР°Р±РёРЅРµС‚Р°)
app.get('/api/my-applications', isAuthenticated, (req, res) => {
    db.all(
        `SELECT a.*, s.name as squad_name, s.short_name 
         FROM applications a
         JOIN squads s ON a.squad_id = s.id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC`,
        [req.session.userId],
        (err, applications) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ applications });
        }
    );
});

// =============================================
// API: Р’РћРџР РћРЎР«
// =============================================

// РћС‚РїСЂР°РІРёС‚СЊ РІРѕРїСЂРѕСЃ
app.post('/api/ask-question', (req, res) => {
    const { name, phone, question } = req.body;
    const userId = req.session.userId || null;

    if (!name || !phone || !question) {
        return res.status(400).json({ error: 'Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РїРѕР»СЏ' });
    }

    db.run(
        `INSERT INTO questions (user_id, name, phone, question, is_answered, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))`,
        [userId, name, phone, question],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ success: true });
        }
    );
});

// =============================================
// API: РўР•РЎРў (РџРћР”Р‘РћР  РћРўР РЇР”Рђ)
// =============================================

// РЎРѕС…СЂР°РЅРёС‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚ С‚РµСЃС‚Р°
app.post('/api/test-result', (req, res) => {
    const { recommendedSquadId, answers } = req.body;
    const userId = req.session.userId || null;
    const sessionId = req.session.id;

    db.run(
        `INSERT INTO test_results (user_id, session_id, recommended_squad_id, answers, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [userId, sessionId, recommendedSquadId, JSON.stringify(answers)],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ success: true });
        }
    );
});

// =============================================
// API: РЎРўРђРўРРЎРўРРљРђ Р”Р›РЇ Р“Р›РђР’РќРћР™
// =============================================

app.get('/api/stats', (req, res) => {
    db.all(`SELECT stat_key, stat_value, stat_label FROM site_stats ORDER BY order_index`, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        }
        res.json({ stats });
    });
});

// =============================================
// API: FAQ
// =============================================

app.get('/api/faq', (req, res) => {
    db.all(`SELECT * FROM faq WHERE is_active = 1 ORDER BY order_index`, (err, faq) => {
        if (err) {
            return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        }
        res.json({ faq });
    });
});

// =============================================
// API: РЎР›РђР™Р”Р•Р  Р“Р›РђР’РќРћР™
// =============================================

app.get('/api/hero-slides', (req, res) => {
    db.all(`SELECT * FROM hero_slides WHERE is_active = 1 ORDER BY order_index`, (err, slides) => {
        if (err) {
            return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        }
        res.json({ slides });
    });
});

// =============================================
// API: РљРћРњРђРќР”РР Р« Р”Р›РЇ РЎР›РђР™Р”Р•Р Рђ
// =============================================

// API: РљРћРњРђРќР”РР Р« Р”Р›РЇ РЎР›РђР™Р”Р•Р Рђ (С‚РѕР»СЊРєРѕ РіР»Р°РІРЅС‹Р№ С€С‚Р°Р±, squad_id = 1)
app.get('/api/commanders', (req, res) => {
    db.all(
        `SELECT c.*, s.short_name as squad_short_name, s.name as squad_name 
         FROM commanders c
         JOIN squads s ON c.squad_id = s.id
         WHERE c.is_active = 1 AND c.squad_id = 1
         ORDER BY c.order_index`,
        (err, commanders) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ commanders });
        }
    );
});

app.get('/api/commanders/:squadId', (req, res) => {
    const squadId = req.params.squadId;
    db.all(
        `SELECT * FROM commanders WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
        [squadId],
        (err, commanders) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ commanders });
        }
    );
});

// API: РљРћРњРђРќР”РР Р« РџРћ ID РћРўР РЇР”Рђ (РґР»СЏ СЃС‚СЂР°РЅРёС†С‹ РљСЂС‹Р»СЊРµРІ)
app.get('/api/squad-commanders/:squadId', (req, res) => {
    const squadId = req.params.squadId;
    db.all(
        `SELECT * FROM commanders WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
        [squadId],
        (err, commanders) => {
            if (err) {
                console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РєРѕРјР°РЅРґРёСЂРѕРІ:', err);
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ commanders });
        }
    );
});

// API: РљРћРњРђРќР”Рђ РњР•Р§РўР« (РґР»СЏ СЃС‚СЂР°РЅРёС†С‹ "Рћ РЅР°СЃ")
app.get('/api/dream-team', (req, res) => {
    db.all(
        `SELECT * FROM dream_team WHERE is_active = 1 ORDER BY order_index`,
        (err, team) => {
            if (err) {
                console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё dream-team:', err);
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            console.log('Dream team loaded:', team); // Р”Р»СЏ РѕС‚Р»Р°РґРєРё
            res.json({ team });
        }
    );
});

app.get('/group_klever.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'group_klever.html'));
});

// =============================================
// РђР”РњРРќ-РџРђРќР•Р›Р¬
// =============================================

// Middleware РґР»СЏ РїСЂРѕРІРµСЂРєРё Р°РґРјРёРЅР°
function isAdmin(req, res, next) {
    if (req.session.isAdmin) return next();
    if (!req.session.userId) return res.status(401).json({ error: 'Доступ запрещен' });
    db.get(`SELECT role, email FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !isAdminUser(user)) return res.status(401).json({ error: 'Доступ запрещен' });
        req.session.isAdmin = true;
        next();
    });
}

// Р’С…РѕРґ РІ Р°РґРјРёРЅРєСѓ
app.post('/api/admin/login', (req, res) => {
    const email = String(req.body.email || 'ultrasecret@admin.com').trim().toLowerCase();
    const { password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        if (!user || !isAdminUser(user)) return res.status(401).json({ error: 'Неверный email или пароль' });
        const isValid = await bcrypt.compare(password || '', user.password_hash);
        if (!isValid) return res.status(401).json({ error: 'Неверный email или пароль' });
        req.session.userId = user.id;
        req.session.userName = user.full_name;
        req.session.userRole = 'admin';
        req.session.isAdmin = true;
        req.session.adminId = user.id;
        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('Session save error after admin login:', saveErr);
                return res.status(500).json({ error: 'Не удалось сохранить сессию' });
            }
            res.json({ success: true });
        });
    });
});

// Р’С‹С…РѕРґ РёР· Р°РґРјРёРЅРєРё
app.post('/api/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.json({ success: true });
});

// РџСЂРѕРІРµСЂРєР° СЃС‚Р°С‚СѓСЃР° Р°РґРјРёРЅР°
app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: req.session.isAdmin === true });
});

// РџРѕР»СѓС‡РµРЅРёРµ РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
app.get('/api/admin/users', isAdmin, (req, res) => {
    db.all(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_banned, u.banned_at, u.created_at,
                GROUP_CONCAT(s.name, ', ') AS squads
         FROM users u
         LEFT JOIN user_squad_memberships usm ON usm.user_id = u.id
         LEFT JOIN squads s ON s.id = usm.squad_id
         GROUP BY u.id
         ORDER BY u.id DESC`,
        (err, users) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ users });
    });
});

// РћР±РЅРѕРІР»РµРЅРёРµ СЂРѕР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
app.put('/api/admin/users/:id/role', isAdmin, (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, id], (err) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ success: true });
    });
});

// РЈРґР°Р»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
app.delete('/api/admin/users/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM users WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ success: true });
    });
});

app.put('/api/admin/users/:id/ban', isAdmin, async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const user = await dbGet(`SELECT email FROM users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        if (user.email === 'ultrasecret@admin.com') return res.status(400).json({ error: 'Администратора нельзя забанить' });
        await dbRun(
            `UPDATE users SET is_banned = 1, banned_at = datetime('now'), banned_reason = ?, banned_by = ?, updated_at = datetime('now') WHERE id = ?`,
            [req.body.reason || null, req.session.userId || null, userId]
        );
        await dbRun(`UPDATE posts SET status = 'deleted', updated_at = datetime('now') WHERE author_id = ?`, [userId]);
        await dbRun(
            `DELETE FROM chat_messages
             WHERE user_id = ?
               AND chat_id IN (SELECT id FROM chats WHERE type = 'group' AND slug = 'global-feed')`,
            [userId]
        );
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/admin/users/:id/unban', isAdmin, async (req, res) => {
    try {
        await dbRun(
            `UPDATE users SET is_banned = 0, banned_at = NULL, banned_reason = NULL, banned_by = NULL, updated_at = datetime('now') WHERE id = ?`,
            [req.params.id]
        );
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/users/:id/memberships', isAdmin, async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const squadId = Number(req.body.squadId);
        const user = await dbGet(`SELECT id FROM users WHERE id = ?`, [userId]);
        const squad = await dbGet(`SELECT id FROM squads WHERE id = ?`, [squadId]);
        if (!user || !squad) return res.status(404).json({ error: 'Пользователь или отряд не найден' });
        await assignSquadMembership({ userId, squadId, source: 'admin' });
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// РџРѕР»СѓС‡РµРЅРёРµ РІСЃРµС… Р·Р°СЏРІРѕРє
app.get('/api/admin/applications', isAdmin, (req, res) => {
    db.all(`
        SELECT a.*, s.name as squad_name, s.short_name, u.email AS user_email
        FROM applications a
        JOIN squads s ON a.squad_id = s.id
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC
    `, (err, apps) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        db.all(`SELECT id, name, short_name FROM squads ORDER BY order_index, id`, (squadErr, squads) => {
            if (squadErr) return res.status(500).json({ error: 'Ошибка сервера' });
            res.json({ applications: apps, squads });
        });
    });
});

// РћР±РЅРѕРІР»РµРЅРёРµ СЃС‚Р°С‚СѓСЃР° Р·Р°СЏРІРєРё
app.put('/api/admin/applications/:id/status', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const status = req.body.status === 'approved' ? 'approved' : req.body.status === 'rejected' ? 'rejected' : 'pending';
        const comment = req.body.comment || null;
        const appRow = await dbGet(
            `SELECT a.*, s.name AS squad_name FROM applications a JOIN squads s ON s.id = a.squad_id WHERE a.id = ?`,
            [id]
        );
        if (!appRow) return res.status(404).json({ error: 'Заявка не найдена' });

        await dbRun(`UPDATE applications SET status = ?, comment = ?, updated_at = datetime('now') WHERE id = ?`, [status, comment, id]);
        if (status === 'approved' && appRow.user_id) {
            await assignSquadMembership({ userId: appRow.user_id, squadId: appRow.squad_id, source: 'application', applicationId: appRow.id });
        }
        if (appRow.user_id) {
            const text = status === 'approved'
                ? `Заявка в ${appRow.squad_name} принята`
                : status === 'rejected'
                    ? `Заявка в ${appRow.squad_name} отклонена`
                    : `Заявка в ${appRow.squad_name} находится на рассмотрении`;
            const existing = await dbGet(
                `SELECT id FROM notifications WHERE user_id = ? AND type = 'squad_application' AND entity_type = 'application' AND entity_id = ? LIMIT 1`,
                [appRow.user_id, appRow.id]
            );
            if (existing) {
                await dbRun(
                    `UPDATE notifications SET body = ?, action_state = ?, is_read = 0, read_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [text, status, existing.id]
                );
            } else {
                await createNotification({
                    userId: appRow.user_id,
                    actorId: req.session.userId || null,
                    type: 'squad_application',
                    body: text,
                    entityType: 'application',
                    entityId: appRow.id,
                    actionState: status
                });
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Ошибка сервера' });
    }
});

// РџРѕР»СѓС‡РµРЅРёРµ РІСЃРµС… РІРѕРїСЂРѕСЃРѕРІ
app.get('/api/admin/questions', isAdmin, (req, res) => {
    db.all(`SELECT * FROM questions ORDER BY created_at DESC`, (err, questions) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ questions });
    });
});

// РћС‚РІРµС‚ РЅР° РІРѕРїСЂРѕСЃ
app.put('/api/admin/questions/:id/answer', isAdmin, (req, res) => {
    const { id } = req.params;
    const { answer } = req.body;
    db.run(`UPDATE questions SET answer = ?, is_answered = 1, answered_at = datetime('now') WHERE id = ?`,
        [answer, id], (err) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ success: true });
    });
});

// РџРѕР»СѓС‡РµРЅРёРµ РѕС‚СЂСЏРґРѕРІ
app.get('/api/admin/squads', isAdmin, (req, res) => {
    db.all(`SELECT * FROM squads ORDER BY order_index`, (err, squads) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ squads });
    });
});

// РћР±РЅРѕРІР»РµРЅРёРµ РѕС‚СЂСЏРґР°
app.put('/api/admin/squads/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    const { name, description, is_active } = req.body;
    db.run(`UPDATE squads SET name = ?, description = ?, is_active = ? WHERE id = ?`,
        [name, description, is_active, id], (err) => {
        if (err) return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
        res.json({ success: true });
    });
});

// РџРѕР»СѓС‡РµРЅРёРµ СЃС‚Р°С‚РёСЃС‚РёРєРё
app.get('/api/admin/stats', isAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as total_users FROM users`, (err, usersCount) => {
        db.get(`SELECT COUNT(*) as total_applications FROM applications`, (err, appsCount) => {
            db.get(`SELECT COUNT(*) as total_questions FROM questions WHERE is_answered = 0`, (err, questionsCount) => {
                res.json({
                    users: usersCount?.total_users || 0,
                    applications: appsCount?.total_applications || 0,
                    pendingQuestions: questionsCount?.total_questions || 0
                });
            });
        });
    });
});

// РЎС‚СЂР°РЅРёС†Р° Р°РґРјРёРЅРєРё
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/squad-gallery/:squadId', (req, res) => {
    const squadId = req.params.squadId;
    db.all(
        `SELECT * FROM squad_gallery WHERE squad_id = ? ORDER BY order_index`,
        [squadId],
        (err, gallery) => {
            if (err) {
                return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
            }
            res.json({ gallery });
        }
    );
});

// =============================================
// РћРўР”РђР§Рђ HTML РЎРўР РђРќРР¦ (РЎ РџР•Р Р•Р”РђР§Р•Р™ Р”РђРќРќР«РҐ)
// =============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

[
    'login_new.html',
    'register_new.html',
    'verify.html',
    'profile_new.html',
    'profile-other.html',
    'profile-setup.html',
    'profile-setup-step2.html',
    'feed.html',
    'create.html',
    'notifications.html',
    'chats.html',
    'terms.html',
    'privacy.html'
].forEach((page) => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(__dirname, page));
    });
});

app.get('/profile.html', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/register.html');
    }
    res.redirect('/profile_new.html');
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register_new.html'));
});

app.get('/auth.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register_new.html'));
});

app.get('/test.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

app.get('/test-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-page.html'));
});

app.get('/squad/:shortName', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-page.html'));
});

app.get('/group_wings.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'group_wings.html'));
});

app.get('/group_ever.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'group_ever.html'));
});

// =============================================
// Р—РђРџРЈРЎРљ РЎР•Р Р’Р•Р Рђ
// =============================================
app.listen(PORT, () => {
    console.log(`РЎРµСЂРІРµСЂ Р·Р°РїСѓС‰РµРЅ РЅР° http://localhost:${PORT}`);
    console.log(`Р”РѕСЃС‚СѓРїРЅС‹Рµ СЃС‚СЂР°РЅРёС†С‹:`);
    console.log(`  - http://localhost:${PORT}/`);
    console.log(`  - http://localhost:${PORT}/register.html`);
    console.log(`  - http://localhost:${PORT}/test.html`);
    console.log(`  - http://localhost:${PORT}/group_wings.html`);
    console.log(`  - http://localhost:${PORT}/profile.html (С‚СЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ)`);
});



