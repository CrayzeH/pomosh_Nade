const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./soz.db');
const sharedStructureImages = {
    2: '/images/squad-structure-step-2.png',
    3: '/images/squad-structure-step-3.png'
};

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function ensureSchema() {
    await run(`
        CREATE TABLE IF NOT EXISTS squad_page_content (
            squad_id INTEGER PRIMARY KEY,
            hero_kicker TEXT,
            hero_title TEXT NOT NULL,
            hero_image TEXT NOT NULL,
            hero_image_alt TEXT,
            hero_bullets TEXT NOT NULL,
            achievement_primary_text TEXT NOT NULL,
            achievement_secondary_text TEXT NOT NULL,
            trust_title TEXT NOT NULL,
            trust_primary_bg_image TEXT,
            cta_title TEXT NOT NULL,
            cta_subtitle TEXT NOT NULL,
            path_title TEXT NOT NULL,
            guide_title TEXT NOT NULL,
            structure_title TEXT NOT NULL,
            primary_color TEXT NOT NULL DEFAULT '#2f9717',
            dark_color TEXT NOT NULL DEFAULT '#236f12',
            soft_color TEXT NOT NULL DEFAULT '#83de66',
            light_color TEXT NOT NULL DEFAULT '#efe4ff',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (squad_id) REFERENCES squads(id)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS squad_page_trust_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            color_role TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (squad_id) REFERENCES squads(id)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS squad_page_structure_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            image TEXT,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (squad_id) REFERENCES squads(id)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS squad_page_team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            body TEXT NOT NULL,
            image TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (squad_id) REFERENCES squads(id)
        )
    `);
}

async function ensureSquad(shortName, data) {
    const existing = await get('SELECT id FROM squads WHERE short_name = ?', [shortName]);
    if (existing) {
        await run(
            `UPDATE squads
             SET name = ?, title = ?, description = ?, icon = ?, color_primary = ?, order_index = ?, is_active = 1
             WHERE id = ?`,
            [data.name, data.title, data.description, data.icon, data.color, data.orderIndex, existing.id]
        );
        return existing.id;
    }

    const inserted = await run(
        `INSERT INTO squads (name, short_name, title, description, icon, color_primary, order_index, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [data.name, shortName, data.title, data.description, data.icon, data.color, data.orderIndex]
    );
    return inserted.lastID;
}

async function seedPage(squadId, page) {
    await run(
        `INSERT OR REPLACE INTO squad_page_content (
            squad_id, hero_kicker, hero_title, hero_image, hero_image_alt, hero_bullets,
            achievement_primary_text, achievement_secondary_text, trust_title, trust_primary_bg_image,
            cta_title, cta_subtitle, path_title, guide_title, structure_title,
            primary_color, dark_color, soft_color, light_color, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            squadId,
            page.heroKicker,
            page.heroTitle,
            page.heroImage,
            page.heroImageAlt,
            JSON.stringify(page.heroBullets),
            page.achievementPrimaryText,
            page.achievementSecondaryText,
            page.trustTitle,
            page.trustPrimaryBgImage,
            page.ctaTitle,
            page.ctaSubtitle,
            page.pathTitle,
            page.guideTitle,
            page.structureTitle,
            page.colors.primary,
            page.colors.dark,
            page.colors.soft,
            page.colors.light
        ]
    );

    await run('DELETE FROM squad_page_trust_cards WHERE squad_id = ?', [squadId]);
    for (const [index, card] of page.trustCards.entries()) {
        await run(
            `INSERT INTO squad_page_trust_cards (squad_id, title, body, color_role, order_index)
             VALUES (?, ?, ?, ?, ?)`,
            [squadId, card.title, card.body, card.colorRole, index + 1]
        );
    }

    await run('DELETE FROM squad_page_structure_steps WHERE squad_id = ?', [squadId]);
    for (const [index, step] of page.structureSteps.entries()) {
        const orderIndex = index + 1;
        await run(
            `INSERT INTO squad_page_structure_steps (squad_id, title, body, image, order_index)
             VALUES (?, ?, ?, ?, ?)`,
            [squadId, step.title, step.body, step.image || sharedStructureImages[orderIndex] || null, orderIndex]
        );
    }

    await run('DELETE FROM squad_page_team_members WHERE squad_id = ?', [squadId]);
    for (const [index, member] of page.team.entries()) {
        await run(
            `INSERT INTO squad_page_team_members (squad_id, role, name, body, image, order_index, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [squadId, member.role, member.name, member.body, member.image, index + 1]
        );
    }
}

const commonGuideTitle = 'Пошаговое руководство «Как провести лучшее лето»';
const commonPathTitle = 'ТВОЙ ПУТЬ В ОТРЯД — ПОНЯТНЫЙ И ПРОСТОЙ АНАЛОГ ПЕРВОЙ РАБОТЫ';

const pages = {
    klever: {
        squad: {
            name: 'ТОП «Клевер»',
            title: 'Трудовой отряд подростков «Клевер»',
            description: 'Работа, наставники, друзья и яркая атмосфера РСО.',
            icon: '🍀',
            color: '#2f9717',
            orderIndex: 8
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ОТРЯД ТВОЕГО ЛЕТА —\nТОП «КЛЕВЕР»',
            heroImage: '/images/squad-klever-hero.png',
            heroImageAlt: 'Боец отряда Клевер',
            heroBullets: [
                'Трудоустройство в лучших лагерях и организациях области',
                'Твоя первая зарплата и официальный трудовой стаж',
                'Опытные наставники, которые всегда поддержат и научат',
                'Яркие фестивали, новые друзья и незабываемая атмосфера РСО'
            ],
            achievementPrimaryText: 'Более 12 побед в конкурсах и фестивалях — мы знаем, как быть лучшими!',
            achievementSecondaryText: '3 место в рейтинге отрядов области — нам доверяют свое лето!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-klever-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'КАК ВСЁ УСТРОЕНО В «КЛЕВЕРЕ»',
            colors: {
                primary: '#2f9717',
                dark: '#236f12',
                soft: '#83de66',
                light: '#efe4ff'
            },
            trustCards: [
                {
                    title: 'Сильное наставничество',
                    body: 'Только опытные бойцы с многолетним стажем становятся кураторами новичков. Мы гарантируем поддержку на каждом этапе — от первой спевки до конца трудового сезона.',
                    colorRole: 'main'
                },
                {
                    title: 'Обучение и мягкие навыки',
                    body: 'Ты пройдешь качественную подготовку перед выездом: научишься работать в команде, решать конфликты и организовывать мероприятия. Это база, которая пригодится в любой профессии.',
                    colorRole: 'wide'
                },
                {
                    title: 'Официальный стаж',
                    body: 'Мы обеспечиваем реальное трудоустройство. Твоя работа в отряде — это не просто запись в волонтерской книжке, а твой первый официальный профессиональный опыт.',
                    colorRole: 'blue'
                },
                {
                    title: 'Друзья и общение',
                    body: '«Клевер» — это больше, чем работа. Это выезды, гитара у костра, общие праздники и люди, которые станут твоей второй семьей по всей области.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Забота о каждом',
                    body: 'Мы всегда на связи с кандидатами и их родителями. Помогаем с документами, следим за безопасностью на объектах и создаем комфортную среду для роста.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Стань новичком онлайн',
                    body: 'Заполни анкету в группе ВК или на сайте. Мы свяжемся с тобой, добавим в общий чат и расскажем о ближайшем собрании.',
                    image: '/images/squad-klever-structure-1.png'
                },
                {
                    title: 'Школа вожатых и тренинги',
                    body: 'Тебя ждут лекции, мастер-классы и игры от наших опытных бойцов. Мы научим тебя всему: от техники безопасности до основ педагогики. Выбирай формат по душе и готовься к самому яркому лету.',
                    image: '/images/squad-structure-step-2.png'
                },
                {
                    title: 'Твоя первая целина',
                    body: 'Выезжай на трудовой объект в составе команды. Работа под присмотром наставников, вечерние огоньки и творческие фестивали. Весь процесс прозрачен: ты точно знаешь свои задачи и размер будущей выплаты.',
                    image: '/images/squad-structure-step-3.png'
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/com-clover1.png',
                    name: 'Решаев Влад',
                    body: '6 лет в РСО — знает движение изнутри как никто другой. Бережно доведет новичков до победы в конкурсах.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/com-clover2.png',
                    name: 'Милана Солдатова',
                    body: '5 лет в РСО прошла путь от новичка до комиссара. Поможет раскрыться каждому бойцу.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-klever-team-3.png',
                    name: 'Арина Клименко',
                    body: '4 года в РСО знает все тонкости отрядной жизни. 6 лагерей, где создавала программы и учила вожатых. 30+ методичек написала для бойцов и командиров.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-klever-team-4.png',
                    name: 'Настя Устименко',
                    body: '3 года в РСО начала с фотографий, стала голосом отряда. 500+ фото сделала на сменах и мероприятиях. 50+ постов написала для соцсетей «Клевера».'
                }
            ]
        }
    },
    apelsin: {
        squad: {
            name: 'СПО «Апельсин»',
            title: 'Студенческий педагогический отряд «Апельсин»',
            description: 'Вожатский опыт, работа с детьми, друзья на все лето и педагогическая практика.',
            icon: '🍊',
            color: '#ff7a00',
            orderIndex: 1
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'Стань бойцом СПО\n“Апельсин”',
            heroImage: '/images/squad-apelsin-hero.png',
            heroImageAlt: 'Бойцы отряда Апельсин',
            heroBullets: [
                'Хочешь научиться работать с детьми, получить вожатский опыт, найти друзей на всё лето и заработать?',
                '«Апельсин» ждёт тех, кто готов дарить тепло и улыбки. Заполни форму — и стань частью нашей большой педагогической семьи!'
            ],
            achievementPrimaryText: 'Каждый 3-й вожатый в России — бывший боец педотряда',
            achievementSecondaryText: '37 000 вакансий для педагогов в России',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-apelsin-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'КАК ВСЁ УСТРОЕНО В «АПЕЛЬСИНЕ»',
            colors: {
                primary: '#ff7a00',
                dark: '#b84f00',
                soft: '#ffb35c',
                light: '#fff0df'
            },
            trustCards: [
                {
                    title: 'Старт педагогической карьеры',
                    body: 'Мы даем реальную практику работы с детьми разных возрастов. Это идеальная площадка для студентов педвузов и тех, кто хочет развить лидерские качества и стрессоустойчивость.',
                    colorRole: 'main'
                },
                {
                    title: 'Бесконечный креатив',
                    body: 'В «Апельсине» ты научишься ставить танцы, писать сценарии и проводить игры, от которых дети будут в восторге. Мы раскрываем таланты, о которых ты даже не подозревал.',
                    colorRole: 'wide'
                },
                {
                    title: 'Путешествия по лагерям',
                    body: 'Наши бойцы работают в лучших оздоровительных лагерях региона и страны. Каждое лето — это новая локация, свежий воздух и полное погружение в атмосферу детства.',
                    colorRole: 'blue'
                },
                {
                    title: 'Самое теплое сообщество',
                    body: 'Мы не просто работаем вместе, мы создаем «апельсиновое» настроение. Наши спевки, комиссарские часы и традиции делают нас одной из самых дружных команд в штабе.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Навыки на всю жизнь',
                    body: 'Умение находить общий язык с кем угодно, работать в режиме многозадачности и нести ответственность — это те “мягкие навыки”, которые сделают тебя востребованным в любой сфере.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Стань частью «Апельсина» онлайн',
                    body: 'Просто заполни анкету — мы сразу добавим тебя в чат новичков. У нас нет жестких отборов, мы всегда рады тем, кто готов дарить тепло и улыбки детям.',
                    image: '/images/squad-apelsin-structure-1.png'
                },
                {
                    title: 'Прокачай вожатские скиллы',
                    body: 'В нашей школе тебя ждут не скучные лекции, а практикумы с наставниками и разборы реальных ситуаций из лагерной жизни. Выбирай удобный формат: слушай теорию или сразу переходи к игротехнике и мастер-классам.',
                    image: null
                },
                {
                    title: 'Твоя идеальная целина',
                    body: 'После теории тебя ждет настоящая практика в лучших лагерях. Ты выедешь на смену с поддержкой опытных методистов, которые помогут разрулить любой кейс и сделать отдых детей незабываемым.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-apelsin-team-1.png',
                    name: 'Арина Богрякова',
                    body: 'Твой главный наставник и лидер отряда. Арина прошла путь от бойца до командира, знает всё о педагогике и организации идеальной смены.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-apelsin-team-2.png',
                    name: 'Евангелина Цицер',
                    body: 'Сердце и душа «Апельсина». Ева отвечает за то самое «оранжевое» настроение, творческие фестивали и самые душевные спевки у костра.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-apelsin-team-3.png',
                    name: 'Альфия Хусаинова',
                    body: 'Твой проводник в мир профессионального вожатства. Альфия контролирует качество обучения в школе вожатых.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-apelsin-team-4.png',
                    name: 'Руфина Абдуллина',
                    body: 'Творец медиа-истории нашего отряда. Руфина ловит самые яркие моменты в объектив, ведет наши соцсети и делает так, чтобы об «Апельсине» знал весь регион.'
                }
            ]
        }
    },
    krylya: {
        squad: {
            name: 'СПО «Крылья»',
            title: 'Студенческий педагогический отряд «Крылья»',
            description: 'Вожатское мастерство, практика с детьми и команда, которая учит взлетать.',
            icon: '🪽',
            color: '#1f43c8',
            orderIndex: 4
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'СПО «КРЫЛЬЯ» —\nУЧИМ ВЗЛЕТАТЬ',
            heroImage: '/images/squad-krylya-hero.png',
            heroImageAlt: 'Бойцы отряда Крылья',
            heroBullets: [
                'Обучение на практике: ведем игры, проводим мероприятия и работаем с детьми с первого выезда',
                'Программа, разработанная совместно с опытными вожатыми и методистами РСО',
                'Анализ твоих сильных сторон и персональный план роста в отряде'
            ],
            achievementPrimaryText: '100% наших выпускников становятся топовыми вожатыми.',
            achievementSecondaryText: 'Более 10 лет создаем историю успешных вожатых штаба «Созвездие».',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-krylya-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'Как устроена жизнь в «Крыльях»',
            colors: {
                primary: '#1f43c8',
                dark: '#10256f',
                soft: '#7f98f0',
                light: '#e9edff'
            },
            trustCards: [
                {
                    title: 'Интеллектуальный багаж',
                    body: 'Мы не просто учим играм, мы даем знания по возрастной психологии и конфликтологии, которые реально пригодятся в жизни и карьере.',
                    colorRole: 'main'
                },
                {
                    title: 'Пространство для творчества',
                    body: 'В «Крыльях» нет рамок. Хочешь запустить медиа-центр или создать свой театр в лагере? Мы дадим ресурсы и команду.',
                    colorRole: 'wide'
                },
                {
                    title: 'Социальный лифт',
                    body: 'Быть в «Крыльях» — значит иметь доступ к закрытому комьюнити успешных студентов и экспертов региона, готовых делиться связями.',
                    colorRole: 'blue'
                },
                {
                    title: 'Энергия перемен',
                    body: 'Каждая смена с нами — это не рутина, а полноценное приключение с продуманным сюжетом, где ты — главный герой.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Надежное плечо',
                    body: 'Мы выстроили систему поддержки так, чтобы даже в самый сложный день на смене ты чувствовал: за тобой стоит вся мощь отряда.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Твой пропуск в команду',
                    body: 'Заполнение анкеты — это твой посадочный талон. Мы быстро обработаем заявку, познакомим с командиром и добавим в чат, где уже кипит жизнь.',
                    image: '/images/squad-krylya-structure-1.png'
                },
                {
                    title: 'Предполетная подготовка',
                    body: 'Школа вожатского мастерства в «Крыльях» — это драйвовые воркшопы, деловые игры и реальные кейсы. Мы готовим профи, которые справятся с любой внештатной ситуацией.',
                    image: null
                },
                {
                    title: 'Свободный полет на целине',
                    body: 'Самый важный этап — работа в лагере. Ты берешь на себя ответственность, растешь над собой и понимаешь, что твои возможности безграничны.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-krylya-team-1.png',
                    name: 'Ян Самойлов',
                    body: 'Твой главный стратег и опора. Отвечает за общую дисциплину, координацию выездов и безопасность каждого бойца в сезоне.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-krylya-team-2.png',
                    name: 'Полина Плужникова',
                    body: 'Душа отряда и хранитель его традиций. Мастер по созданию атмосферы: отвечает за творчество, спевки и боевой дух.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-krylya-team-3.png',
                    name: 'Карина Хусаинова',
                    body: 'Твой проводник в мир профессиональной педагогики. Помогает освоить вожатское мастерство, курирует подготовку к сменам.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-krylya-team-4.png',
                    name: 'Дарья Подымова',
                    body: 'Главный по медиа и контенту. Ловит лучшие моменты твоей жизни в объектив, ведет соцсети отряда.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-krylya-team-5.png',
                    name: 'Екатерина Федотова',
                    body: 'Человек за объективом и лентой: сохраняет лучшие моменты твоей жизни и показывает жизнь отряда в соцсетях.'
                }
            ]
        }
    },
    'vokrug-sveta': {
        squad: {
            name: 'СОП «Вокруг Света»',
            title: 'Студенческий отряд проводников «Вокруг Света»',
            description: 'Команда для тех, кто хочет путешествовать, работать в дороге и открывать страну.',
            icon: '🚆',
            color: '#2f3a63',
            orderIndex: 3
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ОТКРОЙ ПРОСТОРЫ СТРАНЫ С\nОТРЯДОМ «ВОКРУГ СВЕТА»',
            heroImage: '/images/squad-vokrug-sveta-hero.png',
            heroImageAlt: 'Боец отряда Вокруг Света',
            heroBullets: [
                'Путешествуй по самым живописным маршрутам России в составе поездных бригад',
                'Получи востребованную специальность и свидетельство государственного образца',
                'Научись мастерски находить общий язык с пассажирами в любых дорожных ситуациях'
            ],
            achievementPrimaryText: 'Десятки тысяч пройденных километров и бесконечная романтика железных дорог!',
            achievementSecondaryText: 'Гарантированные выплаты и полное обеспечение форменной одеждой!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-vokrug-sveta-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ВОКРУГ СВЕТА»',
            colors: {
                primary: '#2f3a63',
                dark: '#202847',
                soft: '#46527d',
                light: '#e9ecf6'
            },
            trustCards: [
                {
                    title: 'География открытий',
                    body: 'Мы не стоим на месте. Работа в нашем отряде — это шанс увидеть всю страну, от крупных мегаполисов до уютных станций в глубинке.',
                    colorRole: 'main'
                },
                {
                    title: 'Закалка ответственности',
                    body: 'Ты станешь хозяином своего вагона, научишься обеспечивать комфорт пассажиров и следить за безупречным порядком в пути.',
                    colorRole: 'wide'
                },
                {
                    title: 'Единство в дороге',
                    body: 'В рейсе напарник становится твоей главной опорой. Мы строим коллектив, где выручка и доверие стоят на первом месте.',
                    colorRole: 'blue'
                },
                {
                    title: 'Бесценный жизненный опыт',
                    body: 'Умение общаться, сохранять спокойствие и быстро действовать — эти качества сделают тебя успешным в любом деле.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Незабываемые традиции',
                    body: 'Мы бережно храним наши обычаи, песни под стук колес и радость встреч после долгих поездок.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Станция отправления — подача заявки',
                    body: 'Заполняй анкету и приходи на встречу с лидерами отряда. Мы расскажем о рейсах, условиях труда и наших будущих маршрутах.',
                    image: '/images/squad-vokrug-sveta-structure-1.png'
                },
                {
                    title: 'Подготовка состава — обучение',
                    body: 'Пройди специальный курс подготовки проводников. Мы дадим тебе все необходимые знания по сервису и безопасности на железной дороге.',
                    image: null
                },
                {
                    title: 'Полный вперед — трудовой сезон',
                    body: 'Твои первые рейсы в составе сплоченной команды. Работай, узнавай страну, зарабатывай и наполняй свое лето яркими впечатлениями.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-vokrug-sveta-team-1.png',
                    name: 'Юлия Фролова',
                    body: 'Юля прокладывает путь для всего отряда: она координирует распределение по составам, решает вопросы с железнодорожными депо.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-vokrug-sveta-team-2.png',
                    name: 'Элина Наготнюк',
                    body: 'Элина отвечает за то, чтобы даже на самых дальних станциях ты чувствовал связь с домом. Она организует творческие встречи между рейсами.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-vokrug-sveta-team-3.png',
                    name: 'Милана Жамбулова',
                    body: 'Милана поможет тебе безупречно сдать экзамены на право работы в вагоне. Она знает всё об устройстве поезда и правилах перевозки.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-vokrug-sveta-team-4.png',
                    name: 'Арина Черкашова',
                    body: 'Арина фиксирует магию пути: рассветы за окном, улыбки пассажиров и наши общие победы.'
                }
            ]
        }
    },
    prospekt: {
        squad: {
            name: 'СПО «Проспект»',
            title: 'Студенческий педагогический отряд «Проспект»',
            description: 'Команда для тех, кто хочет развиваться в вожатском деле и вести за собой людей.',
            icon: '🛤',
            color: '#6f9a38',
            orderIndex: 4
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ПРОЛОЖИ СВОЙ ПУТЬ К\nУСПЕХУ С СПО«ПРОСПЕКТ»',
            heroImage: '/images/squad-prospekt-hero.png',
            heroImageAlt: 'Боец отряда Проспект',
            heroBullets: [
                'Стань мастером вожатского дела в ведущих образовательных центрах',
                'Обрети уверенность в управлении коллективом и личную независимость',
                'Найди надежных соратников для покорения новых жизненных высот'
            ],
            achievementPrimaryText: 'Наши вожатые получают лучшие рекомендации от руководителей лагерей!',
            achievementSecondaryText: 'Динамичное развитие — мы ежегодно расширяем границы нашей деятельности!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-prospekt-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ПРОСПЕКТ»',
            colors: {
                primary: '#6f9a38',
                dark: '#4f7425',
                soft: '#8fb957',
                light: '#edf6df'
            },
            trustCards: [
                {
                    title: 'Широта взглядов',
                    body: 'Мы поощряем инициативу и нестандартный подход к педагогическим задачам. Здесь ты сможешь воплотить в жизнь свои самые смелые идеи.',
                    colorRole: 'main'
                },
                {
                    title: 'Школа лидерства',
                    body: 'Ты научишься брать на себя ответственность за результат, координировать работу группы и вести за собой людей.',
                    colorRole: 'wide'
                },
                {
                    title: 'Безопасный маршрут',
                    body: 'Мы обеспечиваем всестороннюю поддержку каждого бойца. Опытные наставники помогут преодолеть любые препятствия на пути.',
                    colorRole: 'blue'
                },
                {
                    title: 'Связь поколений',
                    body: 'Отряд — это мост, объединяющий опыт ветеранов и энергию новичков. Мы строим крепкое сообщество на века.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Насыщенная жизнь',
                    body: 'На «Проспекте» всегда кипит жизнь. Слеты, фестивали и душевные встречи делают наше движение по-настоящему живым.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Выход на старт — подача заявки',
                    body: 'Оставляй свои данные и приходи на первую встречу. Мы расскажем о ценностях «Проспекта» и поможем влиться в наш ритм.',
                    image: '/images/squad-prospekt-structure-1.png'
                },
                {
                    title: 'Набор скорости — обучение',
                    body: 'Тебя ждут интенсивные занятия по педагогике и психологии. Мы дадим тебе все знания, необходимые для уверенного начала пути.',
                    image: null
                },
                {
                    title: 'Прямая дорога — трудовой сезон',
                    body: 'Работа в лагере в составе сплоченной команды. Применяй умения, расти над собой и создавай счастливое будущее для детей.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-prospekt-team-1.png',
                    name: 'Катюша Кожанова',
                    body: 'Она возводит надежную опору нашего коллектива: ведет диалог с работодателями и подбирает наиболее перспективные объекты для работы.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-prospekt-team-2.png',
                    name: 'Валерия Гончарова',
                    body: 'Лера следит за тем, чтобы твое сердце горело делом. Она наполняет наши будни смыслом, песнями и событиями, которые сближают людей.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-prospekt-team-3.png',
                    name: 'Виктория Белова',
                    body: 'Вика — персональный консультант по твоему развитию. Она поможет разобраться в документах и подготовит тебя к любым педагогическим вызовам.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-prospekt-team-4.png',
                    name: 'Юлия Халилова',
                    body: 'Юля видит прекрасное в каждой детали. Она фиксирует самые яркие моменты наших смен, превращая их в живую историю отряда.'
                }
            ]
        }
    },
    kraski: {
        squad: {
            name: 'ТОП «Краски»',
            title: 'Трудовой отряд подростков «Краски»',
            description: 'Команда для творческого труда, благоустройства и ярких городских объектов.',
            icon: '🎨',
            color: '#a9ece5',
            orderIndex: 10
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ДОБАВЬ ЯРКИХ ТОНОВ С\nОТРЯДОМ «КРАСКИ»',
            heroImage: '/images/squad-kraski-hero.png',
            heroImageAlt: 'Бойцы отряда Краски',
            heroBullets: [
                'Создавай реальные объекты и преображай пространство вокруг себя',
                'Освой основы ландшафтного дела и декоративного мастерства',
                'Зарабатывай честным трудом в кругу самых творческих подростков региона'
            ],
            achievementPrimaryText: 'Более 50 преображенных городских объектов на счету наших бойцов!',
            achievementSecondaryText: 'Официальная запись в трудовой книжке уже с 14 лет!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-kraski-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «КРАСКИ»',
            colors: {
                primary: '#a9ece5',
                dark: '#65cfc4',
                soft: '#c9fff9',
                light: '#e9fffc'
            },
            trustCards: [
                {
                    title: 'Эстетика труда',
                    body: 'Мы учим видеть прекрасное в любом деле. Твоя работа станет не просто задачей, а вкладом в красоту и уют родного края.',
                    colorRole: 'main'
                },
                {
                    title: 'Полезный опыт',
                    body: 'Ты получишь практические навыки, которые останутся с тобой навсегда: от работы с материалами до проектирования зон отдыха.',
                    colorRole: 'wide'
                },
                {
                    title: 'Безопасный старт',
                    body: 'Мы гарантируем соблюдение трудового права и заботливое сопровождение наставников на каждом этапе пути.',
                    colorRole: 'blue'
                },
                {
                    title: 'Единство в творчестве',
                    body: 'Наш отряд — это созвездие личностей. Мы дополняем друг друга, как цвета в радуге, создавая неповторимый коллектив.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Яркие перспективы',
                    body: 'Опыт в нашем отряде — это первая ступень к успешной карьере и признанию в молодежном движении.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Выбор цвета — регистрация',
                    body: 'Заполни анкету и мы познакомим тебя с отрядом и поможем выбрать дело по душе.',
                    image: '/images/squad-kraski-structure-1.png'
                },
                {
                    title: 'Подготовка холста — обучение',
                    body: 'Тебя ждут увлекательные мастер-классы и инструктажи. Мы научим тебя работать профессионально и безопасно.',
                    image: null
                },
                {
                    title: 'Время творить — целина',
                    body: 'Выход на трудовой объект. Честный труд, первая зарплата и море драйва в компании настоящих друзей.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-kraski-team-1.png',
                    name: 'Полина Богатырева',
                    body: 'Она выстраивает фундамент нашего отряда: ведёт переговоры с работодателями, находит самые интересные объекты.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-kraski-team-2.png',
                    name: 'Дарья Батракова',
                    body: 'Даша отвечает за то, чтобы после работы у тебя оставались силы на улыбку. Она наполняет наши будни событиями, песнями.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-kraski-team-3.png',
                    name: 'Зарина Ярмухаметова',
                    body: 'Зарина — это твой личный гид по документам и профессиональному росту.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-kraski-team-4.png',
                    name: 'Мария Ризик',
                    body: 'Маша видит красоту в каждом движении. Она ловит самые живые эмоции на объектах, создавая историю «Красок»'
                }
            ]
        }
    },
    'zhar-ptitsa': {
        squad: {
            name: 'СПО «Жар-Птица»',
            title: 'Студенческий педагогический отряд «Жар-Птица»',
            description: 'Команда для тех, кто хочет дарить детям яркое лето и расти в педагогике.',
            icon: '🔥',
            color: '#f51b25',
            orderIndex: 5
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ЗАЖГИ СВОЕ ЛЕТО\nС СПО «ЖАР-ПТИЦА»',
            heroImage: '/images/squad-zhar-ptitsa-hero.png',
            heroImageAlt: 'Бойцы отряда Жар-Птица',
            heroBullets: [
                'Освой вожатское мастерство и стань проводником в мир знаний',
                'Найди команду, где поддержка и творчество помогают раскрыть крылья',
                'Проведи незабываемое лето с детьми, песнями и настоящей отрядной атмосферой'
            ],
            achievementPrimaryText: 'Яркие смены, душевные встречи и сотни детских улыбок — наша главная награда!',
            achievementSecondaryText: 'Опытные наставники помогут сделать первый шаг в педагогике уверенно и безопасно!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-zhar-ptitsa-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ЖАР-ПТИЦА»',
            colors: {
                primary: '#f51b25',
                dark: '#c80f18',
                soft: '#ff3c45',
                light: '#ffe3e5'
            },
            trustCards: [
                {
                    title: 'Огонь вдохновения',
                    body: 'Мы научим тебя гореть своим делом, не выгорая. Твоя энергия станет главным инструментом в создании незабываемого отдыха для ребят.',
                    colorRole: 'main'
                },
                {
                    title: 'Магия общения',
                    body: 'Ты освоишь тонкое искусство находить общий язык с каждым ребенком, становясь для него настоящим проводником в мир знаний.',
                    colorRole: 'wide'
                },
                {
                    title: 'Крепкое крыло',
                    body: 'В нашем коллективе ты всегда найдешь поддержку. Опытные наставники помогут расправить крылья и уверенно войти в профессию.',
                    colorRole: 'blue'
                },
                {
                    title: 'Светлые перспективы',
                    body: 'Опыт работы в «Жар-птице» станет твоим ярким преимуществом в педагогической деятельности и за её пределами.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Сказочное единство',
                    body: 'Мы бережем атмосферу уюта и взаимовыручки. Наши встречи — это всегда тепло, песни и искренние разговоры.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Рождение искры — заявка',
                    body: 'Оставляй заявку и приходи на наши душевные встречи. Мы познакомим тебя с историей «Жар-птицы» и поможем сделать первый шаг в педагогику.',
                    image: '/images/squad-zhar-ptitsa-structure-1.png'
                },
                {
                    title: 'Закалка пламени — подготовка',
                    body: 'Тебя ждет увлекательный курс вожатского мастерства. Мы научим тебя игротехнике, психологии и основам безопасности в детском лагере.',
                    image: null
                },
                {
                    title: 'Яркий полет — целина',
                    body: 'Твое первое лето в роли вожатого. Применяй знания, дари тепло своего сердца детям и возвращайся домой с багажом бесценных воспоминаний.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-zhar-ptitsa-team-1.png',
                    name: 'Наталья Шимолина',
                    body: 'Главный стратег и защитник отряда. Наталья выстраивает надежный фундамент для нашей работы, берет на себя все переговоры.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-zhar-ptitsa-team-2.png',
                    name: 'Ева Мишакова',
                    body: 'Создает неповторимую атмосферу внутри коллектива. Ева превращает обычные будни в праздник.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-zhar-ptitsa-team-3.png',
                    name: 'Дарья Алексеева',
                    body: 'Твой личный проводник в мир педагогического мастерства. Анель помогает отточить навыки работы с детьми, делится секретными методиками.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-zhar-ptitsa-team-4.png',
                    name: 'Ангелина Дудка',
                    body: 'Главный летописец нашего сияния. Она создает живую и яркую историю отряда в медиапространстве, подмечая все детали и эмоции.'
                }
            ]
        }
    },
    yamaika: {
        squad: {
            name: 'СПО «Ямайка»',
            title: 'Студенческий педагогический отряд «Ямайка»',
            description: 'Команда для тех, кто хочет работать с детьми, развиваться в педагогике и быть частью дружного сообщества.',
            icon: '🌴',
            color: '#f4d248',
            orderIndex: 6
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ПОЙМАЙ ВОЛНУ С\nОТРЯДОМ «ЯМАЙКА»',
            heroImage: '/images/squad-yamaika-hero.png',
            heroImageAlt: 'Бойцы отряда Ямайка',
            heroBullets: [
                'Глубокое изучение психологии общения и основ воспитания',
                'Участие в масштабных творческих смотрах и песенных кругах',
                'Шанс проявить себя в роли лидера и наставника для молодежи'
            ],
            achievementPrimaryText: '100% искренних детских улыбок — наша главная награда за труд!',
            achievementSecondaryText: 'Пятерка лучших педагогических коллективов по итогам прошлого года!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-yamaika-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ЯМАЙКА»',
            colors: {
                primary: '#f4d248',
                dark: '#c9a816',
                soft: '#ffe681',
                light: '#fff7d5'
            },
            trustCards: [
                {
                    title: 'Мастерство игры',
                    body: 'Мы научим тебя сотням способов занять коллектив, от подвижных забав на воздухе до вдумчивых вечерних бесед.',
                    colorRole: 'main'
                },
                {
                    title: 'Школа выдержки',
                    body: 'Ты обретешь железное спокойствие и научишься находить выход из любой непредвиденной ситуации.',
                    colorRole: 'wide'
                },
                {
                    title: 'Душевное единство',
                    body: 'В «Ямайке» каждый важен. Мы строим отношения на доверии, взаимной выручке и общем деле.',
                    colorRole: 'blue'
                },
                {
                    title: 'Профессиональный рост',
                    body: 'Навыки, полученные у нас, станут отличным фундаментом для твоей будущей карьеры в любой области.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Культурный обмен',
                    body: 'Мы бережно храним традиции штаба и создаем новые, которые объединяют поколения бойцов.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Первое знакомство',
                    body: 'Оставляй заявку и приходи на наши открытые встречи. Мы познакомим тебя с ценностями отряда и нашей большой семьей.',
                    image: '/images/squad-yamaika-structure-1.png'
                },
                {
                    title: 'Время учебы',
                    body: 'Тебя ждут занятия по педагогике и технике безопасности. Мы передадим тебе весь накопленный опыт работы с детьми.',
                    image: null
                },
                {
                    title: 'Трудовое лето',
                    body: 'Выезд в лагерь в составе сплоченной команды. Применяй знания, твори, создавай и получай заслуженную награду за труд.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-yamaika-team-1.png',
                    name: 'Маргарита Крючкова',
                    body: 'Главный организатор, который отвечает за связь с работодателями и твое безопасное трудоустройство.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-yamaika-team-2.png',
                    name: 'Полина Кобзева',
                    body: 'Создатель крутой атмосферы внутри команды, организатор праздников и выездов в свободное от работы время.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-yamaika-team-3.png',
                    name: 'Данил Козиков',
                    body: 'Поможет правильно оформить документы и проследит, чтобы ты вовремя освоил все необходимые навыки.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-yamaika-team-4.png',
                    name: 'Лина Юлдашева',
                    body: 'Человек, который превращает события в контент: замечает главное, сохраняет лучшие моменты в кадре и оживляет наши соцсети.'
                }
            ]
        }
    },
    shum: {
        squad: {
            name: 'СПО «Шум»',
            title: 'Студенческий педагогический отряд «Шум»',
            description: 'Команда для тех, кто любит сцену, творчество и работу с детьми.',
            icon: '📣',
            color: '#8347f4',
            orderIndex: 7
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ГРОМКОЕ ЛЕТО С СПО\n«ШУМ»',
            heroImage: '/images/squad-shum-hero.png',
            heroImageAlt: 'Бойцы отряда Шум',
            heroBullets: [
                'Стань мастером публичных выступлений и научись вести за собой толпу',
                'Начни свой профессиональный путь в команде, которую слышно везде',
                'Найди единомышленников, которые разделяют твою любовь к творчеству'
            ],
            achievementPrimaryText: '100% заряда бодрости на каждую смену — мы не даем скучать ни себе, ни детям!',
            achievementSecondaryText: 'Сотни восторженных отзывов от детей и родителей за прошлый сезон!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-shum-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ШУМ»',
            colors: {
                primary: '#8347f4',
                dark: '#5c25c9',
                soft: '#a875ff',
                light: '#efe4ff'
            },
            trustCards: [
                {
                    title: 'Раскрытие талантов',
                    body: 'Мы поможем тебе найти свои сильные стороны, будь то танцы, актерское мастерство или талант организатора.',
                    colorRole: 'main'
                },
                {
                    title: 'Школа лидерства',
                    body: 'Ты научишься управлять вниманием большой аудитории и станешь тем вожатым, которого дети слушают с открытым ртом.',
                    colorRole: 'wide'
                },
                {
                    title: 'Круглосуточная поддержка',
                    body: 'В нашем отряде никто не остается один. Опытные наставники помогут советом и делом в любой ситуации на смене.',
                    colorRole: 'blue'
                },
                {
                    title: 'Полезные связи',
                    body: 'Знакомства внутри штаба помогут тебе не только летом, но и в будущей учебе или поиске основной работы.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Яркие традиции',
                    body: 'Наши песни, обряды и праздничные встречи создают ту самую атмосферу, ради которой возвращаются снова.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Вход в нашу команду',
                    body: 'Заполняй анкету и приходи на ознакомительную встречу. Мы расскажем о ценностях отряда и ответим на все твои вопросы.',
                    image: '/images/squad-shum-structure-1.png'
                },
                {
                    title: 'Интенсивная подготовка',
                    body: 'Тебя ждут увлекательные занятия по педагогике, игротехнике и технике безопасности. Мы дадим все инструменты для успешной работы.',
                    image: null
                },
                {
                    title: 'Выход на сцену — целина',
                    body: 'Поездка в лагерь в составе отряда. Применяй знания на практике, создавай счастливые воспоминания для детей и расти над собой.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-shum-team-1.png',
                    name: 'Валерия Быкова',
                    body: 'Берет на себя все юридические и организационные вопросы. Лера — тот человек, который договаривается с лучшими работодателями, следит за твоей безопасностью.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-shum-team-2.png',
                    name: 'Евангелина Разина',
                    body: 'Создает неповторимую атмосферу внутри коллектива. Ева превращает обычные будни в праздник.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-shum-team-3.png',
                    name: 'Анель Зурекеева',
                    body: 'Сопровождает тебя на пути к профессионализму. Анель поможет без стресса оформить все документы, обучит тонкостям педагогики.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-shum-team-4.png',
                    name: 'Надежда Скорнякова',
                    body: 'Пишет визуальную историю наших побед. Надя ловит самые искренние моменты в объектив.'
                }
            ]
        }
    },
    femida: {
        squad: {
            name: 'ТОП «Фемида»',
            title: 'Трудовой отряд подростков «Фемида»',
            description: 'Команда для первого официального трудового опыта, сервиса и ландшафтных работ.',
            icon: '⚖',
            color: '#7e63bd',
            orderIndex: 8
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ПЕРВАЯ РАБОТА С ТОП\n«ФЕМИДА»',
            heroImage: '/images/squad-femida-hero.png',
            heroImageAlt: 'Боец отряда Фемида',
            heroBullets: [
                'Официальное трудоустройство для подростков от 14 лет',
                'Попробуй себя в разных направлениях: от озеленения до сервиса и вожатства',
                'Стань частью сильного сообщества и найди верных друзей в штабе'
            ],
            achievementPrimaryText: 'Озеленитель может получить от 65.000 рублей за смену на целине!',
            achievementSecondaryText: 'Более 1200 вакансий открыто для наших бойцов в текущем сезоне!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-femida-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ФЕМИДА»',
            colors: {
                primary: '#7e63bd',
                dark: '#5f4699',
                soft: '#aa8cf0',
                light: '#eee6ff'
            },
            trustCards: [
                {
                    title: 'Законный доход',
                    body: 'Мы гарантируем оформление по трудовому кодексу и запись в твою первую трудовую книжку.',
                    colorRole: 'main'
                },
                {
                    title: 'Разнообразие навыков',
                    body: 'Здесь ты научишься не только работать руками, но и общаться, решать задачи в команде и брать ответственность.',
                    colorRole: 'wide'
                },
                {
                    title: 'Гибкий график',
                    body: 'Работай летом или в свободное от учебы время. Мы подберем объект, который удобно совмещать с твоими делами.',
                    colorRole: 'blue'
                },
                {
                    title: 'Личностный рост',
                    body: '«Фемида» — это школа жизни. Ты повзрослеешь, станешь самостоятельнее и увереннее в своих силах.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Поддержка наставников',
                    body: 'Тебя не оставят один на один с работой. Опытные бойцы всегда подскажут, как сделать лучше.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Подача заявки и знакомство',
                    body: 'Заполняй анкету на базе аттестата за 9 или 11 класс. Мы пригласим тебя на встречу, где расскажем о доступных вакансиях в сервисе или ландшафтных работах.',
                    image: '/images/squad-femida-structure-1.png'
                },
                {
                    title: 'Короткое обучение и инструктаж',
                    body: 'Мы научим тебя основам выбранного дела и технике безопасности. Ты узнаешь все тонкости будущей работы еще до выхода на объект.',
                    image: null
                },
                {
                    title: 'Выход на первую смену',
                    body: 'Трудись на целине вместе с отрядом. Получай реальный опыт, драйв от общения и свою первую честную зарплату.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-femida-team-1.png',
                    name: 'Анна Рябова',
                    body: 'Главный организатор, который отвечает за связь с работодателями и твое безопасное трудоустройство.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-femida-team-2.png',
                    name: 'Карина Валетова',
                    body: 'Создатель крутой атмосферы внутри команды, организатор праздников и выездов в свободное от работы время.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-femida-team-3.png',
                    name: 'Елизавета Шабанова',
                    body: 'Поможет правильно оформить документы и проследит, чтобы ты вовремя освоил все необходимые навыки.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-femida-team-4.png',
                    name: 'Роман Солопов',
                    body: 'Запечатлит твои первые трудовые успехи для истории отряда и социальных сетей.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-femida-team-5.png',
                    name: 'Настасья Березанова',
                    body: 'Запечатлит твои первые трудовые успехи для истории отряда и социальных сетей.'
                }
            ]
        }
    },
    everest: {
        squad: {
            name: 'ТОП «Эверест»',
            title: 'Трудовой отряд подростков «Эверест»',
            description: 'Команда для тех, кто готов расти, трудиться и покорять вершины.',
            icon: '🏔',
            color: '#0e244d',
            orderIndex: 9
        },
        page: {
            heroKicker: 'ТВОЙ ПРОФЕССИОНАЛИЗМ НАЧИНАЕТСЯ ЗДЕСЬ',
            heroTitle: 'ПОКОРЯЙ ВЕРШИНЫ\nС ОТРЯДОМ «ЭВЕРЕСТ»',
            heroImage: '/images/squad-everest-hero.png',
            heroImageAlt: 'Боец отряда Эверест',
            heroBullets: [
                'Получи первый серьезный опыт в строительстве, благоустройстве или сервисе',
                'Пройди путь от новичка до мастера своего дела под руководством опытных бойцов',
                'Заработай на мечту своим трудом в официальном трудовом отряде'
            ],
            achievementPrimaryText: 'Высокие показатели — наши бойцы ежегодно занимают призовые места в соревнованиях!',
            achievementSecondaryText: 'Официальный стаж — мы гарантируем соблюдение всех прав работающего подростка!',
            trustTitle: 'НАМ ДОВЕРЯЮТ, И ВОТ ПОЧЕМУ',
            trustPrimaryBgImage: '/images/squad-everest-trust-bg.png',
            ctaTitle: 'Стань частью штаба «Созвездие»',
            ctaSubtitle: 'подай заявку прямо сейчас!',
            pathTitle: commonPathTitle,
            guideTitle: commonGuideTitle,
            structureTitle: 'ТВОЙ ПУТЬ В КОМАНДЕ «ЭВЕРЕСТ»',
            colors: {
                primary: '#0e244d',
                dark: '#07142d',
                soft: '#6f86b3',
                light: '#e8eef8'
            },
            trustCards: [
                {
                    title: 'Закалка характера',
                    body: 'Мы верим, что труд делает человека сильнее. В нашем отряде ты научишься не сдаваться перед трудностями и доводить начатое до конца.',
                    colorRole: 'main'
                },
                {
                    title: 'Практические навыки',
                    body: 'Здесь ты получишь реальные умения, которые пригодятся в быту и будущей профессии: от работы с инструментом до основ управления.',
                    colorRole: 'wide'
                },
                {
                    title: 'Безопасный старт',
                    body: 'Мы тщательно следим за условиями труда и техникой безопасности. Твое здоровье и комфорт — наш главный приоритет.',
                    colorRole: 'blue'
                },
                {
                    title: 'Командный дух',
                    body: '«Эверест» — это сплоченная группа. Мы вместе преодолеваем любые препятствия, поддерживая друг друга словом и делом.',
                    colorRole: 'yellow'
                },
                {
                    title: 'Перспективы роста',
                    body: 'Мы бережно храним традиции штаба и создаем новые, которые объединяют поколения бойцов.',
                    colorRole: 'orange'
                }
            ],
            structureSteps: [
                {
                    title: 'Сбор группы у подножия',
                    body: 'Оставляй заявку и приходи на собеседование. Мы подберем для тебя подходящий вид работ и расскажем о планах отряда на сезон.',
                    image: '/images/squad-everest-structure-1.png'
                },
                {
                    title: 'Инструктаж и подготовка',
                    body: 'Мы проведем обучение основам мастерства и правилам безопасности. Ты познакомишься со своей бригадой и получишь вводные задачи.',
                    image: null
                },
                {
                    title: 'Трудовое восхождение',
                    body: 'Выход на трудовой объект. Честный труд, заслуженная зарплата и радость от выполненного дела в кругу лучших друзей.',
                    image: null
                }
            ],
            team: [
                {
                    role: 'Командир',
                    image: '/images/squad-everest-team-1.png',
                    name: 'Лена Неверова',
                    body: 'Лена Неверова — берет на себя все организационные и юридические вопросы, договаривается с лучшими работодателями.'
                },
                {
                    role: 'Комиссар',
                    image: '/images/squad-everest-team-2.png',
                    name: 'Аня Опаленик',
                    body: 'Пишет яркую историю наших побед и сохраняет самые искренние моменты с комиссарок.'
                },
                {
                    role: 'Методист',
                    image: '/images/squad-everest-team-3.png',
                    name: 'Настя Дрыганова',
                    body: 'Сопровождает тебя на пути к профессионализму, поможет оформить документы без стресса.'
                },
                {
                    role: 'Пресс-секретарь',
                    image: '/images/squad-everest-team-4.png',
                    name: 'Матвей Поваров',
                    body: 'Творец медиа-истории, ловит самые яркие моменты в объектив и ведет наши соцсети.'
                }
            ]
        }
    }
};

async function main() {
    await ensureSchema();

    for (const [shortName, entry] of Object.entries(pages)) {
        const squadId = await ensureSquad(shortName, entry.squad);
        await seedPage(squadId, entry.page);
        console.log(`Seeded ${shortName} (${squadId})`);
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        db.close();
    });
