/**
 * evolutionService.js
 * ------------------------------------------------------------------
 * Сервис «Эволюции Персонажа» — от Каменного века до Ядерной бомбы.
 *
 * Подключается в index.html ПОСЛЕ CDN @supabase/supabase-js@2.
 * Публичный API доступен через глобальный объект `window.VibeEvolution`.
 *
 * Ожидаемая схема БД:
 *
 *   users
 *     tg_id           bigint  primary key
 *     xp              int     default 0
 *     current_level   int     default 1          -> eras_config.level (FK)
 *
 *   eras_config
 *     level                 int     primary key   -- номер уровня / эпохи
 *     level_name            text                  -- 'Базовый Рекрут', 'Каменная дубинка', ...
 *     background_layer_url  text    nullable      -- задний план (танк, требушет и т.д.)
 *     base_avatar_url       text    nullable      -- базовое тело (рекрут)
 *     skin_layer_url        text    nullable      -- слой одежды / кольчуги
 *     weapon_layer_url      text    nullable      -- слой оружия
 *
 * Для работы «одним запросом» в users должен быть FK на eras_config(level):
 *   alter table users add constraint users_current_level_fkey
 *     foreign key (current_level) references eras_config(level);
 * Если FK отсутствует — сервис автоматически откатится на двухшаговый запрос.
 * ------------------------------------------------------------------
 */
(function (global) {
    'use strict';

    const SB_URL = 'https://mgdrugepjudttjxgedvp.supabase.co';
    const SB_KEY = 'sb_publishable_X_5OwtCeeKQRHa36JLJedA_qo84O6YA';

    const TABLES = {
        USERS: 'users',
        ERAS: 'eras_config',
    };

    const COLS = {
        TG_ID: 'tg_id',
        XP: 'xp',
        LEVEL: 'current_level',
        ERA_LEVEL: 'level',
        ERA_NAME: 'level_name',
        URL_BG: 'background_layer_url',
        URL_BASE: 'base_avatar_url',
        URL_SKIN: 'skin_layer_url',
        URL_WEAPON: 'weapon_layer_url',
        URL_MODEL_3D: 'model_3d_url',
    };

    // id элемента <model-viewer> в разметке (см. index.html).
    const MODEL_3D_ID = 'avatar-3d';

    /**
     * Соответствие «ключ слоя → id <img>» в вёрстке.
     * Порядок здесь же задаёт z-index через CSS (см. index.html).
     */
    const LAYERS = {
        background: 'avatar-background', // z-index: 0
        base:       'avatar-base',       // z-index: 1
        skin:       'avatar-skin',       // z-index: 2
        weapon:     'avatar-weapon',     // z-index: 3
    };

    let _client = null;

    function getClient() {
        if (global.db && typeof global.db.from === 'function') return global.db;
        if (_client) return _client;
        if (!global.supabase || typeof global.supabase.createClient !== 'function') {
            throw new Error('[VibeEvolution] Supabase JS SDK не загружен.');
        }
        _client = global.supabase.createClient(SB_URL, SB_KEY);
        return _client;
    }

    function _pickEra(eraRow) {
        if (!eraRow) return {};
        return {
            level:       eraRow[COLS.ERA_LEVEL] || null,
            era_name:    eraRow[COLS.ERA_NAME] || null,
            background:  eraRow[COLS.URL_BG]     || null,
            base:        eraRow[COLS.URL_BASE]   || null,
            skin:        eraRow[COLS.URL_SKIN]   || null,
            weapon:      eraRow[COLS.URL_WEAPON] || null,
            model_3d:    eraRow[COLS.URL_MODEL_3D] || null,
        };
    }

    /**
     * Забирает профиль пользователя и URL всех 4 визуальных слоёв ОДНИМ запросом
     * (через PostgREST embed по FK users.current_level -> eras_config.level).
     *
     * @param {number|string} tgId
     * @returns {Promise<{
     *   tg_id: number,
     *   xp: number,
     *   current_level: number,
     *   era_name: string|null,
     *   urls: { background: string|null, base: string|null, skin: string|null, weapon: string|null }
     * }>}
     */
    async function getUserEvolution(tgId) {
        if (tgId === undefined || tgId === null) {
            throw new Error('[VibeEvolution] getUserEvolution: tgId обязателен');
        }
        const db = getClient();

        const eraFields = `${COLS.ERA_LEVEL}, ${COLS.ERA_NAME}, ${COLS.URL_BG}, ${COLS.URL_BASE}, ${COLS.URL_SKIN}, ${COLS.URL_WEAPON}, ${COLS.URL_MODEL_3D}`;

        // Пытаемся получить всё одним запросом через embed.
        let userRow = null;
        let eraRow = null;
        try {
            const { data, error } = await db
                .from(TABLES.USERS)
                .select(`${COLS.TG_ID}, ${COLS.XP}, ${COLS.LEVEL}, era:${TABLES.ERAS}!${COLS.LEVEL} ( ${eraFields} )`)
                .eq(COLS.TG_ID, tgId)
                .single();
            if (error) throw error;
            userRow = data;
            eraRow = Array.isArray(data.era) ? data.era[0] : data.era;
        } catch (embedErr) {
            console.warn('[VibeEvolution] embed-join не сработал, падаем на два запроса:', embedErr && embedErr.message);
            const { data: u, error: uErr } = await db
                .from(TABLES.USERS)
                .select(`${COLS.TG_ID}, ${COLS.XP}, ${COLS.LEVEL}`)
                .eq(COLS.TG_ID, tgId)
                .single();
            if (uErr) throw uErr;
            userRow = u;

            if (u && u[COLS.LEVEL] != null) {
                const { data: e, error: eErr } = await db
                    .from(TABLES.ERAS)
                    .select(eraFields)
                    .eq(COLS.ERA_LEVEL, u[COLS.LEVEL])
                    .maybeSingle();
                if (eErr) throw eErr;
                eraRow = e;
            }
        }

        if (!userRow) throw new Error('[VibeEvolution] Пользователь не найден');

        const era = _pickEra(eraRow);

        const result = {
            tg_id: userRow[COLS.TG_ID],
            xp: userRow[COLS.XP] || 0,
            current_level: userRow[COLS.LEVEL] || 1,
            level_name: era.era_name,
            era_name: era.era_name,
            model_3d_url: era.model_3d,
            urls: {
                background: era.background,
                base:       era.base,
                skin:       era.skin,
                weapon:     era.weapon,
                model_3d:   era.model_3d,
            },
        };
        console.log('[VibeEvolution] getUserEvolution =>', result);
        return result;
    }

    /**
     * Подставляет URL каждого слоя в src соответствующего <img>
     * и переключает видимость (display: block/none) если URL пустой/NULL.
     *
     * ВАЖНО: базовый слой (`avatar-base`) — это тело персонажа. Если URL пришёл из
     * eras_config.base_avatar_url, мы ОБЯЗАНЫ проставить и src, и display:block —
     * иначе останется чёрный фон, даже если URL в базе корректный.
     *
     * @param {{background?:string|null, base?:string|null, skin?:string|null, weapon?:string|null}} urlsObj
     */
    function updateVisualLayers(urlsObj) {
        const urls = urlsObj || {};
        console.log('[VibeEvolution] updateVisualLayers urls=', urls);
        Object.keys(LAYERS).forEach(function (key) {
            const el = document.getElementById(LAYERS[key]);
            if (!el) {
                console.warn('[VibeEvolution] DOM-элемент не найден:', LAYERS[key]);
                return;
            }
            const url = urls[key];
            if (url) {
                el.src = url;
                el.style.display = 'block';
                el.style.opacity = '1';
            } else {
                el.removeAttribute('src');
                el.style.display = 'none';
            }
        });
    }

    /**
     * Прячет все 4 2D-слоя аватара (display: none). Используется, когда у эры
     * есть 3D-модель и 2D-кукла не нужна.
     */
    function _hide2DLayers() {
        Object.keys(LAYERS).forEach(function (key) {
            const layerEl = document.getElementById(LAYERS[key]);
            if (layerEl) layerEl.style.display = 'none';
        });
    }

    /**
     * Устанавливает src у <model-viewer id="avatar-3d"> на основе
     * eras_config.model_3d_url и переключает видимость 3D ↔ 2D-слоёв:
     *
     *   • modelUrl есть       → показываем #avatar-3d, прячем 2D-слои.
     *   • modelUrl пуст/NULL  → прячем #avatar-3d (display: none), 2D-слои
     *                            остаются видимыми (их уже выставил
     *                            updateVisualLayers по URL из eras_config).
     *
     * @param {string|null|undefined} modelUrl
     */
    function updateModel3D(modelUrl) {
        const el = document.getElementById(MODEL_3D_ID);
        if (!el) {
            console.warn('[VibeEvolution] <model-viewer> не найден:', MODEL_3D_ID);
            return;
        }
        if (modelUrl) {
            if (el.getAttribute('src') !== modelUrl) {
                el.setAttribute('src', modelUrl);
                console.log('[VibeEvolution] model_3d_url =>', modelUrl);
            }
            el.style.display = '';
            _hide2DLayers();
        } else {
            el.removeAttribute('src');
            el.style.display = 'none';
            console.log('[VibeEvolution] model_3d_url пуст → прячем 3D, показываем 2D-слои');
        }
    }

    /**
     * Обновляет текстовые поля XP / уровня / названия эпохи в профиле.
     * Название эпохи берём напрямую из eras_config.level_name.
     */
    function updateEvolutionText(evo) {
        if (!evo) return;
        const xpEl = document.getElementById('profile-xp-value');
        if (xpEl) xpEl.innerText = evo.xp;
        const lvlEl = document.getElementById('profile-level-value');
        if (lvlEl) lvlEl.innerText = evo.current_level;
        const eraEl = document.getElementById('profile-era-name');
        if (eraEl) {
            const text = evo.level_name || evo.era_name || ('LEVEL ' + (evo.current_level || 1));
            eraEl.innerText = text;
        }
    }

    /**
     * Полный цикл: тянем эволюцию из БД, обновляем 4 слоя и текст XP/LVL.
     * Удобный one-liner для вызова из index.html после любого изменения.
     */
    async function refreshEvolution(tgId) {
        try {
            const evo = await getUserEvolution(tgId);
            updateVisualLayers(evo.urls);
            updateModel3D(evo.model_3d_url);
            updateEvolutionText(evo);
            return evo;
        } catch (err) {
            console.error('[VibeEvolution] refreshEvolution error', err);
            return null;
        }
    }

    /**
     * DEV-хелпер: добавить delta XP пользователю в БД.
     * Возвращает обновлённую строку users.
     */
    async function addXp(tgId, delta) {
        if (tgId === undefined || tgId === null) {
            throw new Error('[VibeEvolution] addXp: tgId обязателен');
        }
        const db = getClient();
        const { data: current, error: readErr } = await db
            .from(TABLES.USERS)
            .select(COLS.XP)
            .eq(COLS.TG_ID, tgId)
            .single();
        if (readErr) throw readErr;

        const nextXp = (current[COLS.XP] || 0) + (delta || 0);
        const { data, error } = await db
            .from(TABLES.USERS)
            .update({ [COLS.XP]: nextXp })
            .eq(COLS.TG_ID, tgId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Основной способ начислять XP через SQL-функцию `add_xp_and_check_level`,
     * созданную в Supabase. Функция сама инкрементит users.xp и, если XP перевалил
     * за порог следующей эпохи, поднимает users.current_level.
     *
     * Ожидаемая сигнатура RPC (как в текущей Supabase-функции):
     *   add_xp_and_check_level(user_id_tg bigint, xp_to_add int)
     *     returns table (new_xp int, new_level int, leveled_up bool)
     *
     * Если в БД параметры назовут иначе — поправь объект с аргументами ниже.
     *
     * Если вернулось `leveled_up: true`, мы автоматически вызываем
     * refreshEvolution(tgId) — это подтянет новые слои из eras_config и плавно
     * сменит облик персонажа без перезагрузки страницы.
     *
     * @param {number|string} tgId
     * @param {number} amount   кол-во XP для начисления (может быть отрицательным, если функция это поддерживает)
     * @returns {Promise<{ new_xp:number|null, new_level:number|null, leveled_up:boolean, raw:any }>}
     */
    async function addExperience(tgId, amount) {
        if (tgId === undefined || tgId === null) {
            throw new Error('[VibeEvolution] addExperience: tgId обязателен');
        }
        const delta = Number(amount);
        if (!Number.isFinite(delta)) {
            throw new Error('[VibeEvolution] addExperience: amount должен быть числом');
        }

        const db = getClient();

        const { data, error } = await db.rpc('add_xp_and_check_level', {
            user_id_tg: tgId,
            xp_to_add: delta,
        });

        if (error) {
            console.error('[VibeEvolution] addExperience RPC error:', error);
            throw error;
        }

        const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
        const result = {
            new_xp:     row.new_xp     != null ? Number(row.new_xp)     : null,
            new_level:  row.new_level  != null ? Number(row.new_level)  : null,
            leveled_up: row.leveled_up === true,
            raw: data,
        };

        console.log('[VibeEvolution] addExperience =>', result);

        if (result.leveled_up) {
            console.log('[VibeEvolution] LEVEL UP! Перерисовываем слои персонажа...');
            await refreshEvolution(tgId);
        } else {
            const xpEl = document.getElementById('profile-xp-value');
            if (xpEl && result.new_xp != null) xpEl.innerText = result.new_xp;
        }

        return result;
    }

    /**
     * DEV-хелпер: переключить current_level на следующий (или предыдущий) уровень,
     * РЕАЛЬНО существующий в eras_config. Так мы не нарушаем FK fk_current_level,
     * даже если в конфиге только «прыжковые» уровни (1, 2, 25, 50 и т.п.).
     *
     * direction > 0 — шагаем вперёд по списку уровней (по умолчанию),
     * direction < 0 — шагаем назад.
     * Если достигли края — сбрасываемся на противоположный конец (циклично).
     */
    async function bumpLevel(tgId, direction) {
        if (tgId === undefined || tgId === null) {
            throw new Error('[VibeEvolution] bumpLevel: tgId обязателен');
        }
        const step = (direction === undefined || direction === null) ? 1 : Number(direction);
        const goForward = step >= 0;

        const db = getClient();

        const { data: current, error: readErr } = await db
            .from(TABLES.USERS)
            .select(COLS.LEVEL)
            .eq(COLS.TG_ID, tgId)
            .single();
        if (readErr) throw readErr;

        const { data: eras, error: erasErr } = await db
            .from(TABLES.ERAS)
            .select(COLS.ERA_LEVEL)
            .order(COLS.ERA_LEVEL, { ascending: true });
        if (erasErr) throw erasErr;

        const levels = (eras || [])
            .map(function (row) { return row[COLS.ERA_LEVEL]; })
            .filter(function (v) { return v !== null && v !== undefined; });

        if (levels.length === 0) {
            throw new Error('[VibeEvolution] bumpLevel: eras_config пуст, нет доступных уровней');
        }

        const curLvl = current[COLS.LEVEL];
        let nextLvl;

        if (goForward) {
            nextLvl = levels.find(function (l) { return l > curLvl; });
            if (nextLvl === undefined) nextLvl = levels[0];
        } else {
            for (let i = levels.length - 1; i >= 0; i--) {
                if (levels[i] < curLvl) { nextLvl = levels[i]; break; }
            }
            if (nextLvl === undefined) nextLvl = levels[levels.length - 1];
        }

        const { data, error } = await db
            .from(TABLES.USERS)
            .update({ [COLS.LEVEL]: nextLvl })
            .eq(COLS.TG_ID, tgId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    global.VibeEvolution = {
        getClient,
        getUserEvolution,
        updateVisualLayers,
        updateModel3D,
        updateEvolutionText,
        refreshEvolution,
        addXp,
        addExperience,
        bumpLevel,
        LAYERS,
        TABLES,
        COLS,
        MODEL_3D_ID,
    };
})(window);
