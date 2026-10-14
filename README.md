# wabot

A small WhatsApp bot that runs on my low-spec Debian laptop.
It uses Baileys, Node.js, SQLite, and the Gemini API.

## Features

- `!ping` - check if the bot is alive
- `!help` - show the command list
- `!uptime` - how long the laptop has been on
- `!sysinfo` - RAM, load, temperature, disk (owner only)
- `!ai <question>` - ask Gemini (owner only)
  - Send a photo with the caption `!ai <question>` to ask about the photo
- `!sticker` - send a photo with this caption to get a sticker (owner only)
- `!history` and `!reset` - show or clear the chat memory
  - In a group, only the owner can use them
- Chat memory is saved per chat in SQLite

## Requirements

- Debian (or another Linux) and Node.js 20 or newer
- `ffmpeg` (for stickers): `sudo apt install ffmpeg`
- A spare WhatsApp number for the bot
- A Gemini API key from Google AI Studio

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
```

`GEMINI_MODEL` can have many models, separated by commas.
If the first model fails, the bot tries the next one.
Model names change often, so check the list in Google AI Studio.

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

Then add these aliases to `~/.bashrc`:

```bash
alias boton='systemctl --user start wabot'
alias botoff='systemctl --user stop wabot'
alias botrestart='systemctl --user restart wabot'
alias botstatus='systemctl --user status wabot --no-pager'
alias botlog='journalctl --user -u wabot -f'
```

Run `systemctl --user daemon-reload` once.
After you change the code or `.env`, use `botrestart`.

## Safety

- Never upload `.env`, `auth/`, or `bot.db`. They are in `.gitignore`.
- This bot uses an unofficial WhatsApp library.
  Your account can be restricted. Use a spare number.
  Do not send spam or bulk messages.
- The bot only logs command names, not the full text of messages.

## License

MIT. See the LICENSE file.

