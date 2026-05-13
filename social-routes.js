module.exports = function registerSocialRoutes(ctx) {
    const {
        app,
        dbRun,
        dbGet,
        dbAll,
        publicUser,
        getCurrentUser,
        requireUser,
        slugify
    } = ctx;

    async function getPostWithDetails(post, viewerId) {
        const [images, likeRow, likesRow] = await Promise.all([
            dbAll(`SELECT image_url FROM post_images WHERE post_id = ? ORDER BY order_index, id`, [post.id]),
            viewerId ? dbGet(`SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?`, [post.id, viewerId]) : null,
            dbGet(`SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?`, [post.id])
        ]);

        return {
            id: post.id,
            text: post.text || '',
            status: post.status,
            source: post.source,
            createdAt: post.created_at,
            time: post.created_at,
            author: publicUser({
                id: post.author_id,
                full_name: post.author_name,
                email: post.author_email,
                username: post.author_username,
                avatar: post.author_avatar,
                cover: post.author_cover,
                bio: post.author_bio,
                points: post.author_points
            }),
            wallOwner: publicUser({
                id: post.wall_owner_id,
                full_name: post.wall_owner_name,
                email: post.wall_owner_email,
                username: post.wall_owner_username,
                avatar: post.wall_owner_avatar,
                cover: post.wall_owner_cover,
                bio: post.wall_owner_bio,
                points: post.wall_owner_points
            }),
            images: images.map((item) => item.image_url),
            likes: Number(likesRow?.count || 0),
            liked: Boolean(likeRow),
            views: 1
        };
    }

    async function listPosts({ viewerId, wallOwnerId = null }) {
        const params = [];
        let where = `p.status = 'published'`;
        if (wallOwnerId) {
            where += ` AND p.wall_owner_id = ?`;
            params.push(wallOwnerId);
        }

        const posts = await dbAll(
            `SELECT p.*,
                    au.full_name AS author_name, au.email AS author_email, au.username AS author_username,
                    au.avatar AS author_avatar, au.cover AS author_cover, au.bio AS author_bio, au.points AS author_points,
                    wu.full_name AS wall_owner_name, wu.email AS wall_owner_email, wu.username AS wall_owner_username,
                    wu.avatar AS wall_owner_avatar, wu.cover AS wall_owner_cover, wu.bio AS wall_owner_bio, wu.points AS wall_owner_points
             FROM posts p
             JOIN users au ON au.id = p.author_id
             JOIN users wu ON wu.id = p.wall_owner_id
             WHERE ${where}
             ORDER BY datetime(p.created_at) DESC, p.id DESC`,
            params
        );

        return Promise.all(posts.map((post) => getPostWithDetails(post, viewerId)));
    }

    async function createNotification({ userId, actorId, type, body, entityType, entityId, actionState = null }) {
        await dbRun(
            `INSERT INTO notifications (user_id, actor_id, type, body, entity_type, entity_id, action_state)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, actorId, type, body, entityType, entityId, actionState]
        );
    }

    async function getFeedChat() {
        let chat = await dbGet(`SELECT * FROM chats WHERE type = 'group' AND slug = 'global-feed'`);
        if (!chat) {
            const result = await dbRun(
                `INSERT INTO chats (type, title, slug, avatar) VALUES ('group', 'Лента', 'global-feed', ?)`,
                ['/images/лента.png']
            );
            chat = await dbGet(`SELECT * FROM chats WHERE id = ?`, [result.lastID]);
        }
        return chat;
    }

    async function listChatMessages(chatId, viewerId) {
        const rows = await dbAll(
            `SELECT m.*, u.full_name, u.email, u.username, u.avatar, u.points
             FROM chat_messages m JOIN users u ON u.id = m.user_id
             WHERE m.chat_id = ?
             ORDER BY datetime(m.created_at), m.id`,
            [chatId]
        );
        const messages = [];
        for (const row of rows) {
            const images = await dbAll(`SELECT image_url FROM chat_message_images WHERE message_id = ? ORDER BY order_index`, [row.id]);
            messages.push({
                id: row.id,
                text: row.text || '',
                createdAt: row.created_at,
                isMine: row.user_id === viewerId,
                author: publicUser({
                    id: row.user_id,
                    full_name: row.full_name,
                    email: row.email,
                    username: row.username,
                    avatar: row.avatar,
                    points: row.points
                }),
                authorAvatar: publicUser({
                    id: row.user_id,
                    full_name: row.full_name,
                    email: row.email,
                    username: row.username,
                    avatar: row.avatar,
                    points: row.points
                })?.avatar,
                images: images.map((item) => item.image_url)
            });
        }
        return messages;
    }

    app.get('/api/social/bootstrap', async (req, res) => {
        try {
            res.json({ user: await getCurrentUser(req) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.put('/api/social/profile', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;

            const { name, username, bio, avatar, cover } = req.body;
            const nextName = String(name || user.name).trim().slice(0, 120);
            const nextUsername = slugify(username || nextName, user.handle);

            await dbRun(
                `UPDATE users SET full_name = ?, username = ?, bio = ?, avatar = ?, cover = ?, is_profile_complete = 1, updated_at = datetime('now')
                 WHERE id = ?`,
                [nextName, nextUsername, String(bio || '').slice(0, 500), avatar || user.avatar, cover || user.cover, user.id]
            );

            res.json({ success: true, user: await getCurrentUser(req) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/users/:id', async (req, res) => {
        try {
            const user = await dbGet(`SELECT id, full_name, email, phone, role, avatar, username, bio, cover, points FROM users WHERE id = ?`, [req.params.id]);
            if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
            res.json({ user: publicUser(user) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/users', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const query = `%${String(req.query.q || '').trim()}%`;
            const users = await dbAll(
                `SELECT id, full_name, email, phone, role, avatar, username, bio, cover, points
                 FROM users
                 WHERE id != ? AND (full_name LIKE ? OR username LIKE ? OR email LIKE ?)
                 ORDER BY full_name LIMIT 30`,
                [user.id, query, query, query]
            );
            res.json({ users: users.map(publicUser) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/posts', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const wallOwnerId = req.query.wallOwnerId ? Number(req.query.wallOwnerId) : null;
            res.json({ posts: await listPosts({ viewerId: user.id, wallOwnerId }) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/feed', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const chat = await getFeedChat();
            res.json({ chat: await formatChat(chat, user.id), messages: await listChatMessages(chat.id, user.id) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/feed', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const chat = await getFeedChat();
            const text = String(req.body.text || '').trim().slice(0, 2000);
            const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 4) : [];
            if (!text && !images.length) return res.status(400).json({ error: 'Сообщение пустое' });

            const result = await dbRun(`INSERT INTO chat_messages (chat_id, user_id, text) VALUES (?, ?, ?)`, [chat.id, user.id, text]);
            for (let i = 0; i < images.length; i += 1) {
                await dbRun(`INSERT INTO chat_message_images (message_id, image_url, order_index) VALUES (?, ?, ?)`, [result.lastID, images[i], i]);
            }
            await dbRun(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`, [chat.id]);
            res.json({ success: true, messageId: result.lastID });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/posts', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const text = String(req.body.text || '').trim().slice(0, 2000);
            const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 4) : [];
            const wallOwnerId = Number(req.body.wallOwnerId || user.id);
            if (!text && !images.length) return res.status(400).json({ error: 'Пост пустой' });

            const owner = await dbGet(`SELECT id FROM users WHERE id = ?`, [wallOwnerId]);
            if (!owner) return res.status(404).json({ error: 'Пользователь не найден' });

            const isOwnWall = wallOwnerId === user.id;
            const status = isOwnWall ? 'published' : 'pending';
            const source = isOwnWall ? 'own' : 'wall_request';
            const result = await dbRun(
                `INSERT INTO posts (author_id, wall_owner_id, text, status, source, published_at)
                 VALUES (?, ?, ?, ?, ?, ${isOwnWall ? "datetime('now')" : "NULL"})`,
                [user.id, wallOwnerId, text, status, source]
            );

            for (let i = 0; i < images.length; i += 1) {
                await dbRun(`INSERT INTO post_images (post_id, image_url, order_index) VALUES (?, ?, ?)`, [result.lastID, images[i], i]);
            }

            if (!isOwnWall) {
                await createNotification({
                    userId: wallOwnerId,
                    actorId: user.id,
                    type: 'wall_post_request',
                body: `${user.name} хочет опубликовать пост у вас в профиле`,
                    entityType: 'post',
                    entityId: result.lastID,
                    actionState: 'pending'
                });
            }

            res.json({ success: true, status, postId: result.lastID });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/posts/:id/like', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const postId = Number(req.params.id);
            const existing = await dbGet(`SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, user.id]);

            if (existing) {
                await dbRun(`DELETE FROM post_likes WHERE id = ?`, [existing.id]);
            } else {
                await dbRun(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)`, [postId, user.id]);
                const post = await dbGet(`SELECT author_id FROM posts WHERE id = ?`, [postId]);
                if (post && post.author_id !== user.id) {
                    await createNotification({
                        userId: post.author_id,
                        actorId: user.id,
                        type: 'like',
                        body: `${user.name} лайкнул ваш пост`,
                        entityType: 'post',
                        entityId: postId
                    });
                }
            }

            const likes = await dbGet(`SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?`, [postId]);
            res.json({ success: true, liked: !existing, likes: Number(likes.count || 0) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/notifications', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const rows = await dbAll(
                `SELECT n.*, u.full_name AS actor_name, u.email AS actor_email, u.username AS actor_username, u.avatar AS actor_avatar,
                        p.text AS post_text
                 FROM notifications n
                 LEFT JOIN users u ON u.id = n.actor_id
                 LEFT JOIN posts p ON n.entity_type = 'post' AND p.id = n.entity_id
                 WHERE n.user_id = ?
                 ORDER BY datetime(n.created_at) DESC, n.id DESC`,
                [user.id]
            );

            res.json({ notifications: rows.map((item) => ({
                id: item.id,
                type: item.type,
                body: item.body,
                entityType: item.entity_type,
                entityId: item.entity_id,
                actionState: item.action_state,
                isRead: Boolean(item.is_read),
                createdAt: item.created_at,
                postText: item.post_text || '',
                actor: publicUser({
                    id: item.actor_id,
                    full_name: item.actor_name || 'Созвездие',
                    email: item.actor_email,
                    username: item.actor_username,
                    avatar: item.actor_avatar
                })
            })) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/notifications/:id/wall-post-decision', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const decision = req.body.decision === 'accept' ? 'accepted' : 'rejected';
            const notification = await dbGet(
                `SELECT * FROM notifications WHERE id = ? AND user_id = ? AND type = 'wall_post_request' AND action_state = 'pending'`,
                [req.params.id, user.id]
            );
            if (!notification) return res.status(404).json({ error: 'Уведомление не найдено' });

            await dbRun(
                `UPDATE posts SET status = ?, published_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE published_at END, updated_at = datetime('now')
                 WHERE id = ? AND wall_owner_id = ?`,
                [decision === 'accepted' ? 'published' : 'rejected', decision, notification.entity_id, user.id]
            );
            await dbRun(`UPDATE notifications SET action_state = ?, is_read = 1, read_at = datetime('now') WHERE id = ?`, [decision, notification.id]);
            res.json({ success: true, actionState: decision });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/create-data', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const [tests, results, merch, freshUser] = await Promise.all([
                dbAll(`SELECT * FROM social_tests WHERE is_active = 1 ORDER BY order_index`),
                dbAll(`SELECT test_id, score, max_score, points_awarded FROM user_test_results WHERE user_id = ?`, [user.id]),
                dbAll(`SELECT * FROM merch_items WHERE is_active = 1 ORDER BY order_index, id`),
                getCurrentUser(req)
            ]);

            res.json({
                points: freshUser.points,
                completedTests: results,
                tests: tests.map((test) => ({
                    id: test.id,
                    title: test.title,
                    reward: test.reward,
                    questions: JSON.parse(test.questions_json)
                })),
                merch: merch.map((item) => ({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    image: item.image_url
                }))
            });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/tests/:id/complete', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const test = await dbGet(`SELECT * FROM social_tests WHERE id = ? AND is_active = 1`, [req.params.id]);
            if (!test) return res.status(404).json({ error: 'Тест не найден' });
            const existing = await dbGet(`SELECT id FROM user_test_results WHERE user_id = ? AND test_id = ?`, [user.id, test.id]);
            if (existing) return res.json({ success: true, alreadyCompleted: true, pointsAwarded: 0, points: user.points });

            const questions = JSON.parse(test.questions_json);
            const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
            const score = questions.reduce((sum, q, index) => sum + (Number(answers[index]) === Number(q.correctIndex) ? 1 : 0), 0);
            const pointsAwarded = Math.round((score / questions.length) * Number(test.reward));

            await dbRun(
                `INSERT INTO user_test_results (user_id, test_id, score, max_score, points_awarded) VALUES (?, ?, ?, ?, ?)`,
                [user.id, test.id, score, questions.length, pointsAwarded]
            );

            if (pointsAwarded > 0) {
                await dbRun(`UPDATE users SET points = COALESCE(points, 0) + ? WHERE id = ?`, [pointsAwarded, user.id]);
                await dbRun(`INSERT INTO points_transactions (user_id, amount, reason, ref_type, ref_id) VALUES (?, ?, ?, 'test', ?)`, [user.id, pointsAwarded, `Тест: ${test.title}`, test.id]);
                await createNotification({
                    userId: user.id,
                    actorId: null,
                    type: 'points',
                    body: `На ваш баланс зачислено ${pointsAwarded} баллов за тест "${test.title}"`,
                    entityType: 'test',
                    entityId: null
                });
            }

            res.json({ success: true, score, maxScore: questions.length, pointsAwarded, points: (await getCurrentUser(req)).points });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/merch/:id/buy', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const item = await dbGet(`SELECT * FROM merch_items WHERE id = ? AND is_active = 1`, [req.params.id]);
            if (!item) return res.status(404).json({ error: 'Товар не найден' });
            if (user.points < item.price) return res.status(400).json({ error: `Недостаточно баллов. На балансе: ${user.points}` });

            await dbRun(`UPDATE users SET points = points - ? WHERE id = ?`, [item.price, user.id]);
            const order = await dbRun(
                `INSERT INTO merch_orders (user_id, merch_item_id, squad, role, buyer_name, price) VALUES (?, ?, ?, ?, ?, ?)`,
                [user.id, item.id, req.body.squad || '', req.body.role || '', req.body.name || user.name, item.price]
            );
            await dbRun(`INSERT INTO points_transactions (user_id, amount, reason, ref_type, ref_id) VALUES (?, ?, ?, 'merch', ?)`, [user.id, -item.price, `Покупка: ${item.name}`, order.lastID]);
            await createNotification({
                userId: user.id,
                actorId: null,
                type: 'merch',
                body: `Покупка "${item.name}" оформлена`,
                entityType: 'merch_order',
                entityId: order.lastID
            });
            res.json({ success: true, points: (await getCurrentUser(req)).points });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    async function getDirectChat(userId, otherUserId) {
        return dbGet(
            `SELECT c.*
             FROM chats c
             JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
             JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
             WHERE c.type = 'direct'
             LIMIT 1`,
            [userId, otherUserId]
        );
    }

    async function formatChat(chat, userId) {
        let title = chat.title;
        let avatar = chat.avatar;
        let otherUser = null;

        if (chat.type === 'direct') {
            const row = await dbGet(
                `SELECT u.id, u.full_name, u.email, u.username, u.avatar, u.points
                 FROM chat_members cm JOIN users u ON u.id = cm.user_id
                 WHERE cm.chat_id = ? AND u.id != ? LIMIT 1`,
                [chat.id, userId]
            );
            otherUser = publicUser(row);
            title = otherUser?.name || 'Личный чат';
            avatar = otherUser?.avatar || avatar;
        }

        const last = await dbGet(
            `SELECT m.text, m.created_at
             FROM chat_messages m
             WHERE m.chat_id = ?
             ORDER BY datetime(m.created_at) DESC, m.id DESC LIMIT 1`,
            [chat.id]
        );

        return {
            id: chat.id,
            type: chat.type,
            title,
            avatar,
            slug: chat.slug,
            otherUser,
            preview: last?.text || 'Начните диалог',
            updatedAt: last?.created_at || chat.updated_at || chat.created_at
        };
    }

    app.get('/api/social/chats', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const chats = await dbAll(
                `SELECT DISTINCT c.*
                 FROM chats c
                 LEFT JOIN chat_members cm ON cm.chat_id = c.id
                 WHERE (c.type = 'group' AND c.slug != 'global-feed') OR cm.user_id = ?
                 ORDER BY datetime(c.updated_at) DESC, c.id DESC`,
                [user.id]
            );
            res.json({ chats: await Promise.all(chats.map((chat) => formatChat(chat, user.id))) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/chats/search', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const q = `%${String(req.query.q || '').trim()}%`;
            const [users, groups] = await Promise.all([
                dbAll(`SELECT id, full_name, email, username, avatar, points FROM users WHERE id != ? AND (full_name LIKE ? OR username LIKE ? OR email LIKE ?) LIMIT 20`, [user.id, q, q, q]),
                dbAll(`SELECT id, type, title, slug, avatar FROM chats WHERE type = 'group' AND slug != 'global-feed' AND (title LIKE ? OR slug LIKE ?) LIMIT 20`, [q, q])
            ]);
            res.json({
                users: users.map(publicUser),
                groups: groups.map((chat) => ({ id: chat.id, type: chat.type, title: chat.title, avatar: chat.avatar, slug: chat.slug }))
            });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/chats/direct', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const otherUserId = Number(req.body.userId);
            if (!otherUserId || otherUserId === user.id) return res.status(400).json({ error: 'Некорректный пользователь' });
            const other = await dbGet(`SELECT id FROM users WHERE id = ?`, [otherUserId]);
            if (!other) return res.status(404).json({ error: 'Пользователь не найден' });

            let chat = await getDirectChat(user.id, otherUserId);
            if (!chat) {
                const result = await dbRun(`INSERT INTO chats (type, title) VALUES ('direct', 'Личный чат')`);
                await dbRun(`INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)`, [result.lastID, user.id, result.lastID, otherUserId]);
                chat = await dbGet(`SELECT * FROM chats WHERE id = ?`, [result.lastID]);
            }
            res.json({ chat: await formatChat(chat, user.id) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/social/chats/:id/messages', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const chat = await dbGet(`SELECT * FROM chats WHERE id = ?`, [req.params.id]);
            if (!chat) return res.status(404).json({ error: 'Чат не найден' });
            if (chat.type === 'direct') {
                const member = await dbGet(`SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?`, [chat.id, user.id]);
                if (!member) return res.status(403).json({ error: 'Нет доступа' });
            }

            res.json({ chat: await formatChat(chat, user.id), messages: await listChatMessages(chat.id, user.id) });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/social/chats/:id/messages', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const chat = await dbGet(`SELECT * FROM chats WHERE id = ?`, [req.params.id]);
            if (!chat) return res.status(404).json({ error: 'Чат не найден' });
            if (chat.type === 'direct') {
                const member = await dbGet(`SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?`, [chat.id, user.id]);
                if (!member) return res.status(403).json({ error: 'Нет доступа' });
            }

            const text = String(req.body.text || '').trim().slice(0, 2000);
            const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 4) : [];
            if (!text && !images.length) return res.status(400).json({ error: 'Сообщение пустое' });

            const result = await dbRun(`INSERT INTO chat_messages (chat_id, user_id, text) VALUES (?, ?, ?)`, [chat.id, user.id, text]);
            for (let i = 0; i < images.length; i += 1) {
                await dbRun(`INSERT INTO chat_message_images (message_id, image_url, order_index) VALUES (?, ?, ?)`, [result.lastID, images[i], i]);
            }
            await dbRun(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`, [chat.id]);

            if (chat.type === 'direct') {
                const recipients = await dbAll(`SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?`, [chat.id, user.id]);
                for (const recipient of recipients) {
                    await createNotification({
                        userId: recipient.user_id,
                        actorId: user.id,
                        type: 'message',
                        body: `${user.name} написал вам сообщение`,
                        entityType: 'chat',
                        entityId: chat.id
                    });
                }
            }

            res.json({ success: true, messageId: result.lastID });
        } catch {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });
};
