(function () {
    const headerHtml = `
<header class="header">
    <div class="header-container">
        <div class="header-top">
            <div class="logo-area">
                <div class="logo" onclick="window.location.href='/'">СОЗВЕЗДИЕ</div>
                <button class="menu-btn-black" id="menuToggleBtn" type="button">Меню</button>
            </div>
            <div class="search-wrapper">
                <input type="text" class="search-input" placeholder="Найти отряд по названию">
            </div>
            <div class="header-actions" id="headerActions">
                <button class="pick-header-btn" id="pickHeaderBtn" type="button">Подобрать отряд</button>
                <div id="authButtons">
                    <button class="login-header-btn" id="loginHeaderBtn" type="button">Войти</button>
                </div>
                <div id="userProfile" style="display:none;">
                    <span class="user-name" id="userNameDisplay"></span>
                </div>
            </div>
        </div>
        <div class="header-bottom">
            <div class="bottom-nav">
                <span onclick="window.location.href='/about.html'">О нас</span>
                <span onclick="window.location.href='/'">Направления</span>
                <span onclick="window.location.href='/'">Отряды</span>
                <span onclick="window.location.href='/'">Создавай</span>
                <span onclick="window.location.href='/'">Интерактивы</span>
                <span onclick="window.location.href='/about.html#contacts'">Контакты</span>
            </div>
        </div>
    </div>
</header>
<div class="mobile-menu-drop" id="mobileMenuDrop">
    <span onclick="window.location.href='/about.html'">О нас</span>
    <span onclick="window.location.href='/'">Направления</span>
    <span onclick="window.location.href='/'">Отряды</span>
    <span onclick="window.location.href='/'">Создавай</span>
    <span onclick="window.location.href='/'">Интерактивы</span>
    <span onclick="window.location.href='/about.html#contacts'">Контакты</span>
</div>`;

    const footerHtml = `
<footer class="site-footer">
    <button class="footer-pick-btn" id="footerPickBtn" type="button">Подобрать отряд</button>
    <div class="footer-inner">
        <div class="footer-main">
            <div class="footer-brand">
                <h4>СОЗВЕЗДИЕ</h4>
                <a href="/about.html">О нас</a>
                <a href="/about.html#contacts">Контакты</a>
            </div>
            <div class="footer-squads">
                <h4>Отряды</h4>
                <a href="/squad/apelsin">СПО “Апельсин”</a>
                <a href="/squad/yamaika">СПО “Ямайка”</a>
                <a href="/squad/prospekt">СПО “Проспект”</a>
                <a href="/squad/zhar-ptitsa">СПО “Жар-Птица”</a>
                <a href="/squad/shum">СПО “Шум”</a>
                <a href="/squad/krylya">СПО “Крылья”</a>
                <a href="/squad/vokrug-sveta">СОП “Вокруг Света”</a>
                <a href="/squad/femida">ТОП “Фемида”</a>
                <a href="/squad/klever">ТОП “Клевер”</a>
                <a href="/squad/everest">ТОП “Эверест”</a>
                <a href="/squad/kraski">ТОП “Краски”</a>
            </div>
            <div class="footer-social">
                <h4>Социальные сети</h4>
                <div class="footer-social-icons">
                    <a href="#" aria-label="VK"><i class="fab fa-vk"></i></a>
                    <a href="#" aria-label="Telegram"><i class="fab fa-telegram-plane"></i></a>
                </div>
            </div>
            <div class="footer-cards">
                <div class="footer-card footer-survey-card">
                    <h4>Ответьте на несколько вопросов</h4>
                    <p>Предложим отряд по вашим интересам</p>
                    <button type="button" onclick="window.location.href='/test.html'">Начать опрос</button>
                </div>
                <div class="footer-card footer-contact-card">
                    <div class="footer-contact-images">
                        <img src="/images/footer-staff-logo.png" alt="Созвездие">
                        <img src="/images/footer-qr.png" alt="QR-код">
                    </div>
                    <p>По любым вопросам обращаться к командиру штаба - Пашкевичус Виктории</p>
                </div>
            </div>
        </div>
        <div class="footer-legal">
            <div>© Созвездие, 2009–2026</div>
            <a href="#">Политика обработки<br>персональных данных</a>
            <div>Внесена в реестр российских<br>программ: запись №15676 от 25.11.2022 года</div>
            <div class="footer-legal-logos">
                <img src="/images/footer-bottom-logo-1.png" alt="">
                <img src="/images/footer-bottom-logo-2.png" alt="">
            </div>
        </div>
    </div>
</footer>`;

    function initLayout() {
        if (document.body.dataset.commonLayoutApplied === 'true') return;
        document.body.dataset.commonLayoutApplied = 'true';

        const oldMobileMenu = document.getElementById('mobileMenuDrop');
        if (oldMobileMenu) oldMobileMenu.remove();

        const oldHeader = document.querySelector('header.header');
        if (oldHeader) {
            oldHeader.insertAdjacentHTML('beforebegin', headerHtml);
            oldHeader.remove();
        } else {
            document.body.insertAdjacentHTML('afterbegin', headerHtml);
        }

        const footers = Array.from(document.querySelectorAll('footer'));
        const visibleFooter = footers.find((footer) => !footer.hidden) || footers[0];
        if (visibleFooter) {
            visibleFooter.insertAdjacentHTML('beforebegin', footerHtml);
            footers.forEach((footer) => footer.remove());
        } else {
            document.body.insertAdjacentHTML('beforeend', footerHtml);
        }

        document.body.classList.add('common-layout-ready');

        document.getElementById('pickHeaderBtn')?.addEventListener('click', () => {
            window.location.href = '/test.html';
        });

        document.getElementById('footerPickBtn')?.addEventListener('click', () => {
            window.location.href = '/test.html';
        });

        document.getElementById('loginHeaderBtn')?.addEventListener('click', () => {
            window.location.href = '/register.html';
        });

        document.getElementById('userProfile')?.addEventListener('click', () => {
            window.location.href = '/profile.html';
        });

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLayout);
    } else {
        initLayout();
    }
})();
