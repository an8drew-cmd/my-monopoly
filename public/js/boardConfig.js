/**
 * ============================================================================
 * ГЛАВНЫЙ ФАЙЛ НАСТРОЕК ИГРЫ (boardConfig.js)
 * ============================================================================
 * Привет! В оригинальной Monopoly из архива .ipa все эти данные спрятаны
 * внутри гигантских закрытых файлов sharedassets.assets в папке Data.
 *
 * В нашей сборке всё лежит открытым текстом прямо здесь!
 * Ты можешь менять название игры, стартовые деньги, названия любых улиц,
 * цены и тексты карточек «Шанс» / «Казна» — и игра сразу подхватит изменения.
 * (Также всё это можно поменять прямо внутри приложения в меню «Свои правила»!)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DEFAULT_BOARD_CONFIG = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // 1. ОБЩИЕ ПРАВИЛА ПАРТИИ
    meta: {
      gameTitle: 'МОНОПОЛИЯ',
      gameSubtitle: 'Клуб друзей · 2D Edition',
      currency: '₽',
      startingCash: 15000,     // Стартовый капитал каждого игрока
      goSalary: 2000,          // Награда за прохождение клетки «СТАРТ»
      jailBail: 500,           // Стоимость досрочного выхода из тюрьмы
      freeParkingJackpot: false // Если включить true — налоги копятся на «Бесплатной парковке»!
    },

    // 2. ЦВЕТОВЫЕ РАЙОНЫ (ГРУППЫ УЛИЦ)
    groups: {
      brown:     { name: 'Коричневый район', color: '#8B5A2B', textColor: '#FFFFFF' },
      lightblue: { name: 'Голубой район',    color: '#38BDF8', textColor: '#0F172A' },
      pink:      { name: 'Розовый район',    color: '#EC4899', textColor: '#FFFFFF' },
      orange:    { name: 'Оранжевый район',  color: '#F97316', textColor: '#FFFFFF' },
      red:       { name: 'Красный район',    color: '#EF4444', textColor: '#FFFFFF' },
      yellow:    { name: 'Жёлтый район',     color: '#EAB308', textColor: '#0F172A' },
      green:     { name: 'Зелёный район',    color: '#22C55E', textColor: '#FFFFFF' },
      darkblue:  { name: 'Синий элитный',    color: '#2563EB', textColor: '#FFFFFF' }
    },

    // 3. ФИШКИ ИГРОКОВ
    tokens: [
      { id: 'car',   name: 'Спорткар', emoji: '🏎️', color: '#EF4444' },
      { id: 'ship',  name: 'Яхта',     emoji: '🛥️', color: '#3B82F6' },
      { id: 'hat',   name: 'Цилиндр',  emoji: '🎩', color: '#10B981' },
      { id: 'dog',   name: 'Корги',    emoji: '🐕', color: '#F59E0B' },
      { id: 'crown', name: 'Корона',   emoji: '👑', color: '#A855F7' },
      { id: 'jet',   name: 'Джет',     emoji: '✈️', color: '#EC4899' }
    ],

    // 4. ВСЕ 40 КЛЕТОК ПОЛЯ (по часовой стрелке от «СТАРТ» = 0 до «Арбат» = 39)
    // rent для улиц: [базовая, с 1 домом, с 2 домами, с 3 домами, с 4 домами, с Отелем]
    tiles: [
      { id: 0,  type: 'go',       name: 'СТАРТ',               sub: '+2000 ₽', icon: '🏁' },
      { id: 1,  type: 'property', name: 'Житная ул.',          group: 'brown',     price: 600,  houseCost: 500,  rent: [20, 100, 300, 900, 1600, 2500] },
      { id: 2,  type: 'chest',    name: 'Казна',               sub: 'Карточка', icon: '📦' },
      { id: 3,  type: 'property', name: 'Нагатинская ул.',     group: 'brown',     price: 600,  houseCost: 500,  rent: [40, 200, 600, 1800, 3200, 4500] },
      { id: 4,  type: 'tax',      name: 'Подоходный налог',    amount: 2000,       icon: '🧾' },
      { id: 5,  type: 'railroad', name: 'Рижская ж/д',         price: 2000,        rent: [250, 500, 1000, 2000], icon: '🚆' },
      { id: 6,  type: 'property', name: 'Варшавское ш.',       group: 'lightblue', price: 1000, houseCost: 500,  rent: [60, 300, 900, 2700, 4000, 5500] },
      { id: 7,  type: 'chance',   name: 'Шанс',                sub: 'Карточка', icon: '❓' },
      { id: 8,  type: 'property', name: 'ул. Огарёва',         group: 'lightblue', price: 1000, houseCost: 500,  rent: [60, 300, 900, 2700, 4000, 5500] },
      { id: 9,  type: 'property', name: 'Первая Парковая',     group: 'lightblue', price: 1200, houseCost: 500,  rent: [80, 400, 1000, 3000, 4500, 6000] },

      { id: 10, type: 'jail',     name: 'Тюрьма',              sub: 'Посещение', icon: '🔒' },
      { id: 11, type: 'property', name: 'ул. Полянка',         group: 'pink',      price: 1400, houseCost: 1000, rent: [100, 500, 1500, 4500, 6250, 7500] },
      { id: 12, type: 'utility',  name: 'Электросеть',         price: 1500,        icon: '⚡' },
      { id: 13, type: 'property', name: 'ул. Сретенка',        group: 'pink',      price: 1400, houseCost: 1000, rent: [100, 500, 1500, 4500, 6250, 7500] },
      { id: 14, type: 'property', name: 'Ростовская наб.',     group: 'pink',      price: 1600, houseCost: 1000, rent: [120, 600, 1800, 5000, 7000, 9000] },
      { id: 15, type: 'railroad', name: 'Курская ж/д',         price: 2000,        rent: [250, 500, 1000, 2000], icon: '🚆' },
      { id: 16, type: 'property', name: 'Рязанский пр-т',      group: 'orange',    price: 1800, houseCost: 1000, rent: [140, 700, 2000, 5500, 7500, 9500] },
      { id: 17, type: 'chest',    name: 'Казна',               sub: 'Карточка', icon: '📦' },
      { id: 18, type: 'property', name: 'ул. Вавилова',        group: 'orange',    price: 1800, houseCost: 1000, rent: [140, 700, 2000, 5500, 7500, 9500] },
      { id: 19, type: 'property', name: 'Рублёвское ш.',       group: 'orange',    price: 2000, houseCost: 1000, rent: [160, 800, 2200, 6000, 8000, 10000] },

      { id: 20, type: 'parking',  name: 'Парковка',            sub: 'Отдых',     icon: '🅿️' },
      { id: 21, type: 'property', name: 'ул. Тверская',        group: 'red',       price: 2200, houseCost: 1500, rent: [180, 900, 2500, 7000, 8750, 10500] },
      { id: 22, type: 'chance',   name: 'Шанс',                sub: 'Карточка', icon: '❓' },
      { id: 23, type: 'property', name: 'Пушкинская ул.',      group: 'red',       price: 2200, houseCost: 1500, rent: [180, 900, 2500, 7000, 8750, 10500] },
      { id: 24, type: 'property', name: 'пл. Маяковского',     group: 'red',       price: 2400, houseCost: 1500, rent: [200, 1000, 3000, 7500, 9250, 11000] },
      { id: 25, type: 'railroad', name: 'Казанская ж/д',       price: 2000,        rent: [250, 500, 1000, 2000], icon: '🚆' },
      { id: 26, type: 'property', name: 'Грузинский Вал',      group: 'yellow',    price: 2600, houseCost: 1500, rent: [220, 1100, 3300, 8000, 9750, 11500] },
      { id: 27, type: 'property', name: 'ул. Чайковского',     group: 'yellow',    price: 2600, houseCost: 1500, rent: [220, 1100, 3300, 8000, 9750, 11500] },
      { id: 28, type: 'utility',  name: 'Водоканал',           price: 1500,        icon: '💧' },
      { id: 29, type: 'property', name: 'Смоленская пл.',      group: 'yellow',    price: 2800, houseCost: 1500, rent: [240, 1200, 3600, 8500, 10250, 12000] },

      { id: 30, type: 'gotojail', name: 'В тюрьму!',           sub: 'Арест',     icon: '🚓' },
      { id: 31, type: 'property', name: 'ул. Щусева',          group: 'green',     price: 3000, houseCost: 2000, rent: [260, 1300, 3900, 9000, 11000, 12750] },
      { id: 32, type: 'property', name: 'Гоголевский б-р',     group: 'green',     price: 3000, houseCost: 2000, rent: [260, 1300, 3900, 9000, 11000, 12750] },
      { id: 33, type: 'chest',    name: 'Казна',               sub: 'Карточка', icon: '📦' },
      { id: 34, type: 'property', name: 'Кутузовский пр-т',    group: 'green',     price: 3200, houseCost: 2000, rent: [280, 1500, 4500, 10000, 12000, 14000] },
      { id: 35, type: 'railroad', name: 'Ленинградская ж/д',   price: 2000,        rent: [250, 500, 1000, 2000], icon: '🚆' },
      { id: 36, type: 'chance',   name: 'Шанс',                sub: 'Карточка', icon: '❓' },
      { id: 37, type: 'property', name: 'Малая Бронная',       group: 'darkblue',  price: 3500, houseCost: 2000, rent: [350, 1750, 5000, 11000, 13000, 15000] },
      { id: 38, type: 'tax',      name: 'Сверхналог',          amount: 1000,       icon: '💎' },
      { id: 39, type: 'property', name: 'ул. Арбат',           group: 'darkblue',  price: 4000, houseCost: 2000, rent: [500, 2000, 6000, 14000, 17000, 20000] }
    ],

    // 5. КАРТОЧКИ «ШАНС»
    chanceCards: [
      { text: 'Отправляйтесь прямо на поле «СТАРТ» и получите зарплату!', action: 'moveTo', target: 0 },
      { text: 'Прогулка по центру: отправляйтесь на ул. Арбат.', action: 'moveTo', target: 39 },
      { text: 'Деловая встреча: отправляйтесь на пл. Маяковского. Если пройдёте СТАРТ, получите 2000 ₽.', action: 'moveTo', target: 24 },
      { text: 'Вечерний променад: отправляйтесь на ул. Полянка.', action: 'moveTo', target: 11 },
      { text: 'Отправляйтесь на ближайшую железную дорогу! Если она ничья — можете купить её.', action: 'nearestRailroad' },
      { text: 'Сделайте три шага назад!', action: 'moveSteps', steps: -3 },
      { text: 'Банк выплачивает вам дивиденды в размере 500 ₽.', action: 'money', amount: 500 },
      { text: 'Ваша инвестиция выстрелила! Получите 1500 ₽.', action: 'money', amount: 1500 },
      { text: 'Штраф за превышение скорости — оплатите 150 ₽.', action: 'money', amount: -150 },
      { text: 'Капитальный ремонт недвижимости: заплатите 250 ₽ за каждый дом и 1000 ₽ за каждый отель.', action: 'repairs', house: 250, hotel: 1000 },
      { text: 'Вы избраны председателем совета директоров: выплатите каждому игроку по 500 ₽.', action: 'payEach', amount: 500 },
      { text: 'Освобождение из тюрьмы! Карточка сохраняется у вас до использования.', action: 'jailFree' },
      { text: 'Налоговая проверка! Отправляйтесь прямо в Тюрьму без получения денег за СТАРТ.', action: 'gotoJail' }
    ],

    // 6. КАРТОЧКИ «ОБЩЕСТВЕННАЯ КАЗНА»
    chestCards: [
      { text: 'Банковская ошибка в вашу пользу! Получите 2000 ₽.', action: 'money', amount: 2000 },
      { text: 'Возврат налогового вычета: получите 500 ₽.', action: 'money', amount: 500 },
      { text: 'Продажа акций принесла вам 1000 ₽.', action: 'money', amount: 1000 },
      { text: 'С Днём рождения! Каждый игрок дарит вам по 200 ₽.', action: 'collectEach', amount: 200 },
      { text: 'Вы заняли второе место на конкурсе стартапов! Получите 300 ₽.', action: 'money', amount: 300 },
      { text: 'Наследство от дальнего родственника — получите 1000 ₽.', action: 'money', amount: 1000 },
      { text: 'Оплата страховки и медицины: заплатите 500 ₽.', action: 'money', amount: -500 },
      { text: 'Оплата обучения и курсов: заплатите 1000 ₽.', action: 'money', amount: -1000 },
      { text: 'Благоустройство города: заплатите 400 ₽ за каждый дом и 1150 ₽ за каждый отель.', action: 'repairs', house: 400, hotel: 1150 },
      { text: 'Вернитесь на «СТАРТ» и получите премию!', action: 'moveTo', target: 0 },
      { text: 'Освобождение из тюрьмы! Карточка сохраняется у вас до использования.', action: 'jailFree' },
      { text: 'Задержание! Отправляйтесь прямо в Тюрьму.', action: 'gotoJail' }
    ]
  };
});
