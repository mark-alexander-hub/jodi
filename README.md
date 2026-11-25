# Jodi

**The singles' corner for one wedding.** Guests scan a card at the venue, see the other single guests at the same wedding, and get each other's Instagram or WhatsApp only when two people like each other.

Free. No ads. No app to install. Everything is deleted three days after the wedding.

## How to use it

### If it is your wedding (or you are helping the couple)

1. Open the site and tap **Set it up for a wedding**. Type the couple's names and the wedding date.
2. You land on your **host page**. Bookmark it, or tap **Copy my host link** and send it to yourself. That link is your only key. There is no password.
3. Tap **Print the table card**. Leave two or three copies where people queue: the entrance, the food counters, the photo booth. You can also share the guest link in the wedding WhatsApp group.
4. Ask the emcee or DJ to mention it once. Most people join right after.
5. That is all. The room closes by itself three days after the wedding date.

On the host page you can see who joined and remove anyone who should not be there. You cannot see who liked whom or who matched.

### If you are a guest

1. Scan the card with your phone camera.
2. Tap **I'm single. Count me in** and fill in your first name, age, who you would like to meet, what you are wearing today, and a photo if you like.
3. Open **Who's here** and tap a picture to read more. Tap **Like** on the people you would like to meet. You get 10 likes.
4. If they like you too, it is a **jodi**: you both see each other's Instagram or WhatsApp under **Jodis**.
5. Go and say hello. You are at the same wedding.

You can change or delete your profile at any time under **Me**.

## What it promises, and how

| Promise | How it is kept |
| --- | --- |
| Only other singles see you | The list of people is only sent to someone who has made a profile, and only if you each asked to meet the other's gender. |
| A like that is not returned stays secret | The server never tells anyone who liked them. It only reports a match once both likes exist. |
| Contact is hidden until it is mutual | Instagram names and phone numbers are only sent inside a match. |
| The couple cannot snoop | The host page gets names and a count of matches. It never gets likes, matches or contact details. |
| Everything is deleted | A room and all its profiles, photos and likes are erased three days after the wedding date, by a daily job. The couple can close it sooner, and any guest can delete their own profile. |
| No tracking | No analytics, no cookies, no third-party scripts or fonts. Photos are shrunk on the phone before upload. |

Things it does not do: it does not check that someone is really single or really a guest. Anyone with the card can join, which is why the couple can remove people and guests can hide and report someone.

## Run it yourself

It is one Cloudflare Worker with a small D1 database. Both fit in Cloudflare's free plan.

```
npm install
npm run dev        # open http://127.0.0.1:8787
npm test           # in a second terminal: 22 end-to-end checks against the running app
```

To put it on the internet with your own free Cloudflare account:

```
npx wrangler login
npx wrangler deploy
```

Wrangler creates the database on the first deploy, and the app creates its tables on first use. If your version of wrangler asks for a database id instead, run `npx wrangler d1 create jodi` and paste the id it prints into `wrangler.jsonc` as `"database_id"`.

Good to do after deploying: add a Cloudflare rate-limiting rule on `/api/*` so nobody can flood the room-creation endpoint.

## How it is built

```
src/worker.js      the API and the daily clean-up
public/            the three pages (start, guest room, host), plain HTML, CSS and JavaScript
test/selftest.mjs  end-to-end checks of the API
```

There is no framework and no build step. There are no accounts: a guest's phone keeps a random key for that one wedding, and the server stores only its hash.

## Credits

- QR codes: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, MIT.
- Typefaces: Hind by Indian Type Foundry and Baloo 2 by Ek Type, both under the SIL Open Font License. Licence texts are in `licenses/`.

## Licence

MIT. Use it, change it, host it for your own community.
