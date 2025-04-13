const tmi = require('tmi.js');
const readline = require('readline');
const fetch = require('node-fetch'); // Használjuk a node-fetch könyvtárat a fetch kérésekhez

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
const TWITCH_USERNAME = 'CHANGE ME'; // Ide írd a saját Twitch felhasználónevedet
const TWITCH_OAUTH_TOKEN = 'oauth:CHANGE ME'; // Az új token formátuma még mindig oauth:xyz...

// Groq API konfiguráció
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// A tulajdonos felhasználóneve, aki leállíthatja a botot
const OWNER_USERNAME = TWITCH_USERNAME.toLowerCase();

// További admin felhasználók, akik parancsokat adhatnak a botnak
const ADMIN_USERS = ['YOUR DISCORD NAME, username no Username'];

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

// Funkció a Groq modellek lekérdezésére - ellenőrzéshez
async function listGroqModels() {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
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

// Groq AI-val való kommunikáció fetch API-n keresztül
async function askGroq(username, question) {
  try {
    console.log(`GroqAI kérdés: ${question}`);
    console.log('API kérés küldése...');
    
    // Megnézzük, hogy milyen modellek érhetők el
    try {
      console.log("Elérhető modellek ellenőrzése...");
      const models = await listGroqModels();
      if (models.length > 0) {
        console.log("Elérhető Groq modellek:");
        models.forEach(model => console.log(`- ${model.id}`));
      } else {
        console.log("Nem sikerült lekérdezni a modelleket, használjuk az alapértelmezettet");
      }
    } catch (err) {
      console.log("Nem sikerült lekérdezni a modelleket:", err.message);
    }
    
    // Javított API kérés a példa alapján
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama3-70b-8192", // Népszerű modell, amely valószínűleg elérhető
        messages: [
          { role: "system", content: "Te egy segítőkész és barátságos Twitch chat asszisztens vagy. Rövid, tömör válaszokat adsz magyarul." },
          { role: "user", content: `${username} kérdése: ${question}` }
        ],
        temperature: 0.7,
        max_tokens: 150
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API válasz hiba:', errorText);
      throw new Error(`API hiba: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('API válasz sikeresen beérkezett');
    return data.choices[0].message.content || "Sajnos nem tudok válaszolni erre a kérdésre.";
  } catch (error) {
    console.error('Hiba történt a Groq API hívás során:', error);
    return "Sajnos hiba történt a válasz generálása közben.";
  }
}

// Groq AI-val való üdvözlő üzenet generálása
async function generateWelcomeMessage(username) {
  try {
    console.log(`Üdvözlő üzenet generálása ${username} felhasználónak...`);
    
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama3-70b-8192",
        messages: [
          { 
            role: "system", 
            content: "Te egy barátságos Twitch chat asszisztens vagy. Generálj egy rövid, kreatív és kedves üdvözlő üzenetet magyarul egy új chat felhasználónak. Az üzenet legyen 60-100 karakter közötti, barátságos, változatos és mindig egyedi. Csak az üdvözlést add meg, minden bevezetés vagy magyarázat nélkül." 
          },
          { 
            role: "user", 
            content: `Üdvözöld az új felhasználót: ${username}` 
          }
        ],
        temperature: 0.8,  // Magasabb kreativitás az üdvözlésekhez
        max_tokens: 80     // Rövid válaszok
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API válasz hiba az üdvözlő üzenet generálásánál:', errorText);
      throw new Error(`API hiba: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    let welcomeMessage = data.choices[0].message.content || "Üdvözöllek a csatornán!";
    
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

// Eseménykezelő chat üzenetek fogadására
client.on('message', async (channel, tags, message, self) => {
  // Saját üzeneteket figyelmen kívül hagyjuk
  if (self) return;

  const username = tags.username.toLowerCase();
  
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
  
  // Groq AI válasz kérés - ha a felhasználó a botot megszólítja
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
      // Eltávolítva: client.say(channel, `@${tags.username}, gondolkodom a válaszon...`);
      
      try {
        const aiResponse = await askGroq(tags.username, question);
        client.say(channel, `@${tags.username}, ${aiResponse}`);
        console.log(`AI válasz küldve ${tags.username} felhasználónak.`);
      } catch (error) {
        console.error('Hiba történt a Groq válasz küldése közben:', error);
        client.say(channel, `@${tags.username}, sajnos technikai probléma miatt most nem tudok válaszolni.`);
      }
    }
    
    isProcessingAIResponse = false;
  }
});

// Inicializáljuk a botot a kapcsolódás után a modellek ellenőrzésével
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
  
  console.log('* Groq API tesztelése...');
  try {
    const models = await listGroqModels();
    if (models.length > 0) {
      console.log("✅ Groq API kapcsolat sikeres!");
      console.log("Elérhető modellek:");
      models.forEach(model => console.log(`- ${model.id}`));
    } else {
      console.log("⚠️ Groq API válaszolt, de nem találtunk modelleket.");
    }
  } catch (error) {
    console.error("❌ Nem sikerült kapcsolódni a Groq API-hoz:", error.message);
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
