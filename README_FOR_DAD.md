# Amelia and the Wishing Star: notes for Dad

## Start the game
1. Open the folder "Amelia and the Wishing Star".
2. Double-click **Play Amelia**.
3. A Terminal window opens and the game appears in the browser. Leave the Terminal window open while Amelia plays.
4. To stop, close the Terminal window.

## First time only: allowing it on the Mac
The Mac has not seen this app before, so it will probably say it cannot check it. Nothing is wrong. Do this once:

1. Right-click (or Control-click) **Play Amelia** and choose **Open**, then choose **Open** again in the box that appears.
2. If the Mac only offers "Done" or "Move to Bin": click Done, then open **System Settings, Privacy and Security**, scroll down, and click **Open Anyway** next to the message about Play Amelia. Enter the Mac password and choose **Open**.
3. The same message may appear a second time for the file called **play-server** the first time the game starts. Repeat step 2 for it, then double-click Play Amelia again.

After that it opens normally with a double-click.

Quarantine note: this only happens if the folder came from a download, AirDrop, email or a USB stick that was copied through Safari or Chrome. Copying the folder with Finder from a disk or a network share often avoids it.

(The end of this file says which parts were tested and which G should confirm once.)

## Browsers
Play in Chrome: the game is made and tested for current Chrome, and that is where it runs smoothest. If the Mac's usual browser is something else, copy the address http://127.0.0.1:4173 into Chrome after starting the game. Safari and Edge may work but are not the target. Always use the same browser on the same Mac, because the saved game lives in the browser.

## Full screen
Press **F** in the game.

## Is it running smoothly?
Press the **`** key (top left, under Esc) during play. A small number shows how many frames a second the game draws: 60 is right. Press it again to hide it.

## Saves
The game saves by itself as she plays, in the browser's storage for the address http://127.0.0.1:4173, so use the same browser on the same computer every time. There are three save slots. Clearing the browser's site data deletes the saves from the browser, but a second copy is kept on disk (below).

A second copy of every save is kept on disk, in the folder `data/home/` beside Play Amelia (on Windows `data\home\` beside `Play Amelia.bat`): the newest in `slot1.json` to `slot3.json`, older ones in `history/`. The Mac and the Windows launcher both keep it. If the browser ever loses its saves, the game puts the copy back by itself on the title screen and says "Your saved game is back." Keep the `data` folder when you update the game.
To put an older copy back by hand: **Options**, **Saved games**, pick the slot, **Put a copy back**, then choose a file from `data/home/history/` (`data\home\history\` on Windows).
Always open the game at http://127.0.0.1:4173 (the game sends http://localhost:4173 there itself, because the browser keeps the two addresses' saves apart).

To back one up: press **P** (or Esc) for the pause menu, choose **Options**, then **Saved games**. Pick the slot and choose **Keep a copy**: a small file (for example `amelia-wishing-star-slot1-day12.json`) lands in the Downloads folder. Keep it somewhere safe. To restore it, choose **Put a copy back** on the same page and pick that file. The same page is under **Options** on the title screen.

## Changing the letters and names
All the personal words live in one file: `game/personal.json` inside the release folder. It holds the greeting on the title, the names, every letter, the ten notes in bottles, the credits line and your five notes on the treasure trail (`trail_note1` to `trail_note5`, under the names). Under `december` are your 25 notes for the Post Office, `"1"` to `"25"`: each one waits there from its day in December, and from Christmas Day all 25 are there.
1. Open `game/personal.json` in TextEdit. If TextEdit shows formatted text, choose Format, then Make Plain Text.
2. Change only the words on the right of each colon. Keep the quote marks and commas. A quote mark inside your words needs a backslash before it, as in the trail notes. Quote marks must be straight ("), never curly (“ ”): TextEdit turns them curly as you type unless you switch it off under Edit, then Substitutions, then Smart Quotes.
3. Save, then close the Terminal window and double-click Play Amelia again. No rebuild is needed.

If the file gets broken (a missing quote or a curly quote, for example), the game uses its built-in copy instead and the title screen says so in one small line at the top: "personal.json has a mistake. The built-in words are used." Nothing is lost: fix the file and start the game again. The browser's console (Option, Command and J in Chrome) says which line and column the mistake is on.

## The Christmas layer
In the game: **P**, **Options**, then **Christmas**: Auto, On or Off (also under Options on the title screen). Auto means on from 1 December to 6 January: snow, lights, the tree with a present each morning.

## If she is stuck
Press **H** for a hint: one calm picture of what to do next. The game also offers one by itself when nothing has moved on for a while. **Q** shows her quests, **M** the map. **P** shows every key under How to play.

## If it says "Close the other Play Amelia window and try again"
The game is already running in another Terminal window, or the last one did not close. Close that Terminal window (look in the Dock), then double-click Play Amelia again. If it still says it, restart the Mac.

## Privacy
At home nothing is ever sent anywhere. The game runs only on this computer, and the small server listens only to this computer (127.0.0.1). Only players mode (below) keeps saves on the server.

## Letting other children play (on a server)
The same folder can run the game for several players, each with a password and one saved game on the server. The double-click Play Amelia above is not changed by this.

1. Start it with `./play-server --players` (in a Terminal, inside the folder). It listens on 127.0.0.1:4174 only. Settings: `WS_PORT` (another port), `WS_HOST` (another address), `WS_DATA` (another data folder), `WS_TRUST_PROXY=1`.
   `WS_TRUST_PROXY=1` is needed behind a proxy, not optional: without it every child has the proxy's address, so one child's wrong passwords lock everyone out. If you forget it, the server prints "These requests come through a proxy." once.
2. The first start makes the folder `data/` beside play-server. `data/PASSWORDS.txt` lists the passwords to hand out: Amelia's own entry at the top keeps her fixed password, Player 1 to Player 10 get 4 random letters each. They never change once made.
3. Put HTTPS in front with a reverse proxy (for example nginx or Caddy) that passes everything to http://127.0.0.1:4174. Do not open port 4174 to the internet itself.
4. Back up the `data/` folder: it holds the passwords, the logins and every saved game. When a newer build replaces the game folder, copy the old `data/` folder into the new one before starting it.
5. Saved games are in `data/saves/`: `p1.json` is Player 1's game now (`hero.json` is Amelia's), `p1.prev.json` the one before it, and `p1.2026-12-24.json` and so on one copy a day (the newest 7 days are kept). To put an older game back, stop the server, copy the one you want over `p1.json`, and start it again.

In this mode the title asks "Who is playing?". Each player types their password once per computer. Amelia's entry shows your letters and names. Player 1 to 10 never see your letters or names: their letters, bottles and the last letter are short kind notes from "a friend on the island". The Windows server (`play-server.ps1`) has no players mode.

Wrong passwords: after 5 wrong tries from one computer, that computer waits a minute (longer each time, up to 15 minutes). After 10 wrong tries for one player in a day, from anywhere, that player cannot log in again until the next day (UTC), except on a computer or iPad where they have already logged in before. The day's count is kept in `data/tries.json`; to clear it, stop the server, delete that file and start it again.

Two devices, one player: the game on the server is the one that counts. If a player goes back to an older tablet that missed newer play, it says "Your game moved on." and carries on from the server's game. The tablet's own copy is kept in its browser (as `ws_pl_<player>_fork`), never sent to the server.

### Playing together, and chat
In this mode the title has one more row, "Play together". It opens a sunny meadow where the players meet as their heroes: swings, a trampoline, a slide, Keepy Uppy on the lawn and a race. Nothing there changes anyone's story game. Escape (or the Back button) goes back to the title.

The one thing the proxy needs: it must pass WebSocket upgrades for `api/room` (with the game under `/christmas/`, that is `/christmas/api/room`). For nginx, inside the `location` that passes to 127.0.0.1:4174:

```
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Caddy's `reverse_proxy` does this by itself. Without it the meadow says "No answer just now. Try again soon." and goes back to the title; the rest of the game still works.

On a computer: arrow keys walk, Space uses the swing, trampoline, ball or race (a line at the bottom says which), Enter types a line and 1 to 6 send a ready phrase. On an iPad the six phrases and a Type button show on the screen instead, and the round button says what it does there: Swing, Bounce, Bat or Go.

Chat (typed lines and six ready phrases) is for logged-in players only, with at most 1 message every 2 seconds and 10 a minute each. Web addresses, `@`, long numbers and rude words are refused; only the sender sees "Try other words.". Everything said, sent or refused, is written to `data/chat-YYYY-MM-DD.log` with the time and the player (`p3` is Player 3).
- More words to refuse: put them in `data/chat-words.txt`, one a line.
- Typing off for everyone (the ready phrases stay): `data/room.json` with `{ "chat": false }`, or start with `WS_CHAT=0`.
- Silence one player: `{ "muted": ["p3"] }` in `data/room.json` (both together: `{ "chat": false, "muted": ["p3"] }`).
These two files are read again within 2 seconds of a change: no restart.

## On an iPad
The server game also plays on an iPad in Safari, held sideways. Phones are not supported: they get a card saying the game needs a bigger screen.
- Controls appear at the first touch: the left thumb drags anywhere on the left half to walk, the big round button on the right is Space (it says what it does: Talk, Pick, Next), the small one above it is X (Back, the bow, Skip). Along the top: bag, quests, map, hint, pause. Every menu works by tapping: tap a row or a picture to pick it, tap a tab to change page, tap outside the menu to close it. Tapping a talk box goes on. The journal and map pictures at the top of the screen open them too. No key names are shown on the iPad: the buttons say what they do. A key on a keyboard hides the controls again.
- Held upright, it asks to turn the iPad and waits.
- The password: tapping your name brings up the iPad's keyboard; the 4th letter logs in.
- Sound starts at the first touch (the iPad's side switch must not be on silent).
- Full screen: the Full screen button in the pause menu, or better, Add to Home Screen: in Safari tap Share, then Add to Home Screen. The game then opens from its own icon with no Safari bars.
- Fewer effects is switched on once on an iPad; it can be turned off in Options.

## Notes for G: what was tested
Observed on the build Mac (17 November 2026): the folder was marked as downloaded from Safari (quarantine flag), and the flag stayed on both Play Amelia and play-server. The build Mac has Gatekeeper switched off ("assessments disabled"), so spctl reported "accepted" and no dialog could be provoked. The server file is signed ad hoc and runs with no Node installed.

Not observed, standard macOS behaviour: the "cannot be opened" message, the right-click Open route and the Open Anyway button in Privacy and Security. Please try them once on Dad's Mac (or any Mac with Gatekeeper on) with a folder that carries the download flag, and adjust the steps above if the wording differs.
