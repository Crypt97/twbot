# Twitch AI Chat Bot - Használati útmutató

## Bevezetés

Ez a program egy egyszerű Twitch chat bot, amely a következőket tudja:
- AI segítségével válaszol a felhasználók kérdéseire
- Üdvözli az új chat felhasználókat (opcionálisan)
- Egyszerű parancsokkal irányítható

## Rendszerkövetelmények

- Windows operációs rendszer
- Node.js telepítve (letölthető: https://nodejs.org/)

## Telepítés és beállítás

### Twitch felhasználónév és OAuth token beállítása

Mielőtt először elindítanád a botot, be kell állítanod a Twitch felhasználónevedet és az OAuth tokent a kódban:

1. **Twitch felhasználónév**: Ez az a felhasználónév, amit a bothoz használni szeretnél.
   - Ha nincs Twitch fiókod, regisztrálj egyet a [Twitch](https://www.twitch.tv/signup) oldalán
   - Az azonos nevű streamer fiókokat is használhatod botként, de ajánlott egy dedikált bot fiók létrehozása

2. **OAuth token beszerzése a Twitch-hez (hivatalos módszer)**:
   - Látogass el a [Twitch Developer Console](https://dev.twitch.tv/console/apps) oldalra
   - Jelentkezz be a bot fiókjával
   - Kattints a "Register Your Application" gombra
   - Töltsd ki az űrlapot:
     - Név: TwitchBot (vagy bármilyen egyedi név)
     - OAuth Redirect URL: http://localhost
     - Kategória: Chat Bot (vagy Chatbot Integration)
   - Kattints a "Create" gombra
   - Az alkalmazás létrehozása után kattints a "Manage" gombra
   - Jegyezd fel a Client ID-t és kattints a "New Secret" gombra a Client Secret generálásához
   - Az OAuth token beszerzéséhez nyisd meg az alábbi URL-t (helyettesítsd YOUR_CLIENT_ID-t a Client ID-vel):
   ```
   https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=token&scope=chat:read+chat:edit
   ```
   - Engedélyezd a hozzáférést, majd az átirányítás után az URL-ben megtalálod az access_token-t:
   ```
   http://localhost/#access_token=YOUR_ACCESS_TOKEN&scope=chat%3Aread+chat%3Aedit&token_type=bearer
   ```
   - Másold ki az access tokent, és add hozzá az "oauth:" előtagot, tehát: `oauth:YOUR_ACCESS_TOKEN`
   - Ezt a teljes tokent használd a kódban

3. **Beállítások módosítása a kódban**:
   - Nyisd meg a `twitch-bot.js` fájlt egy szövegszerkesztővel (pl. Jegyzettömb vagy VS Code)
   - Keresd meg ezeket a sorokat (kb. a 12-13. sorban):
     ```javascript
     const TWITCH_USERNAME = 'CHANGE ME'; // Ide írd a saját Twitch felhasználónevedet
     const TWITCH_OAUTH_TOKEN = 'oauth:CHANGE ME'; // Az OAuth token
     ```
   - Cseréld ki a `'CHANGE ME'` értéket a saját Twitch felhasználónevedre
   - Cseréld ki a `'oauth:CHANGE ME'` értéket a saját OAuth tokenedre

4. **Groq API kulcs beállítása** (opcionális, ha módosítani szeretnéd):
   - A bot jelenleg tartalmaz egy beépített Groq API kulcsot
   - Ha saját Groq API kulcsot szeretnél használni:
     - Regisztrálj a [Groq](https://groq.com/) oldalon
     - Szerezz egy API kulcsot
     - Keresd meg ezt a sort a kódban:
       ```javascript
       const GROQ_API_KEY = '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';
       ```
     - Cseréld ki a meglévő kulcsot a sajátodra

### Bot tulajdonos beállítása

A `TWITCH_USERNAME` értéke egyben a bot tulajdonosát is jelöli. Csak ez a felhasználó tud bizonyos parancsokat használni, például:
- A bot leállítása (`!stopbot`)
- Az üdvözlő funkció be/kikapcsolása (`!welcome`)

## Első indítás lépésről lépésre

1. Győződj meg róla, hogy a Node.js telepítve van a számítógépeden
   - Ezt ellenőrizheted a Parancssorban a `node -v` parancs futtatásával

2. Indítsd el a botot a `start.bat` fájlra való dupla kattintással.

3. Amikor a program kéri, írd be a Twitch csatorna nevét, ahová a bot csatlakozzon
   - Például: `Bambojazs` vagy `nincsulas`
   - Ezután nyomj Enter-t

4. A bot elindul és csatlakozik a megadott csatorna chatjéhez.

## Bot funkciók és parancsok

### Felhasználók üdvözlése

Az új felhasználók üdvözlése alapértelmezetten **ki van kapcsolva**. Be- és kikapcsolni az alábbi módon tudod:

- A chatben: `!welcome` parancs begépelésével (csak a bot tulajdonosa használhatja)

### Kérdések feltevése az AI-nak

A chatben bárki kérdezhet a bottól két módon:
- `!ask [kérdés]` paranccsal (például: `!ask Mi az élet értelme?`)
- A bot nevének említésével (például: `@cryptrip mi a véleményed erről?`)

### Bot leállítása

A botot a következő módokon állíthatod le:
- A chatben `!stopbot` parancs beírásával (csak a bot tulajdonosa használhatja)
- A terminálablakban `exit` beírásával és Enter lenyomásával
- A terminálablakban a Ctrl+C billentyűkombináció lenyomásával

## Gyakori problémák és megoldások

### A bot nem tud csatlakozni a Twitch-hez
- Ellenőrizd, hogy helyes-e a megadott csatornanév
- Ellenőrizd, hogy működik-e az internetkapcsolatod
- Ellenőrizd, hogy a bot fiók jelszava/token még érvényes-e

### Az AI válaszok nem működnek
- Ellenőrizd az internet kapcsolatot
- Győződj meg róla, hogy a Groq API kulcs helyesen van beállítva a kódban

### Hibák értelmezése
- A konzolon megjelenő hibaüzenetek segítenek azonosítani a problémákat
- "API válasz hiba" üzenet általában az AI szolgáltatással kapcsolatos problémát jelez

## Értesítések és engedélyek

Mivel ez egy egyszerű script, bizonyos biztonsági figyelmeztetések megjelenhetnek az első futtatáskor. Ha a Windows vagy a vírusirtó figyelmeztetést ad, ennek oka általában az, hogy egy futtatható szkriptet használsz, amit nem csomagoltunk exe fájlba. Ettől függetlenül a szkript biztonságos.

## Technikai információk

Ez a bot Node.js alapú, és a következő könyvtárakat használja:
- tmi.js: Twitch üzenetkezeléshez
- node-fetch: API kérésekhez

Az AI válaszokat a Groq API biztosítja, ami a llama3-70b modellt használja.