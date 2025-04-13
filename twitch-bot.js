const tmi = require('tmi.js');
const readline = require('readline');
const fetch = require('node-fetch'); 
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Google Gemini API könyvtár importálása

// Parancssori argumentum ellenőrzése a csatorna nevéhez
// Ha nincs megadva csatorna, akkor alapértelmezett értéket használunk
let TARGET_CHANNEL = process.argv[2];
if (!TARGET_CHANNEL) {
  console.log('HIBA: Nincs megadva csatorna név!');
  console.log('Használat: node twitch-bot.js [csatorna_név]');
  process.exit(1);
}

// Biztosítjuk, hogy a csatorna név kisbetűs legyen (Twitch szabvány)
TARGET_CHANNEL = TARGET_CHANNEL.toLowerCase();

// Konfigurálás - add meg a saját Twitch fiókod adatait
const TWITCH_USERNAME = 'CHANGE_ME'; // Ide írd a saját Twitch felhasználónevedet
const TWITCH_OAUTH_TOKEN = 'oauth:CHANGE_ME'; 

// Gemini API konfiguráció
const GEMINI_API_KEY = 'CHANGE_ME';
const GEMINI_MODEL = 'gemini-2.0-flash'; // Gemini 2.0 Flash modell

// Wikipedia API beállítások
const WIKI_API_HU = 'https://hu.wikipedia.org/w/api.php';
const WIKI_API_EN = 'https://en.wikipedia.org/w/api.php';
const WIKI_HEADERS = {
  'User-Agent': 'TwitchBot/1.0 (https://twitch.tv/; info@example.org)',
  'Accept': 'application/json'
};

// Gemini API kliens inicializálása
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// A tulajdonos felhasználóneve, aki leállíthatja a botot
const OWNER_USERNAME = TWITCH_USERNAME.toLowerCase();

// További admin felhasználók, akik parancsokat adhatnak a botnak
const ADMIN_USERS = ['CHANGE_ME'];

// Függvény a felhasználó jogosultságainak ellenőrzéséhez
function isAuthorized(username) {
  return username === OWNER_USERNAME || ADMIN_USERS.includes(username);
}

// Bot beállítások
let welcomeEnabled = false; // Alapértelmezetten kikapcsolt köszöntés
const COMMAND_PREFIX = '!'; // Parancs előtag
const WELCOME_TOGGLE_COMMAND = 'welcome'; // Köszöntés ki/be kapcsoló parancs

// TMI kliens létrehozása a saját fiókkal
const client = new tmi.Client({
  options: { debug: false }, // Debug módot kikapcsoltam a tisztább konzolkimenetek érdekében
  identity: {
    username: TWITCH_USERNAME,
    password: TWITCH_OAUTH_TOKEN
  },
  channels: [TARGET_CHANNEL]
});

// Változó a látott felhasználók tárolására
const seenUsers = new Set();

// Változó annak nyomokövetésére, hogy a bot éppen válaszol-e
let isProcessingAIResponse = false;

// Kapcsolódás a Twitch szerverhez
client.connect();

// Találós kérdés játék változók
let riddleInProgress = false;
let currentRiddle = null;
let currentRiddleAnswer = null;
let riddleTimer = null;
let riddleEndTime = null; // Új változó a játék befejezési idejének tárolásához
let userAnswers = new Map(); // Felhasználó válaszok tárolása
const RIDDLE_WAIT_TIME = 120000; // 2 perc (milliszekundumban) 
const RIDDLE_PREFIX = '!'; // A találós kérdés parancsok előtagja

// Üzenetek közötti késleltetés az anti-flood védelem miatt
const MESSAGE_DELAY = 1200; // 1.2 másodperc késleltetés üzenetek között
let lastMessageTime = 0;

// Késleltetett üzenetküldés a Twitch spam védelem elkerüléséhez
async function sendDelayedMessage(channel, message) {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  
  // Ha nem telt el elég idő az előző üzenet óta, várunk
  if (timeSinceLastMessage < MESSAGE_DELAY) {
    const delayNeeded = MESSAGE_DELAY - timeSinceLastMessage;
    await new Promise(resolve => setTimeout(resolve, delayNeeded));
  }
  
  // Üzenet küldése és időbélyeg frissítése
  client.say(channel, message);
  lastMessageTime = Date.now();
}

// Találós kérdés játék alaphelyzetbe állítása
function resetRiddleGame() {
  riddleInProgress = false;
  currentRiddle = null;
  currentRiddleAnswer = null;
  clearTimeout(riddleTimer);
  riddleTimer = null;
  riddleEndTime = null;
  userAnswers.clear();
  console.log('Találós kérdés játék alaphelyzetbe állítva');
}

// Funkció a Gemini modellek lekérdezésére - ellenőrzéshez
async function listGeminiModels() {
  try {
    const response = await fetch('https://api.gemini.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GEMINI_API_KEY}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API válasz hiba a modellek lekérdezésekor:', errorText);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Hiba a modellek lekérdezésekor:', error);
    return [];
  }
}

// Új egyszerűsített Wikipedia API segédfüggvények
// Keresés a Wikipédián
async function searchWikipediaQuery(query, language = 'hu') {
  try {
    const baseUrl = language === 'hu' ? WIKI_API_HU : WIKI_API_EN;
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      format: 'json',
      utf8: 1
    });
    
    const url = `${baseUrl}?${params.toString()}`;
    console.log(`Wikipedia keresés: ${query} (${language})`);
    
    const response = await fetch(url, { headers: WIKI_HEADERS });
    const data = await response.json();
    
    if (!data.query || !data.query.search || data.query.search.length === 0) {
      console.log(`Nem található eredmény a "${query}" keresésre a Wikipédián (${language})`);
      return null;
    }
    
    // Az első találatot adjuk vissza
    return {
      title: data.query.search[0].title,
      language: language
    };
  } catch (error) {
    console.error('Hiba a Wikipedia keresés során:', error);
    return null;
  }
}

// Wikipedia cikk bevezető részének lekérése
async function getWikipediaIntro(title, language = 'hu') {
  try {
    const baseUrl = language === 'hu' ? WIKI_API_HU : WIKI_API_EN;
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      format: 'json',
      prop: 'extracts|info',
      exintro: 1,
      explaintext: 1,
      inprop: 'url'
    });
    
    const url = `${baseUrl}?${params.toString()}`;
    console.log(`Wikipedia bevezető lekérése: ${title} (${language})`);
    
    const response = await fetch(url, { headers: WIKI_HEADERS });
    const data = await response.json();
    
    if (!data.query || !data.query.pages) {
      console.error('Nincs megfelelő válasz a Wikipedia API-tól');
      return null;
    }
    
    // A pages objektum első elemét használjuk
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];
    
    if (pageId === '-1' || !page.extract) {
      console.log(`Nem található oldal ezzel a címmel: ${title}`);
      return null;
    }
    
    return {
      title: page.title,
      extract: page.extract,
      url: page.canonicalurl || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      language: language
    };
  } catch (error) {
    console.error('Hiba a Wikipedia bevezető lekérése során:', error);
    return null;
  }
}

// Gemini AI-val való kommunikáció az SDK segítségével
async function askGemini(username, question) {
  try {
    console.log(`GeminiAI kérdés: ${question}`);
    console.log('API kérés küldése...');
    
    const lowerQuestion = question.toLowerCase();
    
    // Ellenőrizzük, hogy idővel vagy dátummal kapcsolatos-e a kérdés
    const isTimeQuestion = lowerQuestion.includes('mennyi az idő') || 
                          lowerQuestion.includes('hány óra') ||
                          lowerQuestion.includes('milyen nap van ma') ||
                          lowerQuestion.includes('milyen időt írunk') ||
                          lowerQuestion.includes('milyen dátum van') ||
                          lowerQuestion.includes('hanyadika van') ||
                          lowerQuestion.includes('mi az idő');
    
    // Ellenőrizzük, hogy a kérdésben szerepel-e a "wikipedia" szó
    const isWikipediaQuestion = lowerQuestion.includes('wikipedia') || lowerQuestion.includes('wikipédia');
    
    // Aktuális dátum és idő információk
    const days = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
    const months = ['január', 'február', 'március', 'április', 'május', 'június', 
                   'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
    
    const now = new Date();
    const dayName = days[now.getDay()];
    const day = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    // Ha idővel vagy dátummal kapcsolatos a kérdés, közvetlen választ adunk
    if (isTimeQuestion) {
      if (lowerQuestion.includes('mennyi az idő') || lowerQuestion.includes('hány óra') || lowerQuestion.includes('mi az idő')) {
        return `Az aktuális idő: ${hours}:${minutes}`;
      } else if (lowerQuestion.includes('milyen nap van ma')) {
        return `Ma ${dayName} van, ${year}. ${months[month]} ${day}.`;
      } else {
        return `Ma ${dayName} van, ${year}. ${months[month]} ${day}., az idő pedig ${hours}:${minutes}`;
      }
    }
    
    // Csak akkor keresünk a Wikipedián, ha a kérdésben szerepel a "wikipedia" szó
    if (isWikipediaQuestion) {
      console.log('Wikipedia keresés kérve...');
      
      // A kérdésből készítünk keresési kulcsszót
      // Eltávolítjuk a "wikipedia" és "wikipédia" szavakat a keresési kifejezésből
      let searchQuery = question
        .replace(/wikipedia|wikipédia/gi, '')
        .replace(/^(ki|mi|mikor|hol|milyen|melyik|hogyan|honnan|mit|miért)\s+(az|a|volt|van|voltak|lesz|csinál)\s+/i, '')
        .replace(/\?+$/, '')
        .trim();
      
      // Ha a keresési kifejezés túl rövid, használjuk az egész kérdést a wikipedia/wikipédia szó nélkül
      if (searchQuery.length < 3) {
        searchQuery = question
          .replace(/wikipedia|wikipédia/gi, '')
          .replace(/\?+$/, '')
          .trim();
      }
      
      console.log(`Wikipedia keresési kifejezés: "${searchQuery}"`);
      
      try {
        // Keresés a Wikipédián
        const searchResult = await searchWikipediaQuery(searchQuery);
        
        if (searchResult) {
          // Ha találtunk megfelelő oldalt, lekérjük az összefoglalóját
          const summary = await getWikipediaIntro(searchResult.title, searchResult.language || 'hu');
          
          if (summary) {
            console.log(`Wikipedia találat: ${summary.title} (${summary.language})`);
            
            // Előkészítjük az információt az AI számára
            const wikiInfo = {
              title: summary.title,
              extract: summary.extract.substring(0, 800),
              url: summary.url,
              language: summary.language
            };
            
            // Az AI-nak elküldjük mind a Wikipedia információt, mind az eredeti kérdést
            const chat = model.startChat({
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 175,
              },
              history: [
                {
                  role: "user",
                  parts: [{ text: `Te egy segítőkész és barátságos Twitch chat asszisztens vagy, aki tényszerű információkat ad. 
                  Az alábbi Wikipedia információ alapján válaszolj magyarul ${username} kérdésére, röviden és tömören.
                  
                  Wikipedia információ cím: ${wikiInfo.title}
                  Wikipedia információ tartalom: ${wikiInfo.extract}
                  
                  Mindig említsd meg a forrást a válasz végén: [Forrás: Wikipedia]` }],
                },
                {
                  role: "model",
                  parts: [{ text: "Értem, segítek a Wikipedia információkat felhasználva válaszolni a kérdésre tömören és tényszerűen." }],
                }
              ]
            });
            
            const result = await chat.sendMessage(`${username} kérdése: ${question}`);
            const response = result.response;
            
            console.log('API válasz sikeresen beérkezett (Wikipedia forrással)');
            return response.text().trim() || "Sajnos nem találtam pontos információt erről a témáról a Wikipédián.";
          }
        }
        
        console.log('Nem található megfelelő Wikipedia tartalom, visszatérés a normál AI válaszhoz');
      } catch (wikiError) {
        console.error('Hiba a Wikipedia keresés során, visszatérés a normál AI válaszhoz:', wikiError);
      }
    }
    
    // Normál AI választ adunk
    const chat = model.startChat({
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 150,
      },
      history: [
        {
          role: "user",
          parts: [{ text: "Te egy segítőkész és barátságos Twitch chat asszisztens vagy. Rövid, tömör válaszokat adsz magyarul. Az aktuális dátum: " + 
                   `${year}. ${months[month]} ${day}., ${dayName}. Az aktuális idő: ${hours}:${minutes}.` +
                   " Ezt az információt használd, ha időre, dátumra vagy napra kérdeznek." }],
        },
        {
          role: "model",
          parts: [{ text: "Rendben, segítek neked! Rövid és barátságos válaszokat fogok adni magyarul. Ha időre, dátumra vagy napra kérdeznek, a megadott információt fogom használni." }],
        }
      ]
    });
    
    // Kérdés küldése és válasz fogadása
    const result = await chat.sendMessage(`${username} kérdése: ${question}`);
    const response = result.response;
    console.log('API válasz sikeresen beérkezett');
    
    return response.text().trim() || "Sajnos nem tudok válaszolni erre a kérdésre.";
  } catch (error) {
    console.error('Hiba történt a Gemini API hívás során:', error);
    return "Sajnos hiba történt a válasz generálása közben.";
  }
}

// Gemini AI-val való üdvözlő üzenet generálása
async function generateWelcomeMessage(username) {
  try {
    console.log(`Üdvözlő üzenet generálása ${username} felhasználónak...`);
    
    const prompt = `Generálj egy rövid, kreatív és kedves üdvözlő üzenetet magyarul a következő Twitch chat felhasználónak: ${username}. 
    Az üzenet legyen 60-100 karakter közötti, barátságos, változatos és mindig egyedi. 
    Csak az üdvözlést add meg, minden bevezetés vagy magyarázat nélkül.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let welcomeMessage = response.text().trim() || "Üdvözöllek a csatornán!";
    
    // Tisztítjuk az üzenetet: eltávolítjuk az idézőjeleket, ha vannak
    welcomeMessage = welcomeMessage.replace(/^["']|["']$/g, '').trim();
    
    // Hozzáadjuk a felhasználónevet, ha még nem tartalmazza
    if (!welcomeMessage.includes('@' + username) && !welcomeMessage.includes('@' + username.toLowerCase())) {
      welcomeMessage = `@${username}, ${welcomeMessage.charAt(0).toLowerCase() + welcomeMessage.slice(1)}`;
    }
    
    return welcomeMessage;
  } catch (error) {
    console.error('Hiba történt az üdvözlő üzenet generálása során:', error);
    return `Üdvözöllek a csatornán, @${username}! :)`;
  }
}

// Találós kérdés generálása az AI segítségével
async function generateRiddle() {
  try {
    console.log('Találós kérdés generálása...');
    
    const prompt = `Generálj egy közepes nehézségű, érdekes találós kérdést magyarul. 
    Olyan rejtvényt adj, ami nem túl könnyű, de nem is nagyon nehéz.
    A válaszod tartalmazza a találós kérdést ÉS a helyes választ a következő formátumban:
    
    KÉRDÉS: [itt a találós kérdés szövege]
    VÁLASZ: [itt a helyes válasz]
    
    A találós kérdés legyen kulturált, szalonképes, és olyan, amit egy magyar Twitch közönség élvezhet. 
    Semmiképpen ne ismételj meg egy korábban használt találós kérdést.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    // Kinyerjük a kérdést és a választ a válaszból
    const questionMatch = text.match(/KÉRDÉS:(.+?)(?=VÁLASZ:)/s);
    const answerMatch = text.match(/VÁLASZ:(.+)/s);
    
    if (questionMatch && answerMatch) {
      const question = questionMatch[1].trim();
      const answer = answerMatch[1].trim();
      
      return {
        question: question,
        answer: answer
      };
    } else {
      console.error('Nem sikerült kinyerni a találós kérdést vagy a választ az AI válaszából');
      return null;
    }
  } catch (error) {
    console.error('Hiba történt a találós kérdés generálása során:', error);
    return null;
  }
}

// Válaszok kiértékelése
async function evaluateAnswers(userAnswers, correctAnswer) {
  try {
    if (userAnswers.size === 0) {
      return {
        noAnswers: true,
        correctUsers: [],
        closeUsers: []
      };
    }
    
    console.log('Válaszok kiértékelése...');
    
    const correctUsers = [];
    const closeUsers = [];
    
    // Minden felhasználói választ elküldünk az AI-nak kiértékelésre
    for (const [username, answer] of userAnswers) {
      // Normalizáljuk a válaszokat (kisbetűs, ékezet nélküli stb.)
      const normalizedUserAnswer = answer.toLowerCase().trim();
      const normalizedCorrectAnswer = correctAnswer.toLowerCase().trim();
      
      // Egyszerű szöveges egyezés először
      if (normalizedUserAnswer === normalizedCorrectAnswer ||
          normalizedUserAnswer.includes(normalizedCorrectAnswer) ||
          normalizedCorrectAnswer.includes(normalizedUserAnswer)) {
        correctUsers.push(username);
        continue;
      }
      
      // Ha nincs egyszerű egyezés, AI-t kérjük meg a kiértékelésre
      const prompt = `Értékeld, hogy a felhasználó válasza mennyire helyes a találós kérdésre adott válaszhoz képest.
      
      A helyes válasz: "${correctAnswer}"
      A felhasználó válasza: "${answer}"
      
      Csak az alábbi kategóriák egyikével válaszolj:
      "helyes" - ha a válasz teljesen helyes, vagy nagyon közel áll a helyeshez
      "közeli" - ha a felhasználó válasza részben helyes, vagy legalább a koncepciót eltalálta
      "helytelen" - ha a válasz teljesen rossz`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const evaluation = response.text().toLowerCase().trim();
      
      if (evaluation.includes('helyes')) {
        correctUsers.push(username);
      } else if (evaluation.includes('közel') || evaluation.includes('közeli')) {
        closeUsers.push(username);
      }
    }
    
    return {
      noAnswers: false,
      correctUsers: correctUsers,
      closeUsers: closeUsers
    };
  } catch (error) {
    console.error('Hiba történt a válaszok kiértékelése során:', error);
    return {
      error: true,
      correctUsers: [],
      closeUsers: []
    };
  }
}

// Eseménykezelő chat üzenetek fogadására
client.on('message', async (channel, tags, message, self) => {
  // Saját üzeneteket figyelmen kívül hagyjuk
  if (self) return;

  const username = tags.username.toLowerCase();
  
  // Találós kérdés játék parancsok kezelése (! előtaggal)
  if (message.startsWith(RIDDLE_PREFIX)) {
    const riddleCommand = message.slice(RIDDLE_PREFIX.length).trim().toLowerCase();
    
    // Találós kérdés indítása
    if (riddleCommand === 'talaloskerdes' || riddleCommand === 'találóskérdés') {
      // Csak admin vagy a tulajdonos indíthat találós kérdés játékot
      if (!isAuthorized(username)) {
        await sendDelayedMessage(channel, `@${tags.username}, nincs jogosultságod találós kérdés játékot indítani.`);
        return;
      }
      
      // Ha már folyamatban van egy játék, nem indítunk újat
      if (riddleInProgress) {
        await sendDelayedMessage(channel, `@${tags.username}, már folyamatban van egy találós kérdés játék! A válaszadáshoz használd a !valasz parancsot.`);
        return;
      }
      
      // Jelezzük, hogy elindult a játék
      await sendDelayedMessage(channel, `🎮 Találós kérdés játék indul! Egy pillanat türelmet kérek, amíg kitalálok egy jó kérdést...`);
      
      try {
        // Generálunk egy találós kérdést
        const riddle = await generateRiddle();
        if (!riddle) {
          await sendDelayedMessage(channel, `Sajnálom, de most nem sikerült jó találós kérdést generálnom. Kérlek, próbáld újra később!`);
          return;
        }
        
        // Beállítjuk az aktív játékot
        riddleInProgress = true;
        currentRiddle = riddle.question;
        currentRiddleAnswer = riddle.answer;
        userAnswers.clear();
        
        // Aktuális időpont meghatározása a játék végéhez
        const now = new Date();
        riddleEndTime = new Date(now.getTime() + RIDDLE_WAIT_TIME);
        const endTimeStr = `${riddleEndTime.getHours().toString().padStart(2, '0')}:${riddleEndTime.getMinutes().toString().padStart(2, '0')}`;
        
        // Elküldjük a kérdést és a részletes játékszabályokat - késleltetve
        await sendDelayedMessage(channel, `🧩 TALÁLÓS KÉRDÉS: ${currentRiddle}`);
        await sendDelayedMessage(channel, `📝 Válaszolni a "!valasz [tipped]" vagy "!válasz [tipped]" parancsokkal tudsz! (pl: !valasz kutya)`);
        await sendDelayedMessage(channel, `⏰ Az eredményhirdetés ${endTimeStr}-kor lesz (2 perc múlva). Többször is válaszolhatsz, csak a legutolsó tipped számít!`);
        
        console.log(`Találós kérdés játék indítva: "${currentRiddle}" (Válasz: ${currentRiddleAnswer})`);
        
        // Időzítő beállítása a játék lezárásához
        clearTimeout(riddleTimer);
        riddleTimer = setTimeout(async () => {
          // Az idő lejárt, kiértékeljük a válaszokat
          if (riddleInProgress) {
            await sendDelayedMessage(channel, `⌛ Az idő lejárt! Kiértékelem a válaszokat...`);
            
            // Válaszok kiértékelése
            const evaluation = await evaluateAnswers(userAnswers, currentRiddleAnswer);
            
            // Eredmények közlése - minden üzenetet késleltetve küldünk
            if (evaluation.error) {
              await sendDelayedMessage(channel, `Sajnos hiba történt a válaszok kiértékelése során. 😢 A helyes válasz: ${currentRiddleAnswer}`);
            } else if (evaluation.noAnswers) {
              await sendDelayedMessage(channel, `Sajnos senki nem válaszolt. 😢 A helyes válasz: ${currentRiddleAnswer}`);
            } else {
              // Helyes válaszok formázása és küldés késleltetve
              await sendDelayedMessage(channel, `🎯 A találós kérdés megfejtése: ${currentRiddleAnswer}`);
              
              // Különböző eredmény üzeneteket külön küldjük, késleltetéssel
              if (evaluation.correctUsers.length > 0) {
                await sendDelayedMessage(channel, `🏆 Helyes választ adtak: ${evaluation.correctUsers.map(u => '@' + u).join(', ')}! 👏`);
              }
              
              if (evaluation.closeUsers.length > 0) {
                await sendDelayedMessage(channel, `👍 Közel jártak a megoldáshoz: ${evaluation.closeUsers.map(u => '@' + u).join(', ')}!`);
              }
              
              if (evaluation.correctUsers.length === 0 && evaluation.closeUsers.length === 0) {
                await sendDelayedMessage(channel, `Sajnos senkinek nem sikerült eltalálni a helyes választ. Legközelebb több szerencsét!`);
              }
            }
            
            // Játék alaphelyzetbe állítása
            resetRiddleGame();
          }
        }, RIDDLE_WAIT_TIME);
      } catch (error) {
        console.error('Hiba a találós kérdés indítása során:', error);
        await sendDelayedMessage(channel, `Sajnálom, de hiba történt a játék indítása közben. Kérlek, próbáld újra később!`);
      }
      
      return;
    }
    
    // Válaszok kezelése
    if ((riddleCommand.startsWith('valasz ') || riddleCommand.startsWith('válasz ')) && riddleInProgress) {
      // Ellenőrizzük, hogy van-e aktív játék
      if (!riddleInProgress) {
        await sendDelayedMessage(channel, `@${tags.username}, jelenleg nincs aktív találós kérdés játék. Indíts egyet a !talaloskerdes paranccsal!`);
        return;
      }
      
      // Kinyerjük a választ a parancsból
      const userAnswer = message.slice(RIDDLE_PREFIX.length).trim().toLowerCase()
        .replace(/^valasz\s+|^válasz\s+/i, '').trim();
      
      if (userAnswer.length === 0) {
        await sendDelayedMessage(channel, `@${tags.username}, kérlek, adj meg egy választ is! Például: !valasz az én tippem`);
        return;
      }
      
      // Eltároljuk a felhasználó válaszát (egy felhasználó több választ is adhat, de csak a legutolsót vesszük figyelembe)
      userAnswers.set(username, userAnswer);
      
      // Kiszámoljuk, hogy mennyi idő van még hátra az eredményhirdetésig a riddleEndTime alapján
      const now = new Date();
      if (riddleEndTime) {
        const remainingMs = riddleEndTime.getTime() - now.getTime();
        if (remainingMs > 0) {
          const remainingSeconds = Math.floor(remainingMs / 1000);
          const remainingMinutes = Math.floor(remainingSeconds / 60);
          const remainingSecsOnly = remainingSeconds % 60;
          
          // Csak akkor küldjük el a visszaigazolást, ha még van idő hátra
          // És érdemi idő van hátra - ha kevesebb mint 5 mp, akkor nem zavarjuk a chattet
          if (remainingSeconds > 5) {
            const endTimeStr = `${riddleEndTime.getHours().toString().padStart(2, '0')}:${riddleEndTime.getMinutes().toString().padStart(2, '0')}`;
            await sendDelayedMessage(channel, `@${tags.username}, rögzítettem a válaszodat! Az eredményhirdetés ${endTimeStr}-kor lesz (még ${remainingMinutes} perc ${remainingSecsOnly} másodperc).`);
          } else {
            // Ha már csak nagyon kevés idő van hátra, csak egy rövid visszaigazolást küldünk
            await sendDelayedMessage(channel, `@${tags.username}, rögzítettem a válaszodat! Az eredményhirdetés hamarosan kezdődik.`);
          }
        } else {
          // Az idő már lejárt, de az eredményhirdetés még nem történt meg
          await sendDelayedMessage(channel, `@${tags.username}, rögzítettem a válaszodat! Az eredményhirdetés hamarosan kezdődik.`);
        }
      } else {
        // Ha valamiért nincs beállítva a riddleEndTime, egy egyszerű visszaigazolást küldünk
        await sendDelayedMessage(channel, `@${tags.username}, köszönöm a választ!`);
      }
      
      console.log(`${tags.username} válaszolt a találós kérdésre: "${userAnswer}"`);
      return;
    }
  }
  
  // Parancsok kezelése
  if (message.startsWith(COMMAND_PREFIX)) {
    const args = message.slice(COMMAND_PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Welcome parancs kezelése - csak a tulajdonos állíthatja be
    if (command === WELCOME_TOGGLE_COMMAND && isAuthorized(username)) {
      welcomeEnabled = !welcomeEnabled;
      client.say(channel, `@${tags.username}, az új felhasználók köszöntése ${welcomeEnabled ? 'bekapcsolva' : 'kikapcsolva'}.`);
      console.log(`Köszöntés állapota megváltoztatva: ${welcomeEnabled ? 'BE' : 'KI'}`);
      return;
    }
  }
  
  // Ha ez egy új felhasználó, akit még nem láttunk ÉS a köszöntés be van kapcsolva
  if (!seenUsers.has(username) && welcomeEnabled) {
    seenUsers.add(username);
    
    try {
      // AI által generált üdvözlés kérése - közbenső üzenet nélkül
      const aiWelcome = await generateWelcomeMessage(tags.username);
      
      // AI üdvözlő üzenet küldése a chatbe
      client.say(channel, aiWelcome);
      console.log(`[${new Date().toLocaleTimeString()}] Új felhasználó AI által üdvözölve: ${tags.username}`);
    } catch (error) {
      console.error('Hiba az AI üdvözlés során:', error);
      // Hiba esetén alap üdvözlést használunk
      client.say(channel, `Üdvözöllek a csatornán, @${tags.username}! :)`);
    }
  } else if (!seenUsers.has(username)) {
    // Ha az új felhasználót nem üdvözöljük, akkor is adjuk hozzá a listához
    seenUsers.add(username);
    console.log(`[${new Date().toLocaleTimeString()}] Új felhasználó érkezett (köszöntés kikapcsolva): ${tags.username}`);
  }
  
  // Bot leállítása chat paranccsal - csak a tulajdonos állíthatja le
  if (message.toLowerCase() === '!stopbot' && isAuthorized(username)) {
    console.log('Bot leállítás parancs fogadva a tulajdonostól!');
    client.say(channel, `Bot leállítása...`);
    
    // Tiszta kilépés
    setTimeout(() => {
      client.disconnect();
      console.log('Bot sikeresen leállítva!');
      process.exit(0);
    }, 1000);
  }
  
  // Gemini AI válasz kérés - ha a felhasználó a botot megszólítja
  // A !ask paranccsal vagy a bot nevének említésével lehet kérdezni
  if ((message.toLowerCase().startsWith('!ask ') || 
       message.toLowerCase().includes(`@${TWITCH_USERNAME.toLowerCase()}`)) && 
       !isProcessingAIResponse) {
    
    isProcessingAIResponse = true;
    
    // Kérdés kinyerése az üzenetből
    let question = message;
    if (message.toLowerCase().startsWith('!ask ')) {
      question = message.substring(5).trim();
    } else {
      question = message.replace(new RegExp(`@${TWITCH_USERNAME}`, 'gi'), '').trim();
    }
    
    if (question.length > 0) {
      try {
        const aiResponse = await askGemini(tags.username, question);
        client.say(channel, `@${tags.username}, ${aiResponse}`);
        console.log(`AI válasz küldve ${tags.username} felhasználónak.`);
      } catch (error) {
        console.error('Hiba történt a Gemini válasz küldése közben:', error);
        client.say(channel, `@${tags.username}, sajnos technikai probléma miatt most nem tudok válaszolni.`);
      }
    }
    
    isProcessingAIResponse = false;
  }
});

// Inicializáljuk a botot a kapcsolódás után
client.on('connected', async (addr, port) => {
  console.log(`* Csatlakozva ${addr}:${port}`);
  console.log(`* Figyelés a következő csatorna chatjére: ${TARGET_CHANNEL}`);
  console.log(`* Bejelentkezve mint: ${TWITCH_USERNAME}`);
  console.log('* A bot leállítható:');
  console.log('  - A terminálban: Nyomj Ctrl+C vagy írd be: "exit" és nyomj Enter-t');
  console.log(`  - A Twitch chatben: Írd be: !stopbot (${OWNER_USERNAME} és ${ADMIN_USERS.join(', ')} használhatja)`);
  console.log(`* Új felhasználók köszöntése: ${welcomeEnabled ? 'BEKAPCSOLVA' : 'KIKAPCSOLVA'}`);
  console.log(`* A köszöntés ki/be kapcsolásához használd: !${WELCOME_TOGGLE_COMMAND} (${OWNER_USERNAME} és ${ADMIN_USERS.join(', ')} használhatja)`);
  console.log('* AI funkciók aktiválva: A felhasználók kérdezhetnek a bottól "!ask kérdés" formában vagy a bot nevének említésével');
  
  console.log('* Gemini API tesztelése...');
  try {
    // Egyszerű tesztkérés a Gemini API-hoz, hogy ellenőrizzük a kapcsolatot
    const result = await model.generateContent('Röviden köszönj magyarul');
    const response = await result.response;
    const text = response.text();
    console.log("✅ Gemini API kapcsolat sikeres!");
    console.log(`Gemini válasz a tesztkérésre: "${text.substring(0, 50).trim()}..."`);
    console.log(`Modell: ${GEMINI_MODEL}`);
  } catch (error) {
    console.error("❌ Nem sikerült kapcsolódni a Gemini API-hoz:", error.message);
  }
  
  console.log('=================================================');
  
  // Felhasználók listájának törlése induláskor
  seenUsers.clear();
});

// Billentyűparancs figyelése a konzolban a leállításhoz
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input) => {
  if (input.toLowerCase() === 'exit') {
    console.log('Bot leállítása a konzolon keresztül...');
    client.disconnect();
    console.log('Bot sikeresen leállítva!');
    process.exit(0);
  } else if (input.toLowerCase() === 'stats') {
    // Statisztikák lekérése parancsra
    console.log(`\n=== STATISZTIKA ===`);
    console.log(`Egyedi felhasználók száma: ${seenUsers.size}`);
    if (seenUsers.size > 0) {
      console.log('Felhasználók:');
      console.log(Array.from(seenUsers).join(', '));
    }
    console.log(`=================\n`);
  }
});

// Ctrl+C esemény kezelése
process.on('SIGINT', () => {
  console.log('\nBot leállítása Ctrl+C billentyűkombinációval...');
  client.disconnect();
  console.log('Bot sikeresen leállítva!');
  process.exit(0);
});
