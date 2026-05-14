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
require('dotenv').config({ path: path.join(__dirname, '.env') });

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (err) {
    console.warn('nodemailer не установлен, email-коды будут выводиться в консоль');
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'sozvezdie_secret_key_2026';
const sessionStoreType = String(process.env.SESSION_STORE || 'memory').toLowerCase();
const configuredSessionDbDir = process.env.SESSION_DB_DIR || '';
const sessionDbDir = configuredSessionDbDir
    ? (path.isAbsolute(configuredSessionDbDir) ? configuredSessionDbDir : path.join(__dirname, configuredSessionDbDir))
    : __dirname;
const sessionDbPath = path.join(sessionDbDir, 'sessions.db');

let sessionStore = null;
if (sessionStoreType === 'sqlite') {
    if (!fs.existsSync(sessionDbDir)) {
        fs.mkdirSync(sessionDbDir, { recursive: true });
    }

    try {
        fs.accessSync(sessionDbDir, fs.constants.R_OK | fs.constants.W_OK);
        fs.closeSync(fs.openSync(sessionDbPath, 'a'));
        sessionStore = new SQLiteStore({ db: 'sessions.db', dir: sessionDbDir, table: 'sessions' });
    } catch (err) {
        console.error('Session storage is not writable, falling back to memory store:', sessionDbPath, err.message);
    }
}

app.set('trust proxy', 1);

// =============================================
// НАСТРОЙКА ПУТЕЙ
// =============================================


const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// =============================================
// ПОДКЛЮЧЕНИЕ К БД
// =============================================
const configuredDbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || 'soz.db';
const dbPath = path.isAbsolute(configuredDbPath)
    ? configuredDbPath
    : path.join(__dirname, configuredDbPath);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

try {
    fs.accessSync(dbDir, fs.constants.R_OK | fs.constants.W_OK);
    fs.closeSync(fs.openSync(dbPath, 'a'));
} catch (err) {
    console.error('SQLite database path is not writable:', dbPath, err.message);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключено к SQLite базе данных:', dbPath);
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

async function checkDatabaseWritable() {
    try {
        await dbRun(`CREATE TABLE IF NOT EXISTS _db_write_probe (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        const probe = await dbRun(`INSERT INTO _db_write_probe DEFAULT VALUES`);
        await dbRun(`DELETE FROM _db_write_probe WHERE id = ?`, [probe.lastID]);
        console.log('SQLite write check passed:', {
            dbPath,
            dbDir,
            cwd: process.cwd(),
            uid: typeof process.getuid === 'function' ? process.getuid() : null
        });
    } catch (err) {
        console.error('SQLite write check failed:', {
            dbPath,
            dbDir,
            cwd: process.cwd(),
            uid: typeof process.getuid === 'function' ? process.getuid() : null,
            code: err.code,
            message: err.message
        });
    }
}

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
        .replace(/ё/g, 'е')
        .replace(/[^a-z0-9а-я_-]+/gi, '_')
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
        throw new Error('Почта не настроена. Заполните SMTP-настройки в .env');
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

    await dbRun(
        `INSERT INTO email_verification_codes (user_id, email, purpose, code_hash, payload_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, normalizedEmail, purpose, codeHash, payload ? JSON.stringify(payload) : null, expiresAt]
    );

    let mail;
    try {
        mail = await sendMail(
            normalizedEmail,
            'Код подтверждения Созвездие',
            `Ваш код подтверждения: ${code}. Он действует 10 минут.`
        );
    } catch (err) {
        console.error('Email verification code send error:', {
            to: normalizedEmail,
            host: process.env.SMTP_HOST || null,
            port: process.env.SMTP_PORT || null,
            secure: process.env.SMTP_SECURE || null,
            user: process.env.SMTP_USER || null,
            message: err.message
        });
        throw err;
    }

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
        throw new Error('Код не найден. Запросите новый код.');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
        throw new Error('Срок действия кода истёк.');
    }
    if (row.code_hash !== codeHash) {
        throw new Error('Неверный код.');
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
    await dbRun(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT,
        is_answered INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        answered_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
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
    await dbRun(`CREATE VIEW IF NOT EXISTS application_analytics AS
        SELECT
            s.id AS squad_id,
            s.name AS squad_name,
            s.short_name AS squad_short_name,
            COUNT(a.id) AS total_applications,
            SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pending_applications,
            SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved_applications,
            SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_applications
        FROM squads s
        LEFT JOIN applications a ON a.squad_id = s.id
        GROUP BY s.id, s.name, s.short_name`);

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
            { id: 'safety', title: 'Безопасность в сети', reward: 12, order: 1, questions: [
                { text: 'Какой пароль считается надёжным?', options: ['12345678', 'qwerty2024', 'Случайный длинный пароль с разными символами'], correctIndex: 2 },
                { text: 'Что делать, если пришла подозрительная ссылка?', options: ['Открыть и проверить', 'Игнорировать и удалить', 'Переслать всем друзьям'], correctIndex: 1 },
                { text: 'Для чего нужна двухфакторная аутентификация?', options: ['Для дополнительной защиты аккаунта', 'Для красоты профиля', 'Чтобы быстрее входить без пароля'], correctIndex: 0 }
            ] },
            { id: 'content', title: 'Этичный контент', reward: 8, order: 2, questions: [
                { text: 'Можно ли публиковать чужое фото без разрешения?', options: ['Да, если фото красивое', 'Нет, нужно разрешение', 'Да, если удалить автора'], correctIndex: 1 },
                { text: 'Как реагировать на токсичные комментарии?', options: ['Ответить агрессией', 'Пожаловаться и не разжигать конфликт', 'Публиковать скрины с оскорблениями'], correctIndex: 1 }
            ] },
            { id: 'creative', title: 'Креативный мини-тест', reward: 15, order: 3, questions: [
                { text: 'Что важнее в первом кадре ролика?', options: ['Сильный хук и понятная идея', 'Случайный кадр', 'Только музыка'], correctIndex: 0 },
                { text: 'Как повысить вовлечение в посте?', options: ['Задать вопрос аудитории', 'Сделать длинный заголовок без смысла', 'Отключить комментарии'], correctIndex: 0 },
                { text: 'Зачем использовать единый визуальный стиль профиля?', options: ['Чтобы профиль легче запоминался', 'Это никак не влияет', 'Чтобы скрыть текст'], correctIndex: 0 },
                { text: 'Что лучше для понятного сообщения?', options: ['Один главный тезис', 'Сразу 10 разных мыслей', 'Только эмодзи'], correctIndex: 0 }
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
            ['Футболка', 4000, '/images/футболка.png', 1],
            ['Термокружка', 1000, '/images/термокружка.png', 2],
            ['Шоппер', 7000, '/images/шоппер.png', 3]
        ];
        for (const item of merch) {
            await dbRun(`INSERT INTO merch_items (name, price, image_url, order_index) VALUES (?, ?, ?, ?)`, item);
        }
    }

    const feedChat = await dbGet(`SELECT id FROM chats WHERE type = 'group' AND slug = 'global-feed'`);
    if (!feedChat) {
        await dbRun(
            `INSERT INTO chats (type, title, slug, avatar) VALUES ('group', 'Лента', 'global-feed', ?)`,
            ['/images/лента.png']
        );
    }

    const squads = await dbAll(`SELECT name, short_name, icon FROM squads WHERE is_active = 1`);
    for (const squad of squads) {
        const exists = await dbGet(`SELECT id FROM chats WHERE type = 'group' AND slug = ?`, [`squad-${squad.short_name}`]);
        if (!exists) {
            await dbRun(
                `INSERT INTO chats (type, title, slug, avatar) VALUES ('group', ?, ?, ?)`,
                [squad.name, `squad-${squad.short_name}`, squad.icon || '★']
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

checkDatabaseWritable()
    .then(() => initSocialSchema())
    .catch((err) => {
        console.error('Ошибка инициализации социальной схемы:', err.message);
    });

// =============================================
// MIDDLEWARE
// =============================================
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(publicDir));

app.use(express.static(path.join(__dirname, 'public/css')));

// Настройка сессий
app.use(session({
    ...(sessionStore ? { store: sessionStore } : {}),
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

// Настройка загрузки файлов (аватары)
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
            cb(new Error('Только изображения!'));
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
            console.log('✅ Токен GigaChat получен');
            return data.access_token;
        }
        console.error('❌ Ошибка получения токена:', data);
        return null;
    } catch (error) {
        console.error('❌ Ошибка получения токена:', error.message);
        return null;
    }
}

async function askGigaChat(userMessage, systemPromptOverride = null) {
    const token = await getGigaChatToken();
    if (!token) return null;

    const systemPrompt = `Ты дружелюбный ИИ-ассистент отрядного движения "Созвездие".

ОТРЯДЫ:
- КРЫЛЬЯ 💙: энергичные, инициативные, любят динамику, новые задачи и активный отдых. Драйв, скорость, развитие.
- КЛЕВЕР 🍀: душевные, спокойные, ценят коллектив, поддержку, дружбу и тёплую атмосферу.
- ФЕМИДА ⚖️: серьёзные, дисциплинированные, логичные. Любят порядок, структуру, правила и ответственность.
- АПЕЛЬСИН 🍊: творческие, открытые, любят внимание, юмор, креатив, веселье и лёгкость.
- ЭВЕРЕСТ 🏔: целеустремлённые, выносливые, любят преодолевать трудности. Сила, упорство, результат.

На основе ответов пользователя определи, какой отряд ему подходит.
Ответь ТОЛЬКО в формате JSON: {"squad": "название отряда", "reason": "почему подходит"}`;
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
        console.error('Ошибка GigaChat:', data);
        return null;
    } catch (error) {
        console.error('❌ Ошибка GigaChat:', error.message);
        return null;
    }
}

const TEST_SQUAD_CATALOG = {
    apelsin: {
        key: 'apelsin',
        name: 'СПО «Апельсин»',
        profile: 'общение, юмор, креатив, тепло команды, позитивная атмосфера'
    },
    'vokrug-sveta': {
        key: 'vokrug-sveta',
        name: 'СОП «Вокруг света»',
        profile: 'путешествия, сервис, новые места, мобильность, командная поддержка'
    },
    krylya: {
        key: 'krylya',
        name: 'СПО «Крылья»',
        profile: 'инициатива, дети, активность, ответственность, яркие проекты'
    },
    prospekt: {
        key: 'prospekt',
        name: 'СПО «Проспект»',
        profile: 'педагогическая работа, организация мероприятий, энергия, командная работа'
    },
    'zhar-ptitsa': {
        key: 'zhar-ptitsa',
        name: 'СПО «Жар-Птица»',
        profile: 'сцена, эмоции, творчество, события, умение зажигать других'
    },
    yamaika: {
        key: 'yamaika',
        name: 'СПО «Ямайка»',
        profile: 'дружная атмосфера, наставничество, поддержка, позитивный вайб, помощь детям'
    },
    shum: {
        key: 'shum',
        name: 'СПО «Шум»',
        profile: 'лидерство, организация, коммуникация, активность, большие события'
    },
    klever: {
        key: 'klever',
        name: 'ТОП «Клевер»',
        profile: 'забота, сервис, внимательность, спокойная командная поддержка'
    },
    femida: {
        key: 'femida',
        name: 'ТОП «Фемида»',
        profile: 'ответственность, справедливость, порядок, правила, системная работа'
    },
    everest: {
        key: 'everest',
        name: 'ТОП «Эверест»',
        profile: 'цель, настойчивость, рост, дисциплина, движение к результату'
    },
    kraski: {
        key: 'kraski',
        name: 'ТОП «Краски»',
        profile: 'визуальное творчество, дизайн, мастерские, эстетика, художественный вкус'
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
    const reason = `Тебе больше подходит ${best.name}: по ответам сильнее всего проявились ${traitText}. Профиль отряда: ${best.profile}.`;

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

    return `Ты анализируешь профориентационный тест для выбора студенческого отряда.
Нужно выбрать самый подходящий отряд из списка:
${squads}

Верни только валидный JSON без markdown:
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
        console.error('Ошибка подбора через GigaChat:', error.message);
    }

    return res.json(localResult);
});

// API эндпоинт для рекомендации отряда через ИИ
app.post('/api/ai-recommend', async (req, res) => {
    const { answers, scores } = req.body;

    if (!answers) {
        return res.status(400).json({ error: 'Нет данных для анализа' });
    }

    // Формируем сообщение для ИИ
    const answersText = answers.map((ans, idx) => {
        const qNum = idx + 1;
        let answerText = '';
        switch(ans) {
            case 'wings': answerText = 'беру инициативу, действую быстро'; break;
            case 'klever': answerText = 'присматриваюсь, ищу поддержку'; break;
            case 'femis': answerText = 'анализирую, вникаю в правила'; break;
            case 'apelsin': answerText = 'разряжаю обстановку шутками, креативлю'; break;
            case 'everest': answerText = 'иду туда, где сложнее, терплю и достигаю'; break;
            default: answerText = ans;
        }
        return `${qNum}. ${answerText}`;
    }).join('\n');

    const userMessage = `Вот ответы пользователя на 5 вопросов:
${answersText}

Определи, какой отряд (Крылья, Клевер, Фемида, Апельсин или Эверест) ему подходит больше всего.`;

    try {
        const aiResponse = await askGigaChat(userMessage);

        if (aiResponse) {
            // Парсим JSON из ответа
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return res.json({ success: true, ...result, fromAI: true });
            }
        }

        // Fallback: по баллам
        const squadByScores = getSquadByScores(scores);
        return res.json({ success: true, squad: squadByScores, reason: null, fromAI: false });
    } catch (error) {
        console.error('Ошибка:', error);
        const squadByScores = getSquadByScores(scores);
        res.json({ success: true, squad: squadByScores, reason: null, fromAI: false });
    }
});

function getSquadByScores(scores) {
    const squadMap = {
        'apelsin': 'Апельсин',
        'klever': 'Клевер',
        'femis': 'Фемида',
        'wings': 'Крылья',
        'everest': 'Эверест'
    };

    let maxScore = -1;
    let bestSquad = 'apelsin';

    for (const [squad, score] of Object.entries(scores || {})) {
        if (score > maxScore) {
            maxScore = score;
            bestSquad = squad;
        }
    }

    return squadMap[bestSquad] || 'Апельсин';
}
// =============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
// API: ПОЛЬЗОВАТЕЛИ
// =============================================

// Регистрация
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

// Вход
app.post('/api/login', (req, res) => {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.get(
        `SELECT * FROM users WHERE email = ? OR phone = ?`,
        [emailOrPhone, emailOrPhone],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Неверный email/телефон или пароль' });
            }

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'Неверный email/телефон или пароль' });
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

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Получение текущего пользователя
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ user });
        }
    );
});

// Обновление профиля
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ success: true });
        }
    );
});

// Смена пароля
app.put('/api/change-password', isAuthenticated, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Новый пароль и подтверждение не совпадают' });
    }

    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
    }

    db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.session.userId], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Текущий пароль неверен' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
            [newHash, req.session.userId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ success: true });
        });
    });
});

// Загрузка аватара
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
            return res.status(401).json({ error: 'Текущий пароль неверен' });
        }

        if (action === 'change_email') {
            if (!targetEmail || !targetEmail.includes('@')) {
                return res.status(400).json({ error: 'Введите корректную почту' });
            }
            const existing = await dbGet(`SELECT id FROM users WHERE email = ? AND id != ?`, [targetEmail, user.id]);
            if (existing) return res.status(400).json({ error: 'Эта почта уже занята' });
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
                return res.status(400).json({ error: 'Новый пароль должен быть не менее 4 символов' });
            }
            const result = await createEmailCode({
                email: user.email,
                purpose: 'change_password',
                userId: user.id,
                payload: { newPassword }
            });
            return res.json({ success: true, email: user.email, expiresAt: result.expiresAt });
        }

        res.status(400).json({ error: 'Неизвестное действие' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Ошибка сервера' });
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

        res.status(400).json({ error: 'Неизвестное действие' });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Ошибка подтверждения' });
    }
});

app.post('/api/upload-avatar', isAuthenticated, upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }

    const avatarPath = '/uploads/avatars/' + req.file.filename;
    db.run(`UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?`,
        [avatarPath, req.session.userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
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
// API: ОТРЯДЫ
// =============================================

// Получить все отряды (для главной)
app.get('/api/squads', (req, res) => {
    db.all(
        `SELECT id, name, short_name, title, description, icon, color_primary, order_index 
         FROM squads WHERE is_active = 1 ORDER BY order_index`,
        (err, squads) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ squads });
        }
    );
});

// Получить один отряд по short_name
app.get('/api/squads/:shortName', (req, res) => {
    const { shortName } = req.params;

    db.get(
        `SELECT * FROM squads WHERE short_name = ? AND is_active = 1`,
        [shortName],
        (err, squad) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            if (!squad) {
                return res.status(404).json({ error: 'Отряд не найден' });
            }

            // Получаем командиров отряда
            db.all(
                `SELECT * FROM commanders WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
                [squad.id],
                (err, commanders) => {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка сервера' });
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            if (!squad) {
                return res.status(404).json({ error: 'Страница отряда не найдена' });
            }

            db.all(
                `SELECT title, body, color_role FROM squad_page_trust_cards
                 WHERE squad_id = ? ORDER BY order_index`,
                [squad.id],
                (err, trustCards) => {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка сервера' });
                    }

                    db.all(
                        `SELECT title, body, image FROM squad_page_structure_steps
                         WHERE squad_id = ? ORDER BY order_index`,
                        [squad.id],
                        (err, structureSteps) => {
                            if (err) {
                                return res.status(500).json({ error: 'Ошибка сервера' });
                            }

                            db.all(
                                `SELECT role, name, body, image FROM squad_page_team_members
                                 WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
                                [squad.id],
                                (err, teamMembers) => {
                                    if (err) {
                                        return res.status(500).json({ error: 'Ошибка сервера' });
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
// API: ЗАЯВКИ
// =============================================

// Подать заявку в отряд
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

// Получить заявки пользователя (для личного кабинета)
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ applications });
        }
    );
});

// =============================================
// API: ВОПРОСЫ
// =============================================

// Отправить вопрос
app.post('/api/ask-question', (req, res) => {
    const { name, phone, question } = req.body;
    const userId = req.session.userId || null;

    if (!name || !phone || !question) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.run(
        `INSERT INTO questions (user_id, name, phone, question, is_answered, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))`,
        [userId, name, phone, question],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ success: true });
        }
    );
});

// =============================================
// API: ТЕСТ (ПОДБОР ОТРЯДА)
// =============================================

// Сохранить результат теста
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ success: true });
        }
    );
});

// =============================================
// API: СТАТИСТИКА ДЛЯ ГЛАВНОЙ
// =============================================

app.get('/api/stats', (req, res) => {
    db.all(`SELECT stat_key, stat_value, stat_label FROM site_stats ORDER BY order_index`, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
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
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json({ faq });
    });
});

// =============================================
// API: СЛАЙДЕР ГЛАВНОЙ
// =============================================

app.get('/api/hero-slides', (req, res) => {
    db.all(`SELECT * FROM hero_slides WHERE is_active = 1 ORDER BY order_index`, (err, slides) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json({ slides });
    });
});

// =============================================
// API: КОМАНДИРЫ ДЛЯ СЛАЙДЕРА
// =============================================

// API: КОМАНДИРЫ ДЛЯ СЛАЙДЕРА (только главный штаб, squad_id = 1)
app.get('/api/commanders', (req, res) => {
    db.all(
        `SELECT c.*, s.short_name as squad_short_name, s.name as squad_name 
         FROM commanders c
         JOIN squads s ON c.squad_id = s.id
         WHERE c.is_active = 1 AND c.squad_id = 1
         ORDER BY c.order_index`,
        (err, commanders) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ commanders });
        }
    );
});

// API: КОМАНДИРЫ ПО ID ОТРЯДА (для страницы Крыльев)
app.get('/api/squad-commanders/:squadId', (req, res) => {
    const squadId = req.params.squadId;
    db.all(
        `SELECT * FROM commanders WHERE squad_id = ? AND is_active = 1 ORDER BY order_index`,
        [squadId],
        (err, commanders) => {
            if (err) {
                console.error('Ошибка загрузки командиров:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ commanders });
        }
    );
});

// API: КОМАНДА МЕЧТЫ (для страницы "О нас")
app.get('/api/dream-team', (req, res) => {
    db.all(
        `SELECT * FROM dream_team WHERE is_active = 1 ORDER BY order_index`,
        (err, team) => {
            if (err) {
                console.error('Ошибка загрузки dream-team:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            console.log('Dream team loaded:', team); // Для отладки
            res.json({ team });
        }
    );
});

app.get('/group_klever.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'group_klever.html'));
});

// =============================================
// АДМИН-ПАНЕЛЬ
// =============================================

// Middleware для проверки админа
function isAdmin(req, res, next) {
    if (req.session.isAdmin) return next();
    if (!req.session.userId) return res.status(401).json({ error: 'Доступ запрещен' });
    db.get(`SELECT role, email FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !isAdminUser(user)) return res.status(401).json({ error: 'Доступ запрещен' });
        req.session.isAdmin = true;
        next();
    });
}

// Вход в админку
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

// Выход из админки
app.post('/api/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.json({ success: true });
});

// Проверка статуса админа
app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: req.session.isAdmin === true });
});

// Получение всех пользователей
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
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ users });
    });
});

// Обновление роли пользователя
app.put('/api/admin/users/:id/role', isAdmin, (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true });
    });
});

// Удаление пользователя
app.delete('/api/admin/users/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM users WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true });
    });
});

app.put('/api/admin/users/:id/ban', isAdmin, async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const user = await dbGet(`SELECT email FROM users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        if (user.email === 'ultrasecret@admin.com') return res.status(400).json({ error: 'Администратора нельзя банить' });
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

// Получение всех заявок
app.get('/api/admin/applications', isAdmin, (req, res) => {
    db.all(`
        SELECT a.*, s.name as squad_name, s.short_name, u.email AS user_email
        FROM applications a
        JOIN squads s ON a.squad_id = s.id
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC
    `, (err, apps) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        db.all(`SELECT id, name, short_name FROM squads ORDER BY order_index, id`, (squadErr, squads) => {
            if (squadErr) return res.status(500).json({ error: 'Ошибка сервера' });
            res.json({ applications: apps, squads });
        });
    });
});

// Аналитика заявок по отрядам
app.get('/api/admin/application-analytics', isAdmin, (req, res) => {
    db.all(
        `SELECT
            squad_id,
            squad_name,
            squad_short_name,
            COALESCE(total_applications, 0) AS total_applications,
            COALESCE(pending_applications, 0) AS pending_applications,
            COALESCE(approved_applications, 0) AS approved_applications,
            COALESCE(rejected_applications, 0) AS rejected_applications
         FROM application_analytics
         ORDER BY total_applications DESC, squad_name`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Ошибка сервера' });
            res.json({ analytics: rows });
        }
    );
});

// Обновление статуса заявки
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

// Получение всех вопросов
app.get('/api/admin/questions', isAdmin, (req, res) => {
    db.all(`SELECT * FROM questions ORDER BY created_at DESC`, (err, questions) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ questions });
    });
});

// Ответ на вопрос
app.put('/api/admin/questions/:id/answer', isAdmin, (req, res) => {
    const { id } = req.params;
    const { answer } = req.body;
    db.run(`UPDATE questions SET answer = ?, is_answered = 1, answered_at = datetime('now') WHERE id = ?`,
        [answer, id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true });
    });
});

// Получение отрядов
app.get('/api/admin/squads', isAdmin, (req, res) => {
    db.all(`SELECT * FROM squads ORDER BY order_index`, (err, squads) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ squads });
    });
});

// Обновление отряда
app.put('/api/admin/squads/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    const { name, description, is_active } = req.body;
    db.run(`UPDATE squads SET name = ?, description = ?, is_active = ? WHERE id = ?`,
        [name, description, is_active, id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true });
    });
});

function normalizeAdminBool(value) {
    return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function normalizeTestQuestions(input) {
    let questions = input;
    if (typeof questions === 'string') {
        questions = JSON.parse(questions);
    }
    if (!Array.isArray(questions) || !questions.length) {
        throw new Error('Добавьте хотя бы один вопрос');
    }
    return questions.map((question, index) => {
        const text = String(question.text || '').trim();
        const options = Array.isArray(question.options) ? question.options.map((option) => String(option || '').trim()).filter(Boolean) : [];
        const correctIndex = Number(question.correctIndex);
        if (!text) throw new Error(`Вопрос ${index + 1}: заполните текст`);
        if (options.length < 2) throw new Error(`Вопрос ${index + 1}: нужно минимум 2 варианта ответа`);
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            throw new Error(`Вопрос ${index + 1}: правильный ответ указан неверно`);
        }
        return { text, options, correctIndex };
    });
}

// Управление карточками командиров/комиссаров по отрядам
app.get('/api/admin/commanders', isAdmin, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.query.squadId && req.query.squadId !== 'all') {
            where = 'WHERE c.squad_id = ?';
            params.push(req.query.squadId);
        }
        const commanders = await dbAll(
            `SELECT c.*, s.name AS squad_name, s.short_name AS squad_short_name
             FROM commanders c
             JOIN squads s ON s.id = c.squad_id
             ${where}
             ORDER BY s.order_index, c.order_index, c.id`,
            params
        );
        res.json({ commanders });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/commanders', isAdmin, async (req, res) => {
    try {
        const { squad_id, role, name, photo, description, experience, order_index, is_active } = req.body;
        if (!squad_id || !role || !name || !description) {
            return res.status(400).json({ error: 'Заполните отряд, роль, имя и описание' });
        }
        const result = await dbRun(
            `INSERT INTO commanders (squad_id, role, name, photo, description, experience, order_index, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                Number(squad_id),
                String(role).trim(),
                String(name).trim(),
                String(photo || '').trim(),
                String(description).trim(),
                String(experience || '').trim(),
                Number(order_index || 0),
                normalizeAdminBool(is_active ?? 1)
            ]
        );
        res.json({ success: true, id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/admin/commanders/:id', isAdmin, async (req, res) => {
    try {
        const { squad_id, role, name, photo, description, experience, order_index, is_active } = req.body;
        if (!squad_id || !role || !name || !description) {
            return res.status(400).json({ error: 'Заполните отряд, роль, имя и описание' });
        }
        await dbRun(
            `UPDATE commanders
             SET squad_id = ?, role = ?, name = ?, photo = ?, description = ?, experience = ?, order_index = ?, is_active = ?
             WHERE id = ?`,
            [
                Number(squad_id),
                String(role).trim(),
                String(name).trim(),
                String(photo || '').trim(),
                String(description).trim(),
                String(experience || '').trim(),
                Number(order_index || 0),
                normalizeAdminBool(is_active),
                req.params.id
            ]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/commanders/:id', isAdmin, async (req, res) => {
    try {
        await dbRun(`DELETE FROM commanders WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Управление мерчем в профиле
app.get('/api/admin/merch', isAdmin, async (req, res) => {
    try {
        const merch = await dbAll(`SELECT * FROM merch_items ORDER BY order_index, id`);
        res.json({ merch });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/merch', isAdmin, async (req, res) => {
    try {
        const { name, price, image_url, order_index, is_active } = req.body;
        if (!name || !Number.isFinite(Number(price))) {
            return res.status(400).json({ error: 'Заполните название и цену' });
        }
        const result = await dbRun(
            `INSERT INTO merch_items (name, price, image_url, order_index, is_active) VALUES (?, ?, ?, ?, ?)`,
            [String(name).trim(), Number(price), String(image_url || '').trim(), Number(order_index || 0), normalizeAdminBool(is_active ?? 1)]
        );
        res.json({ success: true, id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/admin/merch/:id', isAdmin, async (req, res) => {
    try {
        const { name, price, image_url, order_index, is_active } = req.body;
        if (!name || !Number.isFinite(Number(price))) {
            return res.status(400).json({ error: 'Заполните название и цену' });
        }
        await dbRun(
            `UPDATE merch_items SET name = ?, price = ?, image_url = ?, order_index = ?, is_active = ? WHERE id = ?`,
            [String(name).trim(), Number(price), String(image_url || '').trim(), Number(order_index || 0), normalizeAdminBool(is_active), req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/merch/:id', isAdmin, async (req, res) => {
    try {
        await dbRun(`DELETE FROM merch_items WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Управление тестами за баллы в профиле
app.get('/api/admin/social-tests', isAdmin, async (req, res) => {
    try {
        const tests = await dbAll(`SELECT * FROM social_tests ORDER BY order_index, title`);
        res.json({
            tests: tests.map((test) => ({
                ...test,
                questions: JSON.parse(test.questions_json)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/social-tests', isAdmin, async (req, res) => {
    try {
        const id = String(req.body.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const title = String(req.body.title || '').trim();
        const reward = Number(req.body.reward);
        const questions = normalizeTestQuestions(req.body.questions);
        if (!id || !title || !Number.isFinite(reward)) {
            return res.status(400).json({ error: 'Заполните ID, название и награду' });
        }
        await dbRun(
            `INSERT INTO social_tests (id, title, reward, questions_json, is_active, order_index) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, title, reward, JSON.stringify(questions), normalizeAdminBool(req.body.is_active ?? 1), Number(req.body.order_index || 0)]
        );
        res.json({ success: true, id });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Не удалось сохранить тест' });
    }
});

app.put('/api/admin/social-tests/:id', isAdmin, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim();
        const reward = Number(req.body.reward);
        const questions = normalizeTestQuestions(req.body.questions);
        if (!title || !Number.isFinite(reward)) {
            return res.status(400).json({ error: 'Заполните название и награду' });
        }
        await dbRun(
            `UPDATE social_tests SET title = ?, reward = ?, questions_json = ?, is_active = ?, order_index = ? WHERE id = ?`,
            [title, reward, JSON.stringify(questions), normalizeAdminBool(req.body.is_active), Number(req.body.order_index || 0), req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Не удалось сохранить тест' });
    }
});

app.delete('/api/admin/social-tests/:id', isAdmin, async (req, res) => {
    try {
        await dbRun(`DELETE FROM social_tests WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение статистики
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

// Страница админки
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
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ gallery });
        }
    );
});

// =============================================
// ОТДАЧА HTML СТРАНИЦ (С ПЕРЕДАЧЕЙ ДАННЫХ)
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
// ЗАПУСК СЕРВЕРА
// =============================================
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Доступные страницы:`);
    console.log(`  - http://localhost:${PORT}/`);
    console.log(`  - http://localhost:${PORT}/register.html`);
    console.log(`  - http://localhost:${PORT}/test.html`);
    console.log(`  - http://localhost:${PORT}/group_wings.html`);
    console.log(`  - http://localhost:${PORT}/profile.html (требуется авторизация)`);
});




