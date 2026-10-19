# wabot

A small WhatsApp bot that runs on my low-spec Debian laptop.
The bot is a character named Yurishy.
It uses Baileys, Node.js, SQLite, the Gemini API, and Cloudflare Workers AI.

## Commands

Everyone can use these:

- `!ping` - check if the bot is alive
- `!help` - show the command list
- `!uptime` - how long the laptop has been on
- `!ai <question>` - ask Yurishy (you can send a photo with this caption)
- `!sticker` - send a photo with this caption to get a sticker
- `!history` - show your last chat messages
- `!reset` - delete your chat memory

In a group, you can also tag the bot number and write a message.
It works the same as `!ai`, but you do not need to type the command.

Only the owner can use these:

- `!sysinfo` - RAM, load, temperature, disk
- `!img <description>` - make a picture with Cloudflare Workers AI

## Limits

The owner has no limit. Other people have these limits:

- `!ai`: 5 per minute and 50 per day for each person
- `!ai`: 300 per day for everyone together
- `!sticker`: 3 per minute for each person, and one sticker at a time

## How it works

- Chat memory is saved in SQLite.
  In a group, each person has their own memory.
- Yurishy calls people by their WhatsApp name.
- Yurishy's personality is in `persona.md`.
  When you change this file, the change works at once. You do not need to restart.
- If the first Gemini model fails, the bot tries the next model.
- Yurishy says honestly that she is a bot if someone asks seriously.

## Requirements

- Debian (or another Linux) and Node.js 20 or newer
- `ffmpeg` (for stickers): `sudo apt install ffmpeg`
- A spare WhatsApp number for the bot
- A Gemini API key from Google AI Studio
- A free Cloudflare account (only for `!img`)

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
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.5-flash-lite,gemini-3.1-flash-lite
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_cloudflare_token
BLOCKED=
```

- `GEMINI_MODEL` can have many models, separated by commas.
  Model names change often, so check the list in Google AI Studio.
- `BLOCKED` is a list of sender IDs the bot will ignore, separated by commas.
  You can leave it empty.

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

The bot only saves `!ai` chats. It does not save normal WhatsApp messages.

## Privacy and safety

- Messages for `!ai` are sent to the Gemini API and saved on the owner's laptop.
  `!reset` deletes your own chat memory.
- The bot logs only command names and tag IDs, not the full text of messages.
- Never upload `.env`, `auth/`, or `bot.db`. They are in `.gitignore`.
- This bot uses an unofficial WhatsApp library.
  Your account can be restricted. Use a spare number.
  The bot only answers commands and tags. Do not use it for spam or bulk messages.

## License

MIT. See the LICENSE file.
