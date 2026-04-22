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

app.get('/', (req, res) => {
  res.send('Hello world');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server started on port', PORT);
});

// =============================================
// MIDDLEWARE
// =============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

app.use(express.static(path.join(__dirname, 'public/css')));

// Настройка сессий
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', table: 'sessions' }),
    secret: 'sozvezdie_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,  // ← МЕНЯЕМ на true для HTTPS
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        sameSite: 'lax'  // ← Добавляем
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

    if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Пароли не совпадают' });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
            `INSERT INTO users (full_name, email, phone, password_hash, role, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'user', datetime('now'), datetime('now'))`,
            [fullName, email, phone, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Пользователь с таким email или телефоном уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.json({ success: true, userId: this.lastID });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
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

app.get('/about.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/profile.html', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/register.html');
    }
    res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/auth.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/test.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
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
    console.log(`  - http://localhost:${PORT}/about.html`);
    console.log(`  - http://localhost:${PORT}/register.html`);
    console.log(`  - http://localhost:${PORT}/test.html`);
    console.log(`  - http://localhost:${PORT}/group_wings.html`);
    console.log(`  - http://localhost:${PORT}/profile.html (требуется авторизация)`);
});
