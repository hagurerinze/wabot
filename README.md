# wabot

A small WhatsApp bot that runs on my low-spec Debian laptop.
The bot is a character named Yurishy.
It uses Baileys, Node.js, SQLite, Groq, the Gemini API, and Cloudflare Workers AI.

## Commands

Everyone can use these:

- `!ping` - check if the bot is alive
- `!help` - show the command list
- `!uptime` - how long the laptop has been on
- `!ai <question>` - ask Yurishy (you can send a photo with this caption)
- `!sticker` - send a photo with this caption to get a sticker
- `!history` - show your last chat messages
- `!reset` - delete your chat memory
- `!forget` - delete the facts the bot saved about you
- `!todo` - show your todo list. Each person has their own list, also in a group
- `!todo <text>` - add a todo (you can also write `!todo tambah <text>`).
  Use `;` or a new line to add many at once (up to 10 per message, and 30 open todos for each person)
- `!todo selesai 1 3` - mark items as done by their number
- `!todo hapus 2` - delete items by their number
- `!todo kosongkan` - delete your whole list

In a group, you can also tag the bot number and write a message.
You can also reply to a message from the bot. It answers like !ai, with no prefix.
In a private chat, you can write without any prefix. It answers like !ai.
Messages with no text (stickers, voice notes) are ignored.
It works the same as `!ai`, but you do not need to type the command.

Only the owner can use these:

- `!sysinfo` - RAM, load, temperature, disk
- `!img <description>` - make a picture with Cloudflare Workers AI

## Limits

The owner has no limit. Other people have these limits:

- `!ai`: 5 per minute and 50 per day for each person
- `!ai`: 300 per day for everyone together
- `!sticker`: 3 per minute for each person, and one sticker at a time
- `!todo`: 10 per minute for each person

## Todo, time, weather, and laptop status in chat

You can talk to Yurishy in a normal way (tag, reply, or private chat). You do not need to type `!todo`:

- "todo ku apa ya" - shows your list. The bot reads it from the database, and the AI does not see your list.
- "todo 2 selesai" - marks item 2 as done. The bot uses the number directly.
- "tambah todo ku, ttg beli kabel" - adds a todo.
  The AI reads the message and writes a hidden tag. The bot saves the todo, removes the tag, and shows what it saved.
- "todo kabel udah selesai" - marks the todo with that word as done.
  If two todos have the same word, Yurishy asks for the number.
- If all AI models fail, the bot can still add a todo from a simple "tambah todo ..." message.

The AI is only told about the todo tags when the message has the word "todo" or "tugas".
Deleting a todo is not done by chat. Use `!todo hapus`.

Yurishy also knows these things:

- The date and time in Asia/Jakarta (WIB). The time zone is written in `ai.js`.
- The weather, when the message has a word like "cuaca" or "hujan".
  The bot gets it from [Open-Meteo](https://open-meteo.com/). It is free and needs no key.
  The default place is Medan. The answer is saved for 15 minutes.
- The status of her laptop (CPU temperature, battery, charger, load, RAM, uptime),
  when the message has a word like "suhu" or "baterai".
  If the battery shows 0%, the bot tells the AI that the battery is broken, so Yurishy does not worry.

## How the AI works

- The bot tries the models in `AI_CHAIN`, from the first to the last.
  If one model is slow, full, or has an error, the bot tries the next one.
- My main choice is Groq because it is fast. Gemini is the backup. Cloudflare Workers AI and OpenRouter are the last backups.
- Messages with a photo go to Gemini, because the other providers I use only read text.
- The bot gives up after about 25 seconds in total.
- The bot logs which model answered and how long it took. It does not log the message text.

## How it works

- Chat memory is saved in SQLite.
  In a group, each person has their own memory.
  Old messages are moved to an archive. They are also turned into a short summary and into memory cards (a short note with keywords).
  Short facts about each person are saved too.
  When you ask something, the bot looks for cards that match your message and gives the best ones to the AI.
  Yurishy also has a small notebook about herself. Everything stays in `bot.db` on the owner's laptop.
- Yurishy calls people by their WhatsApp name.
- Yurishy's personality is in `persona.md`.
  When you change this file, the change works at once. You do not need to restart.
- Yurishy says honestly that she is a bot if someone asks seriously.

## Requirements

- Debian (or another Linux) and Node.js 20 or newer
- `ffmpeg` (for stickers): `sudo apt install ffmpeg`
- A spare WhatsApp number for the bot
- A free Groq API key (main AI)
- A Gemini API key from Google AI Studio (backup AI and photos)
- A free Cloudflare account (only for `!img`)
- No key is needed for the weather. The bot uses Open-Meteo.

## Setup

```bash
git clone https://github.com/hagurerinze/wabot.git
cd wabot
npm install
```

Create a file named `.env`:

```
BOT_NUMBER=628xxxxxxxxxx
OWNER_ID=your_id@lid
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
AI_CHAIN=groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,gemini:gemini-3.5-flash-lite,gemini:gemini-3.1-flash-lite
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_cloudflare_token
BLOCKED=
```

- `AI_CHAIN` is a list of `provider:model`, separated by commas.
  The first one is tried first. Model names change often, so check the lists
  on the Groq console and in Google AI Studio from time to time.
- `BLOCKED` is a list of sender IDs the bot will ignore, separated by commas.
  You can leave it empty.
- Optional: `WEATHER_CITY`, `WEATHER_LAT`, and `WEATHER_LON` set the place for the weather.
  If you leave them out, the bot uses Medan.

## Run

```bash
node --env-file=.env index.js
```

The first time, the bot shows a pairing code.
On the bot phone, open WhatsApp, go to Linked devices,
and choose "Link with phone number".

To find your `OWNER_ID`, run the bot without it and send `!ping`.
The bot prints the sender ID in the terminal.

## Turn it on and off

I do not want the bot to start by itself when the laptop boots.
I use a systemd user service without the `[Install]` part.

Create `~/.config/systemd/user/wabot.service`:

```ini
[Unit]
Description=WhatsApp bot
After=network-online.target

[Service]
WorkingDirectory=%h/wabot
ExecStart=/usr/bin/node --max-old-space-size=256 --env-file=%h/wabot/.env %h/wabot/index.js
Restart=on-failure
RestartSec=5
```

Then add these lines to `~/.bashrc`:

```bash
alias boton='systemctl --user start wabot'
alias botoff='systemctl --user stop wabot'
alias botrestart='systemctl --user restart wabot'
alias botstatus='systemctl --user status wabot --no-pager'
alias botlog='journalctl --user -u wabot -f'
botchats() { (cd ~/wabot && node chats.js "$@"); }
botchat() { (cd ~/wabot && node --env-file=.env chat.js); }
```

Run `systemctl --user daemon-reload` one time.
After you change the code or `.env`, use `botrestart`.

## Terminal tools

- `botchats` - list all saved chats
- `botchats <part of id> [number]` - show the last messages of one chat
- `botchat` - talk to Yurishy in the terminal
- `botmem` - show what the bot remembers (messages, summaries, facts)
- `botmem facts [part of id]` - list the facts about each person
- `botmem summaries [part of id]` - list the chat summaries
- `botmem chat <part of id>` - show the last messages of one chat
- `botmem addfact`, `editfact`, `delfact`, `delperson` - add, change, or delete facts
- `botmem editsummary <part of id>` - change a summary in a text editor
- `botmem renumber` - set the fact ids to start from 1 again
- `botmem notes` - read Yurishy's own notebook and its versions
- `botmem editnotes`, `revert` - change the notebook or go back to an old version
- `botmem proposals` - read the persona ideas that Yurishy suggests

The bot only saves chats with the AI (`!ai`, tags, replies to the bot, and private chats). It does not save other WhatsApp messages.

## Privacy and safety

- Messages for `!ai` are sent to Groq or Gemini, and they are saved on the owner's laptop.
  `!reset` deletes your own chat memory.
- The free plans of AI services can change their rules and limits at any time.
  Read their current terms before you use this bot for other people.
- The bot logs only command names, tag IDs, and the AI model name, not the full text of messages.
- Old messages, short summaries, and memory cards are saved in the local database (`bot.db`) on the owner's laptop.
  The memory cards that match your message are sent to the AI together with your message.
  The `!reset` command deletes your messages, your old-message archive, your summary, and your cards.
- Short facts about each person (for example a nickname or a hobby) are also saved in the local database. The !forget command deletes the facts about you.
- Yurishy also keeps a small notebook about herself. It does not hold names or private facts about people. The owner can read and change it.
- To answer, your messages can be sent to AI providers: Groq, Google Gemini, Cloudflare Workers AI, and OpenRouter. The free plans of some providers may keep your messages or use them to improve their products. Do not send private or sensitive information.
- Your todo list is saved in `bot.db` on the owner's laptop. The list is not sent to AI.
  But when you write about your todos in a normal chat, that message is sent to AI like any other message.
- In a group, if you ask for your todo list, everyone in the group can read it.
- For the weather, the bot asks Open-Meteo. It sends only the coordinates of the place, not your messages.
- Yurishy can tell anyone the temperature and the battery status of the laptop.
- Never upload `.env`, `auth/`, or `bot.db`. They are in `.gitignore`.
  `bot.db` has the chats of other people (old messages, summaries, cards, and facts). It is never uploaded to GitHub.
  This is also true for the files `bot.db-wal` and `bot.db-shm`.
  The file `db.js` is only code. It has the table structure and no chat data.
- This bot uses an unofficial WhatsApp library.
  Your account can be restricted. Use a spare number.
  The bot only answers commands, tags, replies, and private chats. Do not use it for spam or bulk messages.

## Help

If you need help, or you want me to delete your data, send me an email: hagurerinze@gmail.com
Please do not send chat logs, `bot.db`, or `.env` in the email.

## License

MIT. See the LICENSE file.
