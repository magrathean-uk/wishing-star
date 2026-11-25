// Material cues are for fictional characters only. Flat 2D casts keep their own visual language.
const notes: Record<string, string> = {
  flop: 'Give the soft toy rounded volume with fine knitted orange wool, visible knit stitches and dark brown fabric ears and limbs.',
  paddington:
    'Give the bear soft brown fur, a woven blue duffle coat, a felt-like red hat and a worn leather suitcase, with gentle dimensional light.',
  woody:
    'Use stitched fabric and felt for the cowboy doll, with a painted toy face, cloth clothes and satin leather-look boots.',
  jessie:
    'Use a gently moulded painted toy face, stitched fabric clothes and chaps, felt hat and glossy leather-look boots.',
  buzz: 'Use rounded moulded satin plastic for the space suit, subtle glossy panels and a clear helmet; keep the purple head covering.',
  rex: 'Use gently glossy moulded green toy plastic, with shallow raised scale texture and softly rounded toy forms.',
  slinky: 'Use gently glossy moulded toy plastic for the head and paws and a clearly dimensional coiled metal spring.',
  potato:
    'Use a softly rounded potato-shaped toy body and smooth satin plastic for the removable facial features, hands and shoes.',
  bo_peep: 'Use a softly glazed porcelain-like doll face with dimensional cloth cape and clothing, and a smooth crook.',
  alien: 'Use softly rounded moulded green vinyl with a gentle satin highlight and a dimensional blue toy spacesuit.',
  forky: 'Use lightly reflective white plastic, fuzzy red pipe cleaners, modelling clay and matte wooden lolly sticks.',
  bullseye:
    'Use rounded moulded toy forms with satin brown surfaces, a soft mane and a dimensional leather-look saddle.',
  bob: 'Use softly rounded yellow plastic, shiny metal goggles and visibly woven blue denim dungarees.',
  kevin: 'Use softly rounded yellow plastic, shiny metal goggles and visibly woven blue denim dungarees.',
  stuart: 'Use softly rounded yellow plastic, a shiny metal goggle and visibly woven blue denim dungarees.',
  minion_d: 'Use softly rounded yellow plastic, shiny metal goggles and visibly woven blue denim dungarees.',
  minion_e: 'Use softly rounded yellow plastic, shiny metal goggles and visibly woven blue denim dungarees.',
};

export function materialNote(id: string): string | undefined {
  return notes[id];
}
