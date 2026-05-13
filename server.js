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
    console.warn('nodemailer не установлен, email-коды будут выводиться в консоль');
}

const app = express();
const PORT = 3000;

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
const db = new sqlite3.Database('./soz.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключено к SQLite базе данных');
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
        role: user.role || 'user'
    };
}

async function getCurrentUser(req) {
    if (!req.session.userId) return null;
    const user = await dbGet(
        `SELECT id, full_name, email, phone, role, avatar, username, bio, cover, points
         FROM users WHERE id = ?`,
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
    return user;
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

    const mail = await sendMail(
        normalizedEmail,
        'Код подтверждения Созвездие',
        `Ваш код подтверждения: ${code}. Он действует 10 минут.`
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
}

initSocialSchema().catch((err) => {
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
    store: new SQLiteStore({ db: 'sessions.db', table: 'sessions' }),
    secret: 'sozvezdie_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // для разработки (http)
        maxAge: 1000 * 60 * 60 * 24, // 24 часа
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

async function askGigaChat(userMessage) {
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
                    { role: 'system', content: systemPrompt },
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
        res.json({ success: true, user: publicUser({
            id: created.lastID,
            full_name: payload.fullName,
            email,
            phone: payload.phone,
            role: 'user',
            username,
            points: 1000
        }) });
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

            req.session.userId = user.id;
            req.session.userName = user.full_name;
            req.session.userRole = user.role;

            res.json({
                success: true,
                user: {
                    id: user.id,
                    full_name: user.full_name,
                    email: user.email,
                    role: user.role
                }
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
app.post('/api/apply', (req, res) => {
    const { squadId, fullName, phone, class: userClass } = req.body;
    const userId = req.session.userId || null;

    if (!squadId || !fullName || !phone || !userClass) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.run(
        `INSERT INTO applications (user_id, squad_id, full_name, phone, class, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
        [userId, squadId, fullName, phone, userClass],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ success: true, applicationId: this.lastID });
        }
    );
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
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ error: 'Доступ запрещен' });
    }
}

// Вход в админку
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin123') {
        req.session.isAdmin = true;
        req.session.adminId = 1;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверный пароль' });
    }
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
    db.all(`SELECT id, full_name, email, phone, role, created_at FROM users ORDER BY id DESC`, (err, users) => {
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

// Получение всех заявок
app.get('/api/admin/applications', isAdmin, (req, res) => {
    db.all(`
        SELECT a.*, s.name as squad_name 
        FROM applications a
        JOIN squads s ON a.squad_id = s.id
        ORDER BY a.created_at DESC
    `, (err, apps) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ applications: apps });
    });
});

// Обновление статуса заявки
app.put('/api/admin/applications/:id/status', isAdmin, (req, res) => {
    const { id } = req.params;
    const { status, comment } = req.body;
    db.run(`UPDATE applications SET status = ?, comment = ?, updated_at = datetime('now') WHERE id = ?`,
        [status, comment || null, id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true });
    });
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


