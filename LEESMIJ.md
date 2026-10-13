# JohnsPokemonSniper — website

Dashboard voor de Pokémon-voorraadmonitor, op GitHub Pages (net als John's Ballie Bets).

- **Home**: monitor online / gepauzeerd / offline, Telegram-knop, tellers, laatste meldingen, shops
- **Meldingen**: logboek van alle meldingen, per dag, met filters
- **Producten**: alle gevolgde producten met filters (shop, set, product, prijs, voorraad) en een
  **vergelijkweergave** (per product alle shops naast elkaar, goedkoopste op voorraad bovenaan)
- **Referentie**: de CardTrader-referentieprijs (laagste Engelse aanbieding) per sealed product, met verkoper,
  datum en link, naast de goedkoopste aanbieding die de sniper nu op voorraad ziet en de laagste prijs ooit.
  Filters op set, kleur (🟢 t/m +5% · 🟠 tot +35% · 🔴 daarboven), alleen op voorraad en alleen betrouwbare prijzen.
- **Laagste prijzen**: de laagste prijs ooit per product (shop + datum), naast de goedkoopste aanbieding van nu

## Zo werkt het

De monitor op je Mac (of de server) zet elke paar minuten vijf bestanden (`status.json`, `products.json`, `alerts.json`,
`history.json`, `refs.json`) op een aparte tak **`data`** van deze repository. De website leest ze daar.
Die tak bevat altijd alleen de laatste stand, dus de repository groeit niet.

## Eenmalig instellen (± 10 minuten)

### 1. Repository maken
1. GitHub → **New repository** → naam bv. `pokemon-monitor` → **Public** → vink *Add a README* aan → **Create**.
2. **Add file → Upload files** → sleep de inhoud van deze map erin: `index.html`, de map `assets` en de map `demo`.
   → **Commit changes**.

### 2. GitHub Pages aanzetten
**Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: **main** en **/ (root)** → **Save**.
Na een minuut staat de site op `https://<gebruikersnaam>.github.io/pokemon-monitor/`
(met `?demo` erachter zie je voorbeeldgegevens).

### 3. Token maken (zodat de monitor mag schrijven)
1. GitHub → je profielfoto → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
   → **Generate new token**.
2. Naam: `pokemon-monitor`. Expiration: bv. 1 jaar (zet een herinnering).
3. *Repository access*: **Only select repositories** → kies `pokemon-monitor`.
4. *Permissions → Repository permissions* → **Contents: Read and write**. Verder niets.
5. **Generate token** en kopieer het (je ziet het maar één keer).

### 4. In de monitor
Tabblad **Website**:
- vink **Website bijwerken** aan
- **Repository**: `Player87887/pokemon-monitor` (je gebruikersnaam / de naam van de repository)
- **GitHub-token**: plak het token
- **Telegram-groep**: de uitnodigingslink van je groep (Telegram → groep → *Uitnodigen via link*), bv. `https://t.me/+AbCdEf`
- **Opslaan** → **Nu publiceren** → **Website openen**

## Goed om te weten
- **Online/offline**: de monitor geeft elke paar minuten een hartslag door. Netjes afsluiten = meteen *offline*.
  Valt je Mac uit of verliest hij internet, dan springt de site na ± 10 minuten op *offline*.
- **Gepauzeerd** = de app staat aan, maar de monitor is gestopt.
- De repository is openbaar: iedereen kan de prijzen en meldingen zien (er staat niets geheims in).
  Het **token staat alleen in het instellingenbestand op je Mac** (`pokemon_monitor_config.json`): upload dat nooit.
- **Referentieprijzen** ververst de monitor zelf op de achtergrond (elk product ± elke 10 minuten) zolang hij scant.
  Een `?` achter een prijs = onzeker: minder dan 3 Engelse aanbieders, of de laagste prijs is verdacht laag
  (minder dan de helft van de op-één-na-laagste). Het CardTrader-token staat net als het GitHub-token alleen in
  `pokemon_monitor_config.json`.
- Filters in **Producten** en **Referentie** staan in het adres (bv. `#producten?set=30th+Celebration&view=cmp`):
  zo kun je een gefilterde lijst delen met vrienden.
- Iets aanpassen (teksten, kleuren)? `index.html` en `assets/style.css`. Instellingen: `assets/config.js`.
- De map `demo` is alleen voor de voorbeeldweergave; die mag je laten staan.
