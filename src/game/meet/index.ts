// The way into the shared place (package 66): the title's "Play together" row. The two scenes are added the first
// time they are needed, so the game's own scene list (src/main.ts) stays as it is and the home copy never makes them.
import type Phaser from 'phaser';
import { Meet } from './Meet.ts';
import { MeetHud } from './MeetHud.ts';

export function startMeet(from: Phaser.Scene): void {
  const scenes = from.game.scene;
  if (!scenes.keys.Meet) scenes.add('Meet', Meet, false);
  if (!scenes.keys.MeetHud) scenes.add('MeetHud', MeetHud, false);
  from.scene.start('Meet', {});
}
