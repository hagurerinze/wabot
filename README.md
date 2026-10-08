# wabot

A small WhatsApp bot that runs on my Debian laptop.
It uses Baileys, Node.js, SQLite, and the Gemini API.

## Features

- `!ping` - check if the bot is alive
- `!help` - show the command list
- `!uptime` - how long the laptop has been on
- `!sysinfo` - RAM, load, temperature, disk (owner only)
- `!ai <question>` - ask Gemini (owner only)
- `!history` and `!reset` - show or clear the chat memory
- Chat memory is saved per chat in SQLite

## Requirements

- Node.js 20 or newer
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

## Run

```bash
node --env-file=.env index.js
```

The first time, the bot shows a pairing code.
On the bot phone, open WhatsApp, go to Linked devices,
and choose "Link with phone number".

To find your `OWNER_ID`, run the bot without it and send any message.
The bot prints the sender ID in the terminal.

## Safety

- Never upload `.env`, `auth/`, or `bot.db`. They are in `.gitignore`.
- This bot uses an unofficial WhatsApp library.
  Your account can be restricted. Use a spare number.
  Do not send spam or bulk messages.
