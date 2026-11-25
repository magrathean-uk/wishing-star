// Package 73b (I5): the Apple Cafe's counter inside the cafe. Things to eat and drink for emeralds, each of which
// fills hearts as food does; prices like the stalls'. A fresh batch each morning.
import type { StallDef } from '../core/types.ts';

export const cafeStalls: Record<string, StallDef> = {
  cafe_counter: {
    id: 'cafe_counter',
    name: 'the cafe counter',
    keeper: 'hello_kitty',
    sells: [
      { item: 'cookie', price: 2, stock: 4 },
      { item: 'hot_chocolate', price: 4, stock: 3 },
      { item: 'apple_pie', price: 6, stock: 2 },
      { item: 'cake', price: 10, stock: 1 },
    ],
  },
};
